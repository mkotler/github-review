use crate::error::{AppError, AppResult};
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
        let log_file_index = 0;
        
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
    ) -> AppResult<ReviewComment> {
        let now = Utc::now().to_rfc3339();
        
        let comment = {
            let conn = self.conn.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
            
            conn.execute(
                "INSERT INTO review_comments 
                 (owner, repo, pr_number, file_path, line_number, side, body, commit_id, created_at, updated_at, deleted)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0)",
                params![
                    owner, repo, pr_number, file_path, line_number, side, body, commit_id, &now, &now
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
                "SELECT id, owner, repo, pr_number, file_path, line_number, side, body, commit_id, created_at, updated_at, deleted
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
            "SELECT id, owner, repo, pr_number, file_path, line_number, side, body, commit_id, created_at, updated_at, deleted
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
    pub async fn clear_review(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
        pr_title: Option<&str>,
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
                let pr_title_str = pr_title.unwrap_or("Untitled");
                let header = format!(
                    "# REVIEW DELETED (NOT SUBMITTED TO GITHUB) at {}\n# Original review started at {}\n# PR: {}\n# URL: https://github.com/{}/{}/pull/{}\n\n",
                    deleted_time, meta.created_at, pr_title_str, owner, repo, pr_number
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
                "SELECT id, owner, repo, pr_number, file_path, line_number, side, body, commit_id, created_at, updated_at, deleted
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
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            
            (metadata, comments)
        };
        
        let log_path = self.get_log_path(owner, repo, pr_number, metadata.log_file_index);
        
        let mut content = String::new();
        content.push_str(&format!("# Review for PR #{}\n", pr_number));
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
            
            content.push_str(&format!(
                "    {}Line {}{}: {}\n",
                deleted_prefix, comment.line_number, side_label, comment.body
            ));
        }
        
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
