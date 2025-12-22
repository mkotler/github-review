import { useEffect, useRef } from "react";
import type { DraftsByFile } from "../utils/commentDrafts";

export function useAutoOpenFileCommentComposer({
  selectedFilePath,
  draftsByFile,
  setIsFileCommentComposerVisible,
}: {
  selectedFilePath: string | null;
  draftsByFile: DraftsByFile;
  setIsFileCommentComposerVisible: (visible: boolean) => void;
}): void {
  // Keep latest drafts in a ref so file-switch effect doesn't re-run on every keystroke.
  const draftsByFileRef = useRef(draftsByFile);
  useEffect(() => {
    draftsByFileRef.current = draftsByFile;
  }, [draftsByFile]);

  const previousSelectedFilePathRef = useRef<string | null>(null);

  // Close file comment composer only when switching files, then reopen if the *new* file has a saved full-editor draft.
  useEffect(() => {
    const previous = previousSelectedFilePathRef.current;
    previousSelectedFilePathRef.current = selectedFilePath;

    if (previous === selectedFilePath) {
      return;
    }

    setIsFileCommentComposerVisible(false);

    if (selectedFilePath && draftsByFileRef.current[selectedFilePath]?.fileLevel) {
      const timer = window.setTimeout(() => {
        setIsFileCommentComposerVisible(true);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    return;
  }, [selectedFilePath, setIsFileCommentComposerVisible]);
}
