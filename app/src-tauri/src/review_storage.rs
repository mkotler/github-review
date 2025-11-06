use crate::error::{AppError, AppResult};
use crate::auth::require_token;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewComment {
    pub id: i64,
    pub owner: String,
    pub repo: String,
    pub pr_number: u64,
    pub file_path: String,
    pub line_number: u64,
    pub side: String,
    pub body: String,
    pub commit_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted: bool,
    pub in_reply_to_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewMetadata {
    pub owner: String,
    pub repo: String,
    pub pr_number: u64,
    pub commit_id: String,
    pub body: Option<String>,
    pub created_at: String,
    pub log_file_index: i32,
}

pub struct ReviewStorage {
    conn: Mutex<Connection>,
    log_dir: PathBuf,
}

impl ReviewStorage {
    pub fn new(data_dir: &Path) -> AppResult<Self> {
        tracing::info!("Creating review storage at {:?}", data_dir);
        std::fs::create_dir_all(data_dir)?;
        
        let db_path = data_dir.join("reviews.db");
        tracing::info!("Opening database at {:?}", db_path);
        let conn = Connection::open(&db_path)?;
        
        // Create tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS review_metadata (
                owner TEXT NOT NULL,
                repo TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                commit_id TEXT NOT NULL,
                body TEXT,
                created_at TEXT NOT NULL,
                log_file_index INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (owner, repo, pr_number)
            )",
            [],
        )?;
        
        conn.execute(
            "CREATE TABLE IF NOT EXISTS review_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner TEXT NOT NULL,
                repo TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                line_number INTEGER NOT NULL,
                side TEXT NOT NULL,
                body TEXT NOT NULL,
                commit_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (owner, repo, pr_number) 
                    REFERENCES review_metadata(owner, repo, pr_number)
                    ON DELETE CASCADE
            )",
            [],
        )?;
        
        // Migration: Add deleted column if it doesn't exist
        let _ = conn.execute(
            "ALTER TABLE review_comments ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
            [],
        );
        
        // Migration: Add in_reply_to_id column if it doesn't exist
        let _ = conn.execute(
            "ALTER TABLE review_comments ADD COLUMN in_reply_to_id INTEGER",
            [],
        );
        
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_review_comments_pr 
             ON review_comments(owner, repo, pr_number)",
            [],
        )?;
        
        let log_dir = data_dir.join("review_logs");
        std::fs::create_dir_all(&log_dir)?;
        
        Ok(Self {
            conn: Mutex::new(conn),
            log_dir,
        })
    }
    
    /// Start a new review or get existing review metadata
    pub fn start_review(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
        commit_id: &str,
        body: Option<&str>,
    ) -> AppResult<ReviewMetadata> {
        tracing::info!("Starting review for {}/{}#{}", owner, repo, pr_number);
        let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
        
        // Check if review already exists
        let existing: Option<ReviewMetadata> = conn
            .query_row(
                "SELECT owner, repo, pr_number, commit_id, body, created_at, log_file_index 
                 FROM review_metadata 
                 WHERE owner = ?1 AND repo = ?2 AND pr_number = ?3",
                params![owner, repo, pr_number],
                |row| {
                    Ok(ReviewMetadata {
                        owner: row.get(0)?,
                        repo: row.get(1)?,
                        pr_number: row.get(2)?,
                        commit_id: row.get(3)?,
                        body: row.get(4)?,
                        created_at: row.get(5)?,
                        log_file_index: row.get(6)?,
                    })
                },
            )
            .optional()?;
        
        if let Some(metadata) = existing {
            return Ok(metadata);
        }
        
        // Create new review
        let created_at = Utc::now().to_rfc3339();
        
        // Find the next available log file index by checking existing files
        let log_file_index = self.find_next_log_index(owner, repo, pr_number);
        
        conn.execute(
            "INSERT INTO review_metadata (owner, repo, pr_number, commit_id, body, created_at, log_file_index)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![owner, repo, pr_number, commit_id, body, &created_at, log_file_index],
        )?;
        
        Ok(ReviewMetadata {
            owner: owner.to_string(),
            repo: repo.to_string(),
            pr_number,
            commit_id: commit_id.to_string(),
            body: body.map(String::from),
            created_at,
            log_file_index,
        })
    }
    
    /// Add a comment to the pending review
    pub async fn add_comment(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
        file_path: &str,
        line_number: u64,
        side: &str,
        body: &str,
        commit_id: &str,
        in_reply_to_id: Option<i64>,
    ) -> AppResult<ReviewComment> {
        let now = Utc::now().to_rfc3339();
        
        let comment = {
            let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
            
            conn.execute(
                "INSERT INTO review_comments 
                 (owner, repo, pr_number, file_path, line_number, side, body, commit_id, created_at, updated_at, deleted, in_reply_to_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11)",
                params![
                    owner, repo, pr_number, file_path, line_number, side, body, commit_id, &now, &now, in_reply_to_id
                ],
            )?;
            
            let id = conn.last_insert_rowid();
            
            ReviewComment {
                id,
                owner: owner.to_string(),
                repo: repo.to_string(),
                pr_number,
                file_path: file_path.to_string(),
                line_number,
                side: side.to_string(),
                body: body.to_string(),
                commit_id: commit_id.to_string(),
                created_at: now.clone(),
                updated_at: now,
                deleted: false,
                in_reply_to_id,
            }
        };
        
        // Update log file
        self.write_log(owner, repo, pr_number).await?;
        
        Ok(comment)
    }
    
    /// Update an existing comment
    pub async fn update_comment(
        &self,
        comment_id: i64,
        new_body: &str,
    ) -> AppResult<ReviewComment> {
        let now = Utc::now().to_rfc3339();
        
        let comment = {
            let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
            
            conn.execute(
                "UPDATE review_comments SET body = ?1, updated_at = ?2 WHERE id = ?3",
                params![new_body, &now, comment_id],
            )?;
            
            conn.query_row(
                "SELECT id, owner, repo, pr_number, file_path, line_number, side, body, commit_id, created_at, updated_at, deleted, in_reply_to_id
                 FROM review_comments WHERE id = ?1",
                params![comment_id],
                |row| {
                    Ok(ReviewComment {
                        id: row.get(0)?,
                        owner: row.get(1)?,
                        repo: row.get(2)?,
                        pr_number: row.get(3)?,
                        file_path: row.get(4)?,
                        line_number: row.get(5)?,
                        side: row.get(6)?,
                        body: row.get(7)?,
                        commit_id: row.get(8)?,
                        created_at: row.get(9)?,
                        updated_at: row.get(10)?,
                        deleted: row.get::<_, i64>(11)? != 0,
                        in_reply_to_id: row.get(12).ok(),
                    })
                },
            )?
        };
        
        // Update log file
        self.write_log(&comment.owner, &comment.repo, comment.pr_number).await?;
        
        Ok(comment)
    }
    
    /// Delete a specific comment
    pub async fn delete_comment(&self, comment_id: i64) -> AppResult<()> {
        let (owner, repo, pr_number) = {
            let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
            
            let result: (String, String, u64) = conn.query_row(
                "SELECT owner, repo, pr_number FROM review_comments WHERE id = ?1",
                params![comment_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            
            // Mark as deleted instead of removing
            conn.execute(
                "UPDATE review_comments SET deleted = 1 WHERE id = ?1",
                params![comment_id],
            )?;
            
            result
        };
        
        // Update log file
        self.write_log(&owner, &repo, pr_number).await?;
        
        Ok(())
    }
    
    /// Delete a comment from DB without updating the log file (for successfully posted comments)
    pub fn delete_comment_preserve_log(&self, comment_id: i64) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
        
        conn.execute(
            "DELETE FROM review_comments WHERE id = ?1",
            params![comment_id],
        )?;
        
        Ok(())
    }
    
    /// Get all comments for a review (excluding deleted ones)
    pub fn get_comments(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> AppResult<Vec<ReviewComment>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
        
        let mut stmt = conn.prepare(
            "SELECT id, owner, repo, pr_number, file_path, line_number, side, body, commit_id, created_at, updated_at, deleted, in_reply_to_id
             FROM review_comments
             WHERE owner = ?1 AND repo = ?2 AND pr_number = ?3 AND deleted = 0
             ORDER BY file_path, line_number"
        )?;
        
        let comments = stmt
            .query_map(params![owner, repo, pr_number], |row| {
                Ok(ReviewComment {
                    id: row.get(0)?,
                    owner: row.get(1)?,
                    repo: row.get(2)?,
                    pr_number: row.get(3)?,
                    file_path: row.get(4)?,
                    line_number: row.get(5)?,
                    side: row.get(6)?,
                    body: row.get(7)?,
                    commit_id: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                    deleted: row.get::<_, i64>(11)? != 0,
                    in_reply_to_id: row.get(12).ok(),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        
        Ok(comments)
    }
    
    /// Get review metadata
    pub fn get_review_metadata(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> AppResult<Option<ReviewMetadata>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
        
        let metadata = conn
            .query_row(
                "SELECT owner, repo, pr_number, commit_id, body, created_at, log_file_index
                 FROM review_metadata
                 WHERE owner = ?1 AND repo = ?2 AND pr_number = ?3",
                params![owner, repo, pr_number],
                |row| {
                    Ok(ReviewMetadata {
                        owner: row.get(0)?,
                        repo: row.get(1)?,
                        pr_number: row.get(2)?,
                        commit_id: row.get(3)?,
                        body: row.get(4)?,
                        created_at: row.get(5)?,
                        log_file_index: row.get(6)?,
                    })
                },
            )
            .optional()?;
        
        Ok(metadata)
    }
    
    /// Get all review metadata (for finding PRs under review)
    pub fn get_all_review_metadata(&self) -> AppResult<Vec<ReviewMetadata>> {
        let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
        
        let mut stmt = conn.prepare(
            "SELECT owner, repo, pr_number, commit_id, body, created_at, log_file_index
             FROM review_metadata"
        )?;
        
        let metadata_iter = stmt.query_map([], |row| {
            Ok(ReviewMetadata {
                owner: row.get(0)?,
                repo: row.get(1)?,
                pr_number: row.get(2)?,
                commit_id: row.get(3)?,
                body: row.get(4)?,
                created_at: row.get(5)?,
                log_file_index: row.get(6)?,
            })
        })?;
        
        let mut results = Vec::new();
        for metadata in metadata_iter {
            results.push(metadata?);
        }
        
        Ok(results)
    }
    
    /// Abandon a review (mark log file as abandoned, delete from DB)
    pub async fn abandon_review(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> AppResult<()> {
        let metadata = {
            let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
            
            let metadata: Option<ReviewMetadata> = conn
                .query_row(
                    "SELECT owner, repo, pr_number, commit_id, body, created_at, log_file_index
                     FROM review_metadata
                     WHERE owner = ?1 AND repo = ?2 AND pr_number = ?3",
                    params![owner, repo, pr_number],
                    |row| {
                        Ok(ReviewMetadata {
                            owner: row.get(0)?,
                            repo: row.get(1)?,
                            pr_number: row.get(2)?,
                            commit_id: row.get(3)?,
                            body: row.get(4)?,
                            created_at: row.get(5)?,
                            log_file_index: row.get(6)?,
                        })
                    },
                )
                .optional()?;
            
            metadata
        };
        
        if let Some(meta) = metadata {
            // Mark log file as abandoned
            let log_path = self.get_log_path(owner, repo, pr_number, meta.log_file_index);
            if log_path.exists() {
                let abandoned_time = Utc::now().to_rfc3339();
                let header = format!(
                    "# REVIEW ABANDONED at {}\n# Original review started at {}\n\n",
                    abandoned_time, meta.created_at
                );
                
                let existing_content = fs::read_to_string(&log_path).await.unwrap_or_default();
                let new_content = format!("{}{}", header, existing_content);
                fs::write(&log_path, new_content).await?;
            }
            
            // Delete from database
            let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
            conn.execute(
                "DELETE FROM review_metadata WHERE owner = ?1 AND repo = ?2 AND pr_number = ?3",
                params![owner, repo, pr_number],
            )?;
        }
        
        Ok(())
    }
    
    /// Clear a completed review from database
    pub async fn mark_review_submitted(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
        _pr_title: Option<&str>,
    ) -> AppResult<()> {
        let metadata = {
            let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
            
            let metadata: Option<ReviewMetadata> = conn
                .query_row(
                    "SELECT owner, repo, pr_number, commit_id, body, created_at, log_file_index
                     FROM review_metadata
                     WHERE owner = ?1 AND repo = ?2 AND pr_number = ?3",
                    params![owner, repo, pr_number],
                    |row| {
                        Ok(ReviewMetadata {
                            owner: row.get(0)?,
                            repo: row.get(1)?,
                            pr_number: row.get(2)?,
                            commit_id: row.get(3)?,
                            body: row.get(4)?,
                            created_at: row.get(5)?,
                            log_file_index: row.get(6)?,
                        })
                    },
                )
                .optional()?;
            
            metadata
        };
        
        if let Some(meta) = metadata {
            // Mark log file as submitted
            let log_path = self.get_log_path(owner, repo, pr_number, meta.log_file_index);
            if log_path.exists() {
                let submitted_time = Utc::now().to_rfc3339();
                let header = format!(
                    "# REVIEW SUBMITTED TO GITHUB at {}\n# Original review started at {}\n\n",
                    submitted_time, meta.created_at
                );
                
                let existing_content = fs::read_to_string(&log_path).await.unwrap_or_default();
                let new_content = format!("{}{}", header, existing_content);
                fs::write(&log_path, new_content).await?;
            }
            
            // Delete from database
            let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
            conn.execute(
                "DELETE FROM review_metadata WHERE owner = ?1 AND repo = ?2 AND pr_number = ?3",
                params![owner, repo, pr_number],
            )?;
        }
        
        Ok(())
    }

    pub async fn clear_review(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
        _pr_title: Option<&str>,
    ) -> AppResult<()> {
        let metadata = {
            let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
            
            let metadata: Option<ReviewMetadata> = conn
                .query_row(
                    "SELECT owner, repo, pr_number, commit_id, body, created_at, log_file_index
                     FROM review_metadata
                     WHERE owner = ?1 AND repo = ?2 AND pr_number = ?3",
                    params![owner, repo, pr_number],
                    |row| {
                        Ok(ReviewMetadata {
                            owner: row.get(0)?,
                            repo: row.get(1)?,
                            pr_number: row.get(2)?,
                            commit_id: row.get(3)?,
                            body: row.get(4)?,
                            created_at: row.get(5)?,
                            log_file_index: row.get(6)?,
                        })
                    },
                )
                .optional()?;
            
            metadata
        };
        
        if let Some(meta) = metadata {
            // Mark log file as deleted
            let log_path = self.get_log_path(owner, repo, pr_number, meta.log_file_index);
            if log_path.exists() {
                let deleted_time = Utc::now().to_rfc3339();
                let header = format!(
                    "# REVIEW DELETED (NOT SUBMITTED TO GITHUB) at {}\n# Original review started at {}\n\n",
                    deleted_time, meta.created_at
                );
                
                let existing_content = fs::read_to_string(&log_path).await.unwrap_or_default();
                let new_content = format!("{}{}", header, existing_content);
                fs::write(&log_path, new_content).await?;
            }
            
            // Delete from database
            let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
            conn.execute(
                "DELETE FROM review_metadata WHERE owner = ?1 AND repo = ?2 AND pr_number = ?3",
                params![owner, repo, pr_number],
            )?;
        }
        
        Ok(())
    }
    
    fn get_log_path(&self, owner: &str, repo: &str, pr_number: u64, index: i32) -> PathBuf {
        let filename = if index == 0 {
            format!("{}-{}-{}.log", owner, repo, pr_number)
        } else {
            format!("{}-{}-{}-{}.log", owner, repo, pr_number, index)
        };
        self.log_dir.join(filename)
    }
    
    fn find_next_log_index(&self, owner: &str, repo: &str, pr_number: u64) -> i32 {
        let mut index = 0;
        loop {
            let log_path = self.get_log_path(owner, repo, pr_number, index);
            if !log_path.exists() {
                return index;
            }
            index += 1;
        }
    }
    
    async fn fetch_pr_title(&self, owner: &str, repo: &str, pr_number: u64) -> AppResult<String> {
        let token = require_token()?;
        let client = reqwest::Client::builder()
            .user_agent("github-review-app")
            .build()?;
        
        let url = format!("https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}");
        let response = client
            .get(&url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await?;
        
        if !response.status().is_success() {
            return Err(AppError::Api(format!("Failed to fetch PR title: {}", response.status())));
        }
        
        let pr_data: serde_json::Value = response.json().await?;
        let title = pr_data["title"]
            .as_str()
            .unwrap_or("")
            .to_string();
        
        Ok(title)
    }
    
    async fn write_log(&self, owner: &str, repo: &str, pr_number: u64) -> AppResult<()> {
        tracing::info!("Writing log file for {}/{}#{}", owner, repo, pr_number);
        let (metadata, comments) = {
            let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
            
            let metadata: ReviewMetadata = conn.query_row(
                "SELECT owner, repo, pr_number, commit_id, body, created_at, log_file_index
                 FROM review_metadata
                 WHERE owner = ?1 AND repo = ?2 AND pr_number = ?3",
                params![owner, repo, pr_number],
                |row| {
                    Ok(ReviewMetadata {
                        owner: row.get(0)?,
                        repo: row.get(1)?,
                        pr_number: row.get(2)?,
                        commit_id: row.get(3)?,
                        body: row.get(4)?,
                        created_at: row.get(5)?,
                        log_file_index: row.get(6)?,
                    })
                },
            )?;
            
            let mut stmt = conn.prepare(
                "SELECT id, owner, repo, pr_number, file_path, line_number, side, body, commit_id, created_at, updated_at, deleted, in_reply_to_id
                 FROM review_comments
                 WHERE owner = ?1 AND repo = ?2 AND pr_number = ?3
                 ORDER BY file_path, line_number"
            )?;
            
            let comments = stmt
                .query_map(params![owner, repo, pr_number], |row| {
                    Ok(ReviewComment {
                        id: row.get(0)?,
                        owner: row.get(1)?,
                        repo: row.get(2)?,
                        pr_number: row.get(3)?,
                        file_path: row.get(4)?,
                        line_number: row.get(5)?,
                        side: row.get(6)?,
                        body: row.get(7)?,
                        commit_id: row.get(8)?,
                        created_at: row.get(9)?,
                        updated_at: row.get(10)?,
                        deleted: row.get::<_, i64>(11)? != 0,
                        in_reply_to_id: row.get(12).ok(),
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            
            (metadata, comments)
        };
        
        let log_path = self.get_log_path(owner, repo, pr_number, metadata.log_file_index);
        
        // Fetch PR title from GitHub
        let pr_title = self.fetch_pr_title(owner, repo, pr_number).await.unwrap_or_else(|_| String::new());
        
        let mut content = String::new();
        if pr_title.is_empty() {
            content.push_str(&format!("# Review for PR #{}\n", pr_number));
        } else {
            content.push_str(&format!("# Review for PR #{}: {}\n", pr_number, pr_title));
        }
        content.push_str(&format!("# URL: https://github.com/{}/{}/pull/{}\n", owner, repo, pr_number));
        content.push_str(&format!("# Repository: {}/{}\n", owner, repo));
        content.push_str(&format!("# Created: {}\n", metadata.created_at));
        content.push_str(&format!("# Commit: {}\n", metadata.commit_id));
        if let Some(body) = &metadata.body {
            content.push_str(&format!("# Review Body: {}\n", body));
        }
        let active_count = comments.iter().filter(|c| !c.deleted).count();
        content.push_str(&format!("# Total Comments: {}\n\n", active_count));
        
        let mut current_file: Option<String> = None;
        for comment in comments {
            if current_file.as_ref() != Some(&comment.file_path) {
                content.push_str(&format!("\n{}:\n", comment.file_path));
                current_file = Some(comment.file_path.clone());
            }
            
            let side_label = if comment.side.eq_ignore_ascii_case("LEFT") {
                " (ORIGINAL)"
            } else {
                ""
            };
            
            let deleted_prefix = if comment.deleted { "DELETED - " } else { "" };
            
            // File-level comments (line_number = 0) should show "Overall" instead of "Line 0"
            let line_label = if comment.line_number == 0 {
                "Overall".to_string()
            } else {
                format!("Line {}", comment.line_number)
            };
            
            content.push_str(&format!(
                "    {}{}{}: {}\n",
                deleted_prefix, line_label, side_label, comment.body
            ));
        }
        
        // Overwrite log file with current state
        fs::write(&log_path, content).await?;
        tracing::info!("Log file written successfully to {:?}", log_path);
        
        Ok(())
    }
}

// Global storage instance
use std::sync::OnceLock;
static REVIEW_STORAGE: OnceLock<ReviewStorage> = OnceLock::new();

pub fn init_storage(data_dir: &Path) -> AppResult<()> {
    let storage = ReviewStorage::new(data_dir)?;
    REVIEW_STORAGE
        .set(storage)
        .map_err(|_| AppError::Internal("Storage already initialized".into()))?;
    Ok(())
}

pub fn get_storage() -> AppResult<&'static ReviewStorage> {
    REVIEW_STORAGE
        .get()
        .ok_or_else(|| AppError::Internal("Storage not initialized".into()))
}
