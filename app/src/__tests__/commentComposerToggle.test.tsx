import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  moveFullEditorDraftToInline,
  moveInlineDraftToFullEditor,
  type DraftsByFile,
  type FileDraft,
} from "../utils/commentDrafts";
import { useAutoOpenFileCommentComposer } from "../hooks/useAutoOpenFileCommentComposer";

const shouldDeleteFileDraft = (draft: FileDraft) => {
  const hasInline = !!draft.inline?.trim();
  const hasFileLevel = !!draft.fileLevel?.trim();
  const hasReplies = !!draft.reply && Object.values(draft.reply).some((v) => v.trim());
  return !hasInline && !hasFileLevel && !hasReplies;
};

describe("inline/full comment composer toggle", () => {
  describe("draft move helpers", () => {
    it("moves inline draft to full editor draft", () => {
      const prev: DraftsByFile = {
        "a.md": { inline: "hello", reply: { 1: "r" } },
      };

      const next = moveInlineDraftToFullEditor(prev, "a.md", "hello", shouldDeleteFileDraft);

      expect(next["a.md"]?.fileLevel).toBe("hello");
      expect(next["a.md"]?.inline).toBeUndefined();
      expect(next["a.md"]?.reply?.[1]).toBe("r");
    });

    it("moves full editor draft to inline draft", () => {
      const prev: DraftsByFile = {
        "a.md": { fileLevel: "full", reply: { 2: "r2" } },
      };

      const next = moveFullEditorDraftToInline(prev, "a.md", "full", shouldDeleteFileDraft);

      expect(next["a.md"]?.inline).toBe("full");
      expect(next["a.md"]?.fileLevel).toBeUndefined();
      expect(next["a.md"]?.reply?.[2]).toBe("r2");
    });

    it("cleans up file entry when draft becomes empty", () => {
      const prev: DraftsByFile = {
        "a.md": { inline: "x" },
      };

      const next = moveInlineDraftToFullEditor(prev, "a.md", "", shouldDeleteFileDraft);
      expect(next["a.md"]).toBeUndefined();
    });
  });

  describe("auto-open full editor on file change", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    });

    it("does not fight expand/minimize by reacting to drafts changes", () => {
      const setVisible = vi.fn();

      const { rerender } = renderHook(
        ({ path, drafts }) =>
          useAutoOpenFileCommentComposer({
            selectedFilePath: path,
            draftsByFile: drafts,
            setIsFileCommentComposerVisible: setVisible,
          }),
        {
          initialProps: { path: null as string | null, drafts: {} as DraftsByFile },
        },
      );

      // Switch to a file that has a full-editor draft -> close then reopen.
      rerender({ path: "a.md", drafts: { "a.md": { fileLevel: "full" } } });
      expect(setVisible).toHaveBeenCalledWith(false);
      vi.runAllTimers();
      expect(setVisible).toHaveBeenCalledWith(true);

      setVisible.mockClear();

      // Drafts change while staying on same file should NOT re-close/reopen.
      rerender({ path: "a.md", drafts: { "a.md": { fileLevel: "full", inline: "inline" } } });
      vi.runAllTimers();
      expect(setVisible).not.toHaveBeenCalled();
    });
  });
});
