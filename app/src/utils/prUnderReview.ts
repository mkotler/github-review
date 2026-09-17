export type UnderReviewOverrides = Record<string, boolean>;

export function getPullRequestKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`;
}

export function resolveUnderReviewState(
  override: boolean | undefined,
  signals: {
    hasLocalReview: boolean;
    hasPendingReview: boolean;
    viewedCount: number;
    totalCount: number;
  },
): boolean {
  if (override !== undefined) {
    return override;
  }

  return (
    signals.hasLocalReview ||
    signals.hasPendingReview ||
    (signals.viewedCount > 0 &&
      signals.totalCount > 0 &&
      signals.viewedCount < signals.totalCount)
  );
}
