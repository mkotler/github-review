/**
 * Core type definitions for the GitHub Review application.
 * Extracted from App.tsx for better modularity and reusability.
 */

// =============================================================================
// Authentication Types
// =============================================================================

export type AuthStatus = {
  is_authenticated: boolean;
  login?: string | null;
  avatar_url?: string | null;
  /** true if authenticated using cached data without network verification */
  is_offline?: boolean;
};

// =============================================================================
// Repository Types
// =============================================================================

export type RepoRef = {
  owner: string;
  repo: string;
};

// =============================================================================
// Pull Request Types
// =============================================================================

export type PullRequestSummary = {
  number: number;
  title: string;
  author: string;
  updated_at: string;
  head_ref: string;
  has_pending_review: boolean;
  file_count: number;
  state: string;
  merged: boolean;
  locked?: boolean;
};

export type PullRequestMetadata = {
  state: string;
  merged: boolean;
  locked: boolean;
};

export type PullRequestDetail = {
  number: number;
  title: string;
  body?: string | null;
  author: string;
  head_sha: string;
  base_sha: string;
  files: PullRequestFile[];
  comments: PullRequestComment[];
  my_comments: PullRequestComment[];
  reviews: PullRequestReview[];
};

// =============================================================================
// File Types
// =============================================================================

export type FileLanguage = string;

export type PullRequestFile = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string | null;
  head_content?: string | null;
  base_content?: string | null;
  language: FileLanguage;
  previous_filename?: string | null;
};

// =============================================================================
// Comment Types
// =============================================================================

export type PullRequestComment = {
  id: number;
  body: string;
  author: string;
  created_at: string;
  url: string;
  path?: string | null;
  line?: number | null;
  side?: "RIGHT" | "LEFT" | null;
  is_review_comment: boolean;
  is_draft: boolean;
  state?: string | null;
  is_mine: boolean;
  review_id?: number | null;
  in_reply_to_id?: number | null;
  outdated?: boolean | null;
};

export type CommentThread = {
  parent: PullRequestComment;
  replies: PullRequestComment[];
};

// =============================================================================
// Review Types
// =============================================================================

export type PullRequestReview = {
  id: number;
  state: string;
  author: string;
  submitted_at?: string | null;
  body?: string | null;
  html_url?: string | null;
  commit_id?: string | null;
  is_mine: boolean;
};

export type PrUnderReview = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  has_local_review: boolean;
  has_pending_review: boolean;
  viewed_count: number;
  total_count: number;
  state?: string;
  merged?: boolean;
  locked?: boolean;
  local_folder?: string | null;
};

// =============================================================================
// Scroll Cache Types
// =============================================================================

export type ScrollCacheEntry = {
  position: number;
  updatedAt: number;
};

export type ScrollCacheCollection = Record<string, ScrollCacheEntry>;

export type ScrollCacheState = {
  fileList?: ScrollCacheCollection;
  fileComments?: ScrollCacheCollection;
  sourcePane?: ScrollCacheCollection;
};

export type ScrollCacheSection = "fileList" | "fileComments" | "sourcePane";

export type SourceRestoreState = {
  fileKey: string;
  target: number;
  startedAt: number;
  attempts: number;
};

// =============================================================================
// UI State Types
// =============================================================================

export type PaneType = "source" | "preview" | "media" | null;

export type MediaViewerContent = {
  type: "image" | "mermaid";
  content: string;
} | null;

export type CommentContextMenuState = {
  x: number;
  y: number;
  comment: PullRequestComment | null;
} | null;

export type SubmissionProgress = {
  current: number;
  total: number;
} | null;

// =============================================================================
// Draft Types
// =============================================================================

export type FileDrafts = {
  inline?: string;
  reply?: Record<number, string>;
  fileLevel?: string;
};

export type DraftsByFile = Record<string, FileDrafts>;

// =============================================================================
// Local Comment Types (from Tauri backend)
// =============================================================================

export type LocalComment = {
  id: number;
  owner: string;
  repo: string;
  pr_number: number;
  file_path: string;
  line_number: number | null;
  side: "RIGHT" | "LEFT";
  body: string;
  commit_id: string;
  created_at: string;
  updated_at: string;
  in_reply_to_id: number | null;
};

export type ReviewMetadata = {
  owner: string;
  repo: string;
  pr_number: number;
  commit_id: string;
  body: string | null;
  created_at: string;
  log_file_index: number;
};
