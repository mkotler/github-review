/**
 * CommentThreadItem component for displaying collapsible comment threads.
 * Handles comment collapse/expand functionality and line navigation.
 */

import { useRef, useState, useEffect } from "react";
import type { PullRequestComment } from "../types";
import { parseLinePrefix } from "../utils/helpers";

/** Thread structure with parent comment and replies */
export interface CommentThread {
  parent: PullRequestComment;
  replies: PullRequestComment[];
}

export interface CommentThreadItemProps {
  /** The thread containing parent comment and replies */
  thread: CommentThread;
  /** Set of collapsed comment IDs */
  collapsedComments: Set<number>;
  /** Callback to update collapsed comments */
  setCollapsedComments: React.Dispatch<React.SetStateAction<Set<number>>>;
  /** Reference to the Monaco editor instance */
  editorRef: React.RefObject<any>;
  /** Render function for thread content */
  children: (
    allCommentsInThread: PullRequestComment[],
    isCollapsed: boolean,
    parentComment: PullRequestComment
  ) => React.ReactNode;
}

/**
 * Component for displaying a single comment thread with collapse functionality.
 * 
 * Features:
 * - Collapsible thread content for long comments
 * - Clickable line numbers to jump to code location
 * - Support for file-level comments with [Line #] prefix
 * - Auto-detects when collapse button should be shown (height > 150px)
 * 
 * @example
 * <CommentThreadItem
 *   thread={{ parent: comment, replies: [] }}
 *   collapsedComments={collapsed}
 *   setCollapsedComments={setCollapsed}
 *   editorRef={editorRef}
 * >
 *   {(comments, isCollapsed, parent) => (
 *     <div>{comments.map(c => <Comment key={c.id} comment={c} />)}</div>
 *   )}
 * </CommentThreadItem>
 */
export function CommentThreadItem({
  thread,
  collapsedComments,
  setCollapsedComments,
  editorRef,
  children,
}: CommentThreadItemProps) {
  const allCommentsInThread = [thread.parent, ...thread.replies];
  const parentComment = thread.parent;

  // Calculate collapse state based on parent comment
  const isCollapsed = collapsedComments.has(parentComment.id);
  
  const toggleCollapse = () => {
    setCollapsedComments((prev: Set<number>) => {
      const next = new Set(prev);
      if (next.has(parentComment.id)) {
        next.delete(parentComment.id);
      } else {
        next.add(parentComment.id);
      }
      return next;
    });
  };

  // Use ref to measure comment height and determine if collapse button should be shown
  const commentBodyRef = useRef<HTMLDivElement>(null);
  const [showCollapseButton, setShowCollapseButton] = useState(false);

  useEffect(() => {
    if (commentBodyRef.current && !isCollapsed) {
      const height = commentBodyRef.current.offsetHeight;
      setShowCollapseButton(height > 150);
    }
  }, [allCommentsInThread, isCollapsed]);

  /** Navigate editor to a specific line number */
  const navigateToLine = (lineNumber: number) => {
    if (editorRef.current && lineNumber) {
      const editor = editorRef.current;
      editor.revealLineInCenter(lineNumber);
      editor.setPosition({ lineNumber, column: 1 });
      editor.focus();
    }
  };

  return (
    <li className="comment-panel__item">
      <div className="comment-panel__item-header">
        <div className="comment-panel__item-header-info">
          {/* Direct line number from comment */}
          {parentComment.line && parentComment.line > 0 && (
            <span
              className="comment-panel__item-line comment-panel__item-line--clickable"
              onClick={() => navigateToLine(parentComment.line!)}
              title="Click to jump to line in editor"
            >
              #{parentComment.line}
            </span>
          )}
          {/* Handle file-level comments with [Line #] prefix from fallback mechanism */}
          {(!parentComment.line || parentComment.line === 0) && (() => {
            const parsed = parseLinePrefix(parentComment.body);
            if (parsed.hasLinePrefix && parsed.lineNumber) {
              return (
                <span
                  className="comment-panel__item-line comment-panel__item-line--clickable"
                  onClick={() => navigateToLine(parsed.lineNumber!)}
                  title="Click to jump to line in editor (file-level comment)"
                >
                  [#{parsed.lineNumber}]
                </span>
              );
            }
            return null;
          })()}
        </div>
        <div className="comment-panel__item-actions">
          {showCollapseButton && (
            <button
              type="button"
              className="comment-panel__item-collapse"
              onClick={toggleCollapse}
              aria-label={isCollapsed ? "Expand thread" : "Collapse thread"}
              title={isCollapsed ? "Expand" : "Collapse"}
            >
              {isCollapsed ? "▼" : "▲"}
            </button>
          )}
        </div>
      </div>
      <div
        ref={commentBodyRef}
        className={`comment-panel__item-body${isCollapsed ? " comment-panel__item-content--collapsed" : ""}`}
      >
        {children(allCommentsInThread, isCollapsed, parentComment)}
      </div>
    </li>
  );
}

export default CommentThreadItem;
