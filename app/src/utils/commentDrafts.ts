export type FileDraft = {
  reply?: Record<number, string>;
  inline?: string;
  fileLevel?: string;
};

export type DraftsByFile = Record<string, FileDraft>;

export type ShouldDeleteFileDraft = (draft: FileDraft) => boolean;

export function moveInlineDraftToFullEditor(
  previous: DraftsByFile,
  filePath: string,
  inlineDraft: string,
  shouldDeleteFileDraft: ShouldDeleteFileDraft,
): DraftsByFile {
  const next: DraftsByFile = { ...previous };
  const existing = next[filePath] ?? {};
  const updated: FileDraft = { ...existing };

  if (inlineDraft.trim()) {
    updated.fileLevel = inlineDraft;
  } else {
    delete updated.fileLevel;
  }
  delete updated.inline;

  if (shouldDeleteFileDraft(updated)) {
    delete next[filePath];
  } else {
    next[filePath] = updated;
  }

  return next;
}

export function moveFullEditorDraftToInline(
  previous: DraftsByFile,
  filePath: string,
  fileLevelDraft: string,
  shouldDeleteFileDraft: ShouldDeleteFileDraft,
): DraftsByFile {
  const next: DraftsByFile = { ...previous };
  const existing = next[filePath] ?? {};
  const updated: FileDraft = { ...existing };

  if (fileLevelDraft.trim()) {
    updated.inline = fileLevelDraft;
  } else {
    delete updated.inline;
  }
  delete updated.fileLevel;

  if (shouldDeleteFileDraft(updated)) {
    delete next[filePath];
  } else {
    next[filePath] = updated;
  }

  return next;
}
