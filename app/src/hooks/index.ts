/**
 * Barrel export for custom hooks.
 */

export { useAuth } from "./useAuth";
export type { UseAuthOptions, UseAuthReturn } from "./useAuth";

export { useLocalStorage, useMRUList } from "./useLocalStorage";
export type { UseLocalStorageOptions } from "./useLocalStorage";

export { useFileNavigation } from "./useFileNavigation";
export type { UseFileNavigationReturn } from "./useFileNavigation";

export { usePaneZoom } from "./usePaneZoom";
export type { UsePaneZoomOptions, UsePaneZoomReturn } from "./usePaneZoom";

export { useViewedFiles } from "./useViewedFiles";
export type { ViewedFilesState, UseViewedFilesOptions, UseViewedFilesReturn } from "./useViewedFiles";

export { useTocSortedFiles } from "./useTocSortedFiles";
export type { UseTocSortedFilesOptions, UseTocSortedFilesResult } from "./useTocSortedFiles";

export { useFileContents } from "./useFileContents";
export type { UseFileContentsOptions, UseFileContentsResult, FileContents } from "./useFileContents";

export { useCommentFiltering } from "./useCommentFiltering";
export type { UseCommentFilteringOptions, UseCommentFilteringResult, CommentThread } from "./useCommentFiltering";

export { useMarkdownComponents } from "./useMarkdownComponents";
export type { UseMarkdownComponentsOptions, MarkdownComponents } from "./useMarkdownComponents";

export { useCommentMutations, createLocalReview } from "./useCommentMutations";
export type { 
  UseCommentMutationsOptions, 
  UseCommentMutationsReturn,
  SubmitCommentParams,
  DeleteReviewParams,
} from "./useCommentMutations";
