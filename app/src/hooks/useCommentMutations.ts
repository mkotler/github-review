/**
 * useCommentMutations - Custom hook for comment mutation operations
 * 
 * Consolidates all comment-related mutations (submit, edit, delete)
 * and review mutations (start, submit, delete) into a single hook.
 * 
 * ## Comment Types
 * - PR-level comments: General comments on the PR (issue comments API)
 * - File comments: Comments on specific files/lines (review comments API)
 * - Reply comments: Replies to existing file comments
 * 
 * ## Review Types
 * - Local reviews: Stored in local SQLite database, not yet submitted to GitHub
 * - GitHub reviews: Stored on GitHub as pending reviews
 * 
 * Both review types support:
 * - Starting a review
 * - Adding comments to the review
 * - Submitting all comments at once
 * - Deleting the review
 */

import { useMutation, useQueryClient, UseMutationResult } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import type {
  PullRequestComment,
  PullRequestReview,
  RepoRef,
  PullRequestDetail,
  FileDrafts,
  LocalComment,
} from "../types";
import * as offlineCache from "../offlineCache";
import { convertLocalComments } from "../utils/helpers";

// =============================================================================
// Types
// =============================================================================

export interface UseCommentMutationsOptions {
  /** Repository reference (owner/repo) */
  repoRef: RepoRef | null;
  /** Pull request details */
  prDetail: PullRequestDetail | null;
  /** Currently selected file path */
  selectedFilePath: string | null;
  /** Current pending review (GitHub or local) */
  pendingReview: PullRequestReview | null;
  /** All reviews for the PR */
  reviews: PullRequestReview[];
  /** Whether operating in local directory mode */
  isLocalDirectoryMode: boolean;
  /** Active local directory path */
  activeLocalDir: string | null;
  /** Authenticated user's login */
  authLogin: string | null;
  /** Selected PR number */
  selectedPr: number | null;
  /** Currently editing comment */
  editingComment: PullRequestComment | null;
}

/**
 * Unified comment submission parameters
 * Supports both PR-level comments and file/line comments
 */
export interface SubmitCommentParams {
  /** Comment body text */
  body: string;
  /** Comment type: "pr" for PR-level, "file" for file/line comments */
  type: "pr" | "file";
  /** For file comments: line number (null for file-level) */
  line?: number | null;
  /** For file comments: which side of the diff */
  side?: "RIGHT" | "LEFT";
  /** For file comments: "file" for file-level comments */
  subjectType?: "file" | null;
  /** Submission mode: "single" for immediate, "review" for batch */
  mode?: "single" | "review";
  /** Existing pending review ID (GitHub reviews) */
  pendingReviewId?: number | null;
  /** Parent comment ID for replies */
  inReplyTo?: number | null;
  /** Explicit file path (defaults to selectedFilePath) */
  filePath?: string;
}

/**
 * Parameters for deleting a review
 */
export interface DeleteReviewParams {
  /** Review ID */
  reviewId: number;
  /** Whether this is a local review (vs GitHub review) */
  isLocal: boolean;
  /** PR title for logging (optional, for local reviews) */
  prTitle?: string;
}

export interface UseCommentMutationsReturn {
  // Mutations
  /** Unified comment submission - handles both PR-level and file comments */
  submitCommentMutation: UseMutationResult<void, unknown, SubmitCommentParams, unknown>;
  /** Start a new local review */
  startReviewMutation: UseMutationResult<PullRequestReview, unknown, void, unknown>;
  /** Submit all review comments to GitHub */
  submitReviewMutation: UseMutationResult<void, unknown, void, unknown>;
  /** Delete a review (handles both local and GitHub reviews) */
  deleteReviewMutation: UseMutationResult<void, unknown, DeleteReviewParams, unknown>;
  /** Update an existing comment (local or GitHub) */
  updateCommentMutation: UseMutationResult<void, unknown, { commentId: number; body: string }, unknown>;
  /** Delete a comment (local or GitHub) */
  deleteCommentMutation: UseMutationResult<void, unknown, number, unknown>;
  
  // Local comments state
  localComments: PullRequestComment[];
  setLocalComments: React.Dispatch<React.SetStateAction<PullRequestComment[]>>;
  loadLocalComments: (reviewId?: number) => Promise<void>;
  
