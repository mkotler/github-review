/**
 * CommentStatus - Displays error, success, or warning status messages for comments
 * 
 * Used by both File Comment Panel and PR Comments View to show feedback
 * after comment operations.
 */

import React from "react";

export type CommentStatusType = "error" | "success" | "warning";

export interface CommentStatusProps {
  /** The type of status to display */
  type: CommentStatusType;
  /** The message to display */
  message: string;
  /** Optional className for additional styling */
  className?: string;
}

/**
 * Single status message component
 */
export const CommentStatus: React.FC<CommentStatusProps> = ({
  type,
  message,
  className = "",
}) => {
  return (
    <span className={`comment-status comment-status--${type}${className ? ` ${className}` : ""}`}>
      {message}
    </span>
  );
};

export interface CommentStatusGroupProps {
  /** Error message to display (takes priority) */
  error?: string | null;
  /** Success message to display */
  success?: string | null;
  /** Warning message to display */
  warning?: string | null;
  /** Whether to show success only when there's no error */
  hideSuccessOnError?: boolean;
  /** Container className */
  className?: string;
}

/**
 * Group of status messages - handles priority display logic
 * Shows error first, then warning, then success (unless hideSuccessOnError is true)
 */
export const CommentStatusGroup: React.FC<CommentStatusGroupProps> = ({
  error,
  success,
  warning,
  hideSuccessOnError = true,
  className = "comment-composer__status",
}) => {
  return (
    <div className={className}>
      {error && <CommentStatus type="error" message={error} />}
      {warning && <CommentStatus type="warning" message={warning} />}
      {(!error || !hideSuccessOnError) && success && (
        <CommentStatus type="success" message={success} />
      )}
    </div>
  );
};

export default CommentStatus;
