/**
 * useCommentFiltering hook - Manages comment filtering and thread grouping.
 * 
 * This hook handles:
 * - Filtering comments by file path
 * - Filtering out outdated comments based on user preference
 * - Sorting comments by line number (with [Line #] prefix extraction)
 * - Grouping comments into threads (parent + replies)
 * - Filtering by "my comments only"
 */

import { useMemo } from "react";
import type { PullRequestComment } from "../types";
import { parseLinePrefix } from "../utils/helpers";

export interface UseCommentFilteringOptions {
  /** All comments with review awareness (published + pending) */
  reviewAwareComments: PullRequestComment[];
  /** Currently selected file path (null for all files) */
  selectedFilePath: string | null;
  /** Whether to show outdated comments */
  showOutdatedComments: boolean;
  /** Whether to show only the current user's comments */
  showOnlyMyComments: boolean;
  /** Current user's login (for "my comments" filtering) */
  currentUserLogin: string | null;
}

export interface CommentThread {
  parent: PullRequestComment;
  replies: PullRequestComment[];
}

export interface UseCommentFilteringResult {
  /** Filtered and sorted comments for the selected file */
  fileComments: PullRequestComment[];
  /** Whether there are hidden outdated comments */
  hasHiddenOutdatedComments: boolean;
  /** Comments grouped into threads (parent + replies) */
  commentThreads: CommentThread[];
}

/**
 * Hook for filtering and organizing comments for display.
 */
export function useCommentFiltering(options: UseCommentFilteringOptions): UseCommentFilteringResult {
  const {
    reviewAwareComments,
    selectedFilePath,
    showOutdatedComments,
    showOnlyMyComments,
    currentUserLogin,
  } = options;

  // Filter comments by file and outdated status, then sort by line number
  const fileComments = useMemo(() => {
    let filtered = !selectedFilePath 
      ? reviewAwareComments 
      : reviewAwareComments.filter((comment: PullRequestComment) => comment.path === selectedFilePath);

    if (!showOutdatedComments) {
      filtered = filtered.filter((comment: PullRequestComment) => !comment.outdated);
    }
    
    // Sort by line number (comments without line numbers go to the end)
    // For file-level comments with [Line #] prefix, extract the line number for sorting
    return filtered.sort((a: PullRequestComment, b: PullRequestComment) => {
      // Extract effective line number for comment a
      let aLine = a.line;
      if (aLine === null || aLine === 0) {
        const aParsed = parseLinePrefix(a.body);
        if (aParsed.hasLinePrefix && aParsed.lineNumber) {
          aLine = aParsed.lineNumber;
        }
      }
      
      // Extract effective line number for comment b
      let bLine = b.line;
      if (bLine === null || bLine === 0) {
        const bParsed = parseLinePrefix(b.body);
        if (bParsed.hasLinePrefix && bParsed.lineNumber) {
          bLine = bParsed.lineNumber;
        }
      }
      
      if (aLine === null && bLine === null) return 0;
      if (aLine === null) return 1;
      if (bLine === null) return -1;
      return (aLine ?? 0) - (bLine ?? 0);
    });
  }, [reviewAwareComments, selectedFilePath, showOutdatedComments]);

  // Check if there are hidden outdated comments
  const hasHiddenOutdatedComments = useMemo(() => {
    if (showOutdatedComments) {
      return false;
    }
    const relevant = !selectedFilePath
      ? reviewAwareComments
      : reviewAwareComments.filter((comment: PullRequestComment) => comment.path === selectedFilePath);
    return relevant.some((comment: PullRequestComment) => comment.outdated);
  }, [reviewAwareComments, selectedFilePath, showOutdatedComments]);

  // Group comments into threads (parent + replies)
  const commentThreads = useMemo(() => {
    let threads: CommentThread[] = [];
    const replyMap = new Map<number, PullRequestComment[]>();
    
    // Group replies by parent comment ID
    fileComments.forEach((comment: PullRequestComment) => {
      if (comment.in_reply_to_id) {
        const replies = replyMap.get(comment.in_reply_to_id) || [];
        replies.push(comment);
        replyMap.set(comment.in_reply_to_id, replies);
      }
    });
    
    // Build threads with top-level comments as parents
    fileComments.forEach((comment: PullRequestComment) => {
      if (!comment.in_reply_to_id) {
        threads.push({
          parent: comment,
          replies: replyMap.get(comment.id) || []
        });
      }
    });

    if (showOnlyMyComments) {
      threads = threads.filter((thread) => 
        thread.parent.is_mine || (!!currentUserLogin && thread.parent.author === currentUserLogin)
      );
    }
    
    return threads;
  }, [fileComments, showOnlyMyComments, currentUserLogin]);

  return {
    fileComments,
    hasHiddenOutdatedComments,
    commentThreads,
  };
}
