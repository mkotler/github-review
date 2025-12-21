/**
 * CommentComposer - Reusable comment form component
 * 
 * Handles textarea input, Ctrl+Enter submission, and status display.
 * Used by PR Comments View and general comment forms.
 * 
 * Note: The File Comment Panel has additional complexity (line numbers, side selection,
 * review workflow) that makes it difficult to fully extract, but this component
 * handles the common PR-level comment patterns.
 */

import React, { useCallback, forwardRef } from "react";
import { CommentStatusGroup } from "./CommentStatus";

export interface CommentComposerProps {
  /** Current draft value */
  value: string;
  /** Called when draft changes */
  onChange: (value: string) => void;
  /** Form submit handler */
  onSubmit: (e: React.FormEvent) => void;
  /** Whether submission is in progress */
  isPending?: boolean;
  /** Whether the form is disabled */
  disabled?: boolean;
  /** Disabled reason for tooltip */
  disabledReason?: string;
  /** Error message to display */
  error?: string | null;
  /** Success message to display */
  success?: string | null;
  /** Warning message to display */
  warning?: string | null;
  /** Placeholder text */
  placeholder?: string;
  /** Number of rows for textarea */
  rows?: number;
  /** Label text (optional) */
  label?: string;
  /** Label htmlFor (optional) */
  labelFor?: string;
  /** Submit button text */
  submitText?: string;
  /** Submit button text when pending */
  pendingText?: string;
  /** Additional className for the form */
  className?: string;
  /** Called when clearing error/success on input change */
  onClearStatus?: () => void;
  /** Optional form ref */
  formRef?: React.RefObject<HTMLFormElement>;
  /** Optional textarea ref */
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  /** ID for the textarea (for label association) */
  textareaId?: string;
  /** Additional content to render in the actions area (e.g., extra buttons) */
  extraActions?: React.ReactNode;
}

/**
 * Handle Ctrl+Enter keyboard shortcut for form submission
 */
export function handleCtrlEnter(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  action?: () => void
): void {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    action?.();
  }
}

/**
 * Reusable comment composer form
 */
export const CommentComposer = forwardRef<HTMLFormElement, CommentComposerProps>(
  (
    {
      value,
      onChange,
      onSubmit,
      isPending = false,
      disabled = false,
      disabledReason,
      error,
      success,
      warning,
      placeholder = "Share your thoughts…",
      rows = 4,
      label,
      labelFor,
      submitText = "Post comment",
      pendingText = "Posting…",
      className = "comment-composer",
      onClearStatus,
      formRef,
      textareaRef,
      textareaId,
      extraActions,
    },
    ref
  ) => {
    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value);
        onClearStatus?.();
      },
      [onChange, onClearStatus]
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        handleCtrlEnter(e, () => {
          if (!disabled && !isPending) {
            // Trigger form submit
            const form = (ref as React.RefObject<HTMLFormElement>)?.current ?? formRef?.current;
            form?.requestSubmit();
          }
        });
      },
      [disabled, isPending, ref, formRef]
    );

    const effectiveRef = (ref as React.RefObject<HTMLFormElement>) ?? formRef;

    return (
      <form
        className={className}
        onSubmit={onSubmit}
        ref={effectiveRef}
      >
        {label && (
          <label className="comment-composer__label" htmlFor={labelFor ?? textareaId}>
            {label}
          </label>
        )}
        <textarea
          id={textareaId}
          ref={textareaRef}
          value={value}
          placeholder={placeholder}
          onChange={handleChange}
          rows={rows}
          onKeyDown={handleKeyDown}
        />
        <div className="comment-composer__actions">
          <CommentStatusGroup
            error={error}
            success={success}
            warning={warning}
          />
          <div className="comment-composer__buttons">
            <button
              type="submit"
              className="comment-submit"
              disabled={disabled || isPending}
              title={disabledReason || undefined}
            >
              {isPending ? pendingText : submitText}
            </button>
            {extraActions}
          </div>
        </div>
      </form>
    );
  }
);

CommentComposer.displayName = "CommentComposer";

export default CommentComposer;
