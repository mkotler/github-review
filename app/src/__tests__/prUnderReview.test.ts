import { describe, expect, it } from "vitest";
import {
  getPullRequestKey,
  resolveUnderReviewState,
} from "../utils/prUnderReview";

describe("pull request under-review state", () => {
  it("builds a stable repository PR key", () => {
    expect(getPullRequestKey("owner", "repo", 42)).toBe("owner/repo#42");
  });

  it("infers under review when only some files are viewed", () => {
    expect(
      resolveUnderReviewState(undefined, {
        hasLocalReview: false,
        hasPendingReview: false,
        viewedCount: 1,
        totalCount: 2,
      }),
    ).toBe(true);
  });

  it("does not infer under review when the only file is viewed", () => {
    expect(
      resolveUnderReviewState(undefined, {
        hasLocalReview: false,
        hasPendingReview: false,
        viewedCount: 1,
        totalCount: 1,
      }),
    ).toBe(false);
  });

  it("allows an explicit star to include a PR", () => {
    expect(
      resolveUnderReviewState(true, {
        hasLocalReview: false,
        hasPendingReview: false,
        viewedCount: 0,
        totalCount: 1,
      }),
    ).toBe(true);
  });

  it("allows an explicit unstar to suppress inferred review state", () => {
    expect(
      resolveUnderReviewState(false, {
        hasLocalReview: true,
        hasPendingReview: true,
        viewedCount: 1,
        totalCount: 2,
      }),
    ).toBe(false);
  });
});
