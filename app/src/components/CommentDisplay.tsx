/**
 * CommentDisplay - Displays a single comment with author, date, and body
 * 
 * Used by PR Comments View for simple comment display.
 * The File Comment Panel uses CommentThreadItem for more complex threaded display.
 */

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface CommentDisplayProps {
  /** Comment author username */
  author: string;
  /** Comment creation date (ISO string or Date) */
  createdAt: string | Date;
  /** Comment body (markdown supported) */
  body: string;
  /** Whether to render body as markdown (default: false for simple display) */
  renderMarkdown?: boolean;
  /** Optional className for the container */
  className?: string;
  /** Date format options */
  dateFormat?: "date" | "datetime" | "relative";
}

/**
 * Format a date for display
 */
function formatDate(date: string | Date, format: "date" | "datetime" | "relative"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  
  switch (format) {
    case "datetime":
      return d.toLocaleString();
    case "relative":
      return getRelativeTime(d);
    case "date":
    default:
      return d.toLocaleDateString();
  }
}

/**
 * Get relative time string (e.g., "2 hours ago")
 */
function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  
  return date.toLocaleDateString();
}

/**
 * Simple comment display component
 */
export const CommentDisplay: React.FC<CommentDisplayProps> = ({
  author,
  createdAt,
  body,
  renderMarkdown = false,
  className = "pr-comment",
  dateFormat = "date",
}) => {
  const formattedDate = formatDate(createdAt, dateFormat);
  
  return (
    <div className={className}>
      <div className={`${className}__header`}>
        <span className={`${className}__author`}>{author}</span>
        <span className={`${className}__date`}>{formattedDate}</span>
      </div>
      <div className={`${className}__body`}>
        {renderMarkdown ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        ) : (
          body
        )}
      </div>
    </div>
  );
};

export interface CommentListProps {
  /** Array of comments to display */
  comments: Array<{
    id: number | string;
    author: string;
    created_at: string;
    body: string;
  }>;
  /** Empty state message when no comments */
  emptyMessage?: string;
  /** Whether to render bodies as markdown */
  renderMarkdown?: boolean;
  /** Container className */
  className?: string;
  /** Individual comment className */
  commentClassName?: string;
}

/**
 * List of comments with empty state handling
 */
export const CommentList: React.FC<CommentListProps> = ({
  comments,
  emptyMessage = "No comments yet.",
  renderMarkdown = false,
  className = "pr-comments-list",
  commentClassName = "pr-comment",
}) => {
  if (comments.length === 0) {
    return <div className="empty-state empty-state--subtle">{emptyMessage}</div>;
  }
  
  return (
    <div className={className}>
      {comments.map((comment) => (
        <CommentDisplay
          key={comment.id}
          author={comment.author}
          createdAt={comment.created_at}
          body={comment.body}
          renderMarkdown={renderMarkdown}
          className={commentClassName}
        />
      ))}
    </div>
  );
};

export default CommentDisplay;