  // Status state
  commentError: string | null;
  setCommentError: React.Dispatch<React.SetStateAction<string | null>>;
  commentSuccess: boolean;
  setCommentSuccess: React.Dispatch<React.SetStateAction<boolean>>;
  fileCommentError: string | null;
  setFileCommentError: React.Dispatch<React.SetStateAction<string | null>>;
  fileCommentSuccess: boolean;
  setFileCommentSuccess: React.Dispatch<React.SetStateAction<boolean>>;
  fileCommentSubmittingMode: "single" | "review" | null;
  submitReviewDialogMessage: string | null;
  setSubmitReviewDialogMessage: React.Dispatch<React.SetStateAction<string | null>>;
  
  // Utility functions
  shouldDeleteFileDraft: (fileDrafts: FileDrafts | undefined) => boolean;
}

// =============================================================================
// Helper to create a local review object for UI
// =============================================================================

export function createLocalReview({
  prNumber,
  author,
  commitId,
}: {
  prNumber: number;
  author: string;
  commitId: string;
}): PullRequestReview {
  return {
    id: prNumber,
    state: "PENDING",
    author,
    submitted_at: null,
    body: null,
    html_url: null,
    commit_id: commitId,
    is_mine: true,
  };
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useCommentMutations(
  options: UseCommentMutationsOptions
): UseCommentMutationsReturn {
  const {
    repoRef,
    prDetail,
    selectedFilePath,
    pendingReview,
    reviews,
    isLocalDirectoryMode,
    activeLocalDir,
    authLogin,
    selectedPr,
    editingComment,
  } = options;

  const queryClient = useQueryClient();

  // ==========================================================================
  // State
  // ==========================================================================
  
  const [localComments, setLocalComments] = useState<PullRequestComment[]>([]);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentSuccess, setCommentSuccess] = useState(false);
  const [fileCommentError, setFileCommentError] = useState<string | null>(null);
  const [fileCommentSuccess, setFileCommentSuccess] = useState(false);
  const [fileCommentSubmittingMode, setFileCommentSubmittingMode] = useState<"single" | "review" | null>(null);
  const [submitReviewDialogMessage, setSubmitReviewDialogMessage] = useState<string | null>(null);

  // ==========================================================================
  // Load Local Comments
  // ==========================================================================

  const loadLocalComments = useCallback(async (reviewIdOverride?: number) => {
    // Use passed reviewId or fall back to pendingReview from options
    const effectiveReviewId = reviewIdOverride ?? pendingReview?.id;
    
    if (!repoRef || !prDetail || !effectiveReviewId) {
      setLocalComments([]);
      return;
    }
    try {
      const localCommentData = await invoke<LocalComment[]>("cmd_local_get_comments", {
        owner: repoRef.owner,
        repo: repoRef.repo,
        prNumber: prDetail.number,
      });
      
      // Convert to PullRequestComment format
      const converted = convertLocalComments(localCommentData, {
        author: authLogin ?? "You",
        reviewId: effectiveReviewId,
        isDraft: !isLocalDirectoryMode,
      });
      
      setLocalComments(converted);
    } catch (err) {
      console.error("Failed to load local comments:", err);
      setLocalComments([]);
    }
  }, [repoRef, prDetail, pendingReview, authLogin, isLocalDirectoryMode]);

  // ==========================================================================
  // Utility Functions
  // ==========================================================================

  const shouldDeleteFileDraft = useCallback((fileDrafts: FileDrafts | undefined): boolean => {
    if (!fileDrafts) return true;
    if (fileDrafts.inline && fileDrafts.inline.trim()) return false;
    if (fileDrafts.reply && Object.values(fileDrafts.reply).some(draft => draft && draft.trim())) return false;
    return true;
  }, []);

  // Helper to invalidate and refetch queries
  const invalidateAndRefetch = useCallback(async () => {
    if (repoRef && prDetail) {
      await offlineCache.clearPRCache(repoRef.owner, repoRef.repo, prDetail.number);
    }
    await queryClient.invalidateQueries({ 
      queryKey: ["pull-request", repoRef?.owner, repoRef?.repo, selectedPr, authLogin]
    });
  }, [repoRef, prDetail, selectedPr, authLogin, queryClient]);

  // ==========================================================================
  // Unified Comment Submission Mutation
  // Handles both PR-level comments and file/line comments
  // ==========================================================================

  const submitCommentMutation = useMutation({
    mutationFn: async (params: SubmitCommentParams) => {
      const { body, type } = params;
      
      if (!repoRef || !prDetail) {
        throw new Error("Select a pull request before commenting.");
      }

      // PR-level comment (issue comment API)
      if (type === "pr") {
        await invoke("cmd_submit_review_comment", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          number: prDetail.number,
          body,
        });
        return;
      }

      // File/line comment (review comment API)
      const {
        line = null,
        side = "RIGHT",
        subjectType = null,
        mode = "single",
        pendingReviewId = null,
        inReplyTo = null,
        filePath: explicitFilePath,
      } = params;

      const targetFilePath = explicitFilePath ?? selectedFilePath;
      if (!targetFilePath) {
        throw new Error("Select a file before commenting.");
      }

      // Local folder mode: always save to local review/log storage.
      if (isLocalDirectoryMode) {
        await invoke("cmd_local_add_comment", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          prNumber: prDetail.number,
          filePath: targetFilePath,
          lineNumber: line,
          side,
          body,
          commitId: prDetail.head_sha,
          inReplyToId: inReplyTo,
          localFolder: activeLocalDir ?? null,
        });
        return;
      }

      // For review mode (local storage)
      if (mode === "review" || pendingReviewId) {
        await invoke("cmd_local_add_comment", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          prNumber: prDetail.number,
          filePath: targetFilePath,
          lineNumber: line,
          side,
          body,
          commitId: prDetail.head_sha,
          inReplyToId: inReplyTo,
        });
      } else {
        // For single comments, use the GitHub API
        await invoke("cmd_submit_file_comment", {
          args: {
            owner: repoRef.owner,
            repo: repoRef.repo,
            number: prDetail.number,
            path: targetFilePath,
            body,
            commit_id: prDetail.head_sha,
            line,
            side: line !== null ? side : null,
            subject_type: subjectType,
            mode,
            pending_review_id: pendingReviewId,
            in_reply_to: inReplyTo,
          },
        });
      }
    },
    onMutate: async (params) => {
      if (params.type === "file") {
        setFileCommentSubmittingMode(params.mode ?? "single");
      }
    },
    onSuccess: async (_, params) => {
      if (params.type === "pr") {
        setCommentError(null);
        setCommentSuccess(true);
      } else {
        setFileCommentSuccess(true);
      }
      await invalidateAndRefetch();
    },
    onSettled: (_, __, params) => {
      if (params.type === "file") {
        setFileCommentSubmittingMode(null);
      }
    },
    onError: (error: unknown, params) => {
      const message = error instanceof Error ? error.message : "Failed to submit comment.";
      if (params.type === "pr") {
        setCommentError(message);
      } else {
        setFileCommentError(message);
      }
    },
  });

  // ==========================================================================
  // Start Review Mutation
  // ==========================================================================

  const startReviewMutation = useMutation({
    mutationFn: async () => {
      if (!repoRef || !prDetail) {
        throw new Error("Select a pull request before starting a review.");
      }

      await invoke("cmd_local_start_review", {
        owner: repoRef.owner,
        repo: repoRef.repo,
        prNumber: prDetail.number,
        commitId: prDetail.head_sha,
        body: null,
      });

      return createLocalReview({
        prNumber: prDetail.number,
        author: authLogin ?? "You",
        commitId: prDetail.head_sha,
      });
    },
    onSuccess: async (review) => {
      setFileCommentError(null);
      setFileCommentSuccess(false);
      void loadLocalComments(review.id);
    },
    onError: (error: unknown) => {
      console.error("Review mutation error:", error);
      const message = error instanceof Error ? error.message : "Failed to start review.";
      setFileCommentError(message);
      setFileCommentSuccess(false);
    },
  });

  // ==========================================================================
  // Submit Review Mutation
  // ==========================================================================

  const submitReviewMutation = useMutation({
    mutationFn: async () => {
      if (!repoRef || !prDetail) {
        throw new Error("Select a pull request before submitting.");
      }

      // Check if there's a pending review from GitHub (not a local draft)
      const isGithubPendingReview = pendingReview && 
        reviews.some((r: PullRequestReview) => r.id === pendingReview.id && r.state === "PENDING" && r.is_mine);
      
      if (isGithubPendingReview) {
        await invoke("cmd_submit_pending_review", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          number: prDetail.number,
          reviewId: pendingReview.id,
          event: "COMMENT",
          body: null,
        });
      } else {
        await invoke("cmd_submit_local_review", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          prNumber: prDetail.number,
          body: null,
          event: "COMMENT",
        });
      }
    },
    onSuccess: async () => {
      setLocalComments([]);
      setFileCommentError(null);
      setFileCommentSuccess(true);
      
      // Remove query to force fresh fetch
      queryClient.removeQueries({ 
        queryKey: ["pull-request", repoRef?.owner, repoRef?.repo, selectedPr, authLogin]
      });
    },
    onError: (error: unknown) => {
      const message = (() => {
        if (typeof error === "string") return error;
        if (error instanceof Error) return error.message;
        if (error && typeof error === "object" && "message" in error) {
          const maybeMessage = (error as { message?: unknown }).message;
          if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage;
          if (maybeMessage != null) return String(maybeMessage);
        }
        return "Failed to submit review.";
      })();

      const normalized = message.toLowerCase();
      const isLockedConversation =
        normalized.includes("cannot submit review comments because this pr conversation is locked") ||
        (normalized.includes("cannot submit review comments because pr #") && normalized.includes("is locked on github"));

      setFileCommentError(null);

      if (isLockedConversation) {
        setSubmitReviewDialogMessage(
          `Unable to submit review comments because this PR conversation is locked on GitHub. Ask a repo maintainer to "Unlock conversation" on PR #${prDetail?.number ?? "?"} and then retry.`,
        );
      } else {
        setSubmitReviewDialogMessage(message);
      }

      void loadLocalComments();
    },
  });

  // ==========================================================================
  // Delete Review Mutation (Unified - handles both local and GitHub reviews)
  // ==========================================================================

  const deleteReviewMutation = useMutation({
    mutationFn: async ({ reviewId, isLocal, prTitle }: DeleteReviewParams) => {
      if (!repoRef || !prDetail) {
        throw new Error("Select a pull request before deleting.");
      }

      if (isLocal) {
        // Delete local review (clears from SQLite and optionally saves to log file)
        await invoke("cmd_local_clear_review", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          prNumber: prDetail.number,
          prTitle: prTitle ?? prDetail.title ?? null,
        });
      } else {
        // Delete GitHub pending review
        await invoke("cmd_delete_review", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          prNumber: prDetail.number,
          reviewId,
        });
      }
    },
    onSuccess: async () => {
      setLocalComments([]);
      setFileCommentError(null);
      await invalidateAndRefetch();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to delete review.";
      setFileCommentError(message);
    },
  });

  // ==========================================================================
  // Update Comment Mutation
  // ==========================================================================

  const updateCommentMutation = useMutation({
    mutationFn: async ({ commentId, body }: { commentId: number; body: string }) => {
      const isLocalComment = editingComment?.url === "#" || !editingComment?.url;
      
      if (isLocalComment) {
        await invoke("cmd_local_update_comment", {
          commentId,
          body,
        });
      } else {
        if (!repoRef) throw new Error("Repository information not available");
        await invoke("cmd_github_update_comment", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          commentId,
          body,
        });
      }
    },
    onSuccess: async () => {
      setFileCommentError(null);
      setFileCommentSuccess(true);
      await invalidateAndRefetch();
      
      if (editingComment?.url === "#" || !editingComment?.url) {
        void loadLocalComments();
      }
    },
    onError: (error: unknown) => {
      console.error("Update comment error:", error);
      const message = error instanceof Error ? error.message : "Failed to update comment.";
      setFileCommentError(message);
    },
  });

  // ==========================================================================
  // Delete Comment Mutation
  // ==========================================================================

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: number) => {
      const isLocalComment = editingComment?.url === "#" || !editingComment?.url;
      
      if (isLocalComment) {
        await invoke("cmd_local_delete_comment", {
          commentId,
        });
      } else {
        if (!repoRef) throw new Error("Repository information not available");
        await invoke("cmd_github_delete_comment", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          commentId,
        });
      }
    },
    onSuccess: async () => {
      setFileCommentError(null);
      await invalidateAndRefetch();
      
      if (editingComment?.url === "#" || !editingComment?.url) {
        await loadLocalComments();
      }
    },
    onError: (error: unknown) => {
      console.error("Delete comment error:", error);
      const message = error instanceof Error ? error.message : "Failed to delete comment.";
      setFileCommentError(message);
    },
  });

  // ==========================================================================
  // Return
  // ==========================================================================

  return {
    // Mutations
    submitCommentMutation,
    startReviewMutation,
    submitReviewMutation,
    deleteReviewMutation,
    updateCommentMutation,
    deleteCommentMutation,
    
    // Local comments
    localComments,
    setLocalComments,
    loadLocalComments,
    
    // Status
    commentError,
    setCommentError,
    commentSuccess,
    setCommentSuccess,
    fileCommentError,
    setFileCommentError,
    fileCommentSuccess,
    setFileCommentSuccess,
    fileCommentSubmittingMode,
    submitReviewDialogMessage,
    setSubmitReviewDialogMessage,
    
    // Utilities
    shouldDeleteFileDraft,
  };
}

export default useCommentMutations;
