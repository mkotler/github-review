/* @refresh reset */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { Editor, DiffEditor } from "@monaco-editor/react";
import { useNetworkStatus } from "./useNetworkStatus";
import * as offlineCache from "./offlineCache";
import { useScrollSync } from "./useScrollSync.ts";
// Extracted modules
import type {
  AuthStatus,
  RepoRef,
  PullRequestSummary,
  PullRequestMetadata,
  PullRequestDetail,
  PullRequestFile,
  PullRequestComment,
  PullRequestReview,
  PrUnderReview,
  ScrollCacheEntry,
  ScrollCacheState,
  SourceRestoreState,
  LocalComment,
  ReviewMetadata,
} from "./types";
import {
  AUTH_QUERY_KEY,
  RETRY_CONFIG,
  PANE_ZOOM_STEP,
  SCROLL_CACHE_KEY,
  SCROLL_CACHE_TTL_MS,
  LEGACY_SCROLL_KEY,
  SOURCE_RESTORE_TIMEOUT_MS,
  SOURCE_RESTORE_MAX_ATTEMPTS,
  SOURCE_RESTORE_EPSILON,
  SOURCE_RESTORE_GRACE_MS,
  SOURCE_RESTORE_ACTIVATION_GRACE_MS,
  MIN_SIDEBAR_WIDTH,
  MIN_CONTENT_WIDTH,
} from "./constants";
import { loadScrollCache, pruneScrollCache } from "./utils/scrollCache";
import { parseLinePrefix, getImageMimeType, formatFileLabel, formatFileTooltip, formatFilePathWithLeadingEllipsis, isImageFile, isMarkdownFile, generateHeadingId, convertLocalComments, createLocalReview } from "./utils/helpers";
import { MemoizedAsyncImage, MermaidCode, CommentThreadItem, MediaViewer, ConfirmDialog } from "./components";
import type { MediaContent } from "./components";
import { usePaneZoom, useViewedFiles, useMRUList, useLocalStorage, useTocSortedFiles, useFileContents } from "./hooks";

type ScrollCacheSection = "fileList" | "fileComments" | "sourcePane";

// Global error handlers to catch crashes
if (typeof window !== "undefined") {
  const INSTALL_FLAG = "__ghreview_globalErrorHandlersInstalled";
  if ((window as any)[INSTALL_FLAG]) {
    // Avoid duplicate listeners/wrappers (e.g., Vite HMR can re-evaluate modules).
  } else {
    (window as any)[INSTALL_FLAG] = true;

  const MAX_LOG_CHARS = 2000;

  const truncateString = (value: string, maxChars: number) => {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}… [truncated ${value.length - maxChars} chars]`;
  };

  const sanitizeLogArg = (arg: any) => {
    if (typeof arg === "string") return truncateString(arg, MAX_LOG_CHARS);
    if (arg instanceof Error) {
      const message = typeof arg.message === "string" ? truncateString(arg.message, MAX_LOG_CHARS) : String(arg.message);
      const stack = typeof arg.stack === "string" ? truncateString(arg.stack, MAX_LOG_CHARS) : arg.stack;
      return {
        name: arg.name,
        message,
        stack: import.meta.env.DEV ? stack : undefined,
      };
    }
    if (arg && typeof arg === "object" && typeof (arg as any).message === "string") {
      return {
        ...(arg as any),
        message: truncateString((arg as any).message, MAX_LOG_CHARS),
      };
    }
    return arg;
  };

  // Store original console methods (only once)
  const consoleAny = console as any;
  const ORIGINAL_ERROR_KEY = "__ghreview_originalConsoleError";
  if (typeof consoleAny[ORIGINAL_ERROR_KEY] !== "function") {
    consoleAny[ORIGINAL_ERROR_KEY] = console.error;
  }
  const originalError: (...args: any[]) => void = consoleAny[ORIGINAL_ERROR_KEY];

  // Override console.error to keep logs readable (prevents massive HTML dumps)
  console.error = (...args: any[]) => {
    originalError.apply(console, args.map(sanitizeLogArg));
    if (import.meta.env.DEV && typeof (console as any).flush === "function") {
      (console as any).flush();
    }
  };

  window.addEventListener("error", (event) => {
    console.error("💥💥💥 UNHANDLED ERROR 💥💥💥");
    console.error("Message:", event.message);
    console.error("File:", event.filename, "Line:", event.lineno, "Col:", event.colno);
    if (event.error) {
      console.error("Error object:", event.error);
    }
    // Prevent default to ensure we see the error
    event.preventDefault();
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("💥💥💥 UNHANDLED PROMISE REJECTION 💥💥💥");
    console.error("Reason:", event.reason);
    if (import.meta.env.DEV) {
      console.error("Promise:", event.promise);
    }
    // Prevent default to ensure we see the error
    event.preventDefault();
  });

  // Catch errors in Tauri invoke calls
  const originalInvoke = invoke;
  (window as any).originalInvoke = originalInvoke;

  // Monitor for crashes only in development mode to save battery
  if (import.meta.env.DEV) {
    let lastHeartbeat = Date.now();
    setInterval(() => {
      const now = Date.now();
      if (now - lastHeartbeat > 10000) {
        console.error("💥 App may have frozen! No heartbeat for", Math.floor((now - lastHeartbeat) / 1000), "seconds");
      }
      lastHeartbeat = now;
    }, 5000);
  }
  }
}

const openDevtoolsWindow = () => {
  void invoke("cmd_open_devtools").catch((error) => {
    console.warn("Failed to open devtools", error);
  });
};

function App() {
  const { isOnline, markOffline, markOnline } = useNetworkStatus();
  const [repoRef, setRepoRef] = useState<RepoRef | null>(null);
  const [repoInput, setRepoInput] = useState("");
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoMRU, addRepoToMRU] = useMRUList('repo-mru', 10);
  const [showRepoMRU, setShowRepoMRU] = useState(false);
  const [prFileCounts, setPrFileCounts] = useLocalStorage<Record<string, number>>({
    key: 'pr-file-counts',
    defaultValue: {}
  });
  const [prTitles, setPrTitles] = useLocalStorage<Record<string, string>>({
    key: 'pr-titles',
    defaultValue: {}
  });
  const [prMetadata, setPrMetadata] = useLocalStorage<Record<string, { state: string; merged: boolean; locked?: boolean }>>({
    key: 'pr-metadata',
    defaultValue: {}
  });
  const [selectedPr, setSelectedPr] = useState<number | null>(null);
  const [activeLocalDir, setActiveLocalDir] = useState<string | null>(null);
  const [localDirMRU, addLocalDir] = useMRUList('local-dir-mru', 10);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileNavigationHistory, setFileNavigationHistory] = useState<string[]>([]);
  const [fileNavigationIndex, setFileNavigationIndex] = useState<number>(-1);
  const [isNavigatingFromHistory, setIsNavigatingFromHistory] = useState(false);
  const [showClosedPRs, setShowClosedPRs] = useState(false);
  const [prMode, setPrMode] = useState<"under-review" | "repo">("under-review");
  const [prSearchFilter, setPrSearchFilter] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentSuccess, setCommentSuccess] = useState(false);
  const [fileCommentDraft, setFileCommentDraft] = useState("");
  const [fileCommentLine, setFileCommentLine] = useState("");
  const [fileCommentMode, setFileCommentMode] = useState<"single" | "review">("single");
  const [fileCommentSide, setFileCommentSide] = useState<"RIGHT" | "LEFT">("RIGHT");
  const [fileCommentIsFileLevel, setFileCommentIsFileLevel] = useState(false);
  const [fileCommentError, setFileCommentError] = useState<string | null>(null);
  const [fileCommentSuccess, setFileCommentSuccess] = useState(false);
  const [fileCommentSubmittingMode, setFileCommentSubmittingMode] = useState<"single" | "review" | null>(null);
  const [replyingToCommentId, setReplyingToCommentId] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySuccess, setReplySuccess] = useState(false);
  const [isAddingInlineComment, setIsAddingInlineComment] = useState(false);
  const [inlineCommentDraft, setInlineCommentDraft] = useState("");
  const [inlineCommentLine, setInlineCommentLine] = useState("");
  const [inlineCommentError, setInlineCommentError] = useState<string | null>(null);
  const [draftsByFile, setDraftsByFile] = useState<Record<string, { reply?: Record<number, string>, inline?: string, fileLevel?: string }>>({})
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRepoPanelCollapsed, setIsRepoPanelCollapsed] = useState(false);
  const [isPrPanelCollapsed, setIsPrPanelCollapsed] = useState(false);
  const [isInlineCommentOpen, setIsInlineCommentOpen] = useState(false);
  const [isGeneralCommentOpen, setIsGeneralCommentOpen] = useState(false);
  const [collapsedComments, setCollapsedComments] = useState<Set<number>>(new Set());
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isPrFilterMenuOpen, setIsPrFilterMenuOpen] = useState(false);
  const [visibleFileCount, setVisibleFileCount] = useState(50);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(MIN_SIDEBAR_WIDTH);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [isFileCommentComposerVisible, setIsFileCommentComposerVisible] = useState(false);
  const [showOutdatedComments, setShowOutdatedComments] = useState(false);
  const [showOnlyMyComments, setShowOnlyMyComments] = useState(false);
  const [showCommentPanelMenu, setShowCommentPanelMenu] = useState(false);
  const [commentContextMenu, setCommentContextMenu] = useState<{ x: number; y: number; comment: PullRequestComment | null } | null>(null);
  const [, setReviewSummaryDraft] = useState("");
  const [, setReviewSummaryError] = useState<string | null>(null);
  const [pendingReviewOverride, setPendingReviewOverride] = useState<PullRequestReview | null>(null);
  const [localComments, setLocalComments] = useState<PullRequestComment[]>([]);
  const [submissionProgress, setSubmissionProgress] = useState<{ current: number; total: number; file: string } | null>(null);
  const commentPanelBodyRef = useRef<HTMLDivElement>(null);
  const commentPanelLastScrollTopRef = useRef<number | null>(null);
  const preserveScrollPositionRef = useRef<number | null>(null);
  const [isLoadingPendingComments, setIsLoadingPendingComments] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingComment, setEditingComment] = useState<PullRequestComment | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteReviewConfirm, setShowDeleteReviewConfirm] = useState(false);
  const [submitReviewDialogMessage, setSubmitReviewDialogMessage] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [maximizedPane, setMaximizedPane] = useState<'source' | 'preview' | 'media' | null>(null);
  const [savedSplitRatio, setSavedSplitRatio] = useState<string | null>(null);
  const [mediaViewerContent, setMediaViewerContent] = useState<MediaContent | null>(null);
  const [showFilesMenu, setShowFilesMenu] = useState(false);
  const [isPrCommentsView, setIsPrCommentsView] = useState(false);
  const [isPrCommentComposerOpen, setIsPrCommentComposerOpen] = useState(false);
  const [showAllFileTypes, setShowAllFileTypes] = useState(false);
  const [hideReviewedFiles, setHideReviewedFiles] = useState(false);
  const [pendingAnchorId, setPendingAnchorId] = useState<string | null>(null);
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const prFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const sourceMenuRef = useRef<HTMLDivElement | null>(null);
  const filesMenuRef = useRef<HTMLDivElement | null>(null);
  const commentPanelMenuRef = useRef<HTMLDivElement | null>(null);
  const commentContextMenuRef = useRef<HTMLDivElement | null>(null);
  const handleGlyphClickRef = useRef<((lineNumber: number) => void) | null>(null);
  const previewViewerRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<any>(null);
  const diffEditorRef = useRef<any>(null);
  const fileListScrollRef = useRef<HTMLUListElement | null>(null);
  const lastFileListScrollTopRef = useRef<number | null>(null);
  const isScrollingSyncRef = useRef(false);
  const previousBodyCursorRef = useRef<string | null>(null);
  const previousBodyUserSelectRef = useRef<string | null>(null);
  const hoveredLineRef = useRef<number | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const fileCommentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileCommentFormRef = useRef<HTMLFormElement | null>(null);
  const fileCommentPostButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileCommentReviewButtonRef = useRef<HTMLButtonElement | null>(null);
  const inlineCommentPostButtonRef = useRef<HTMLButtonElement | null>(null);
  const inlineCommentReviewButtonRef = useRef<HTMLButtonElement | null>(null);
  const replyPostButtonRef = useRef<HTMLButtonElement | null>(null);
  const replyReviewButtonRef = useRef<HTMLButtonElement | null>(null);
  const replyTextareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const replyActionsRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const prCommentFormRef = useRef<HTMLFormElement | null>(null);
  const generalCommentFormRef = useRef<HTMLFormElement | null>(null);
  const scrollCacheRef = useRef<ScrollCacheState>(loadScrollCache());
  const sourcePaneLastScrollTopRef = useRef<Record<string, number>>({});
  const skipNextSourceScrollRestoreRef = useRef(false);
  const skipSourceRestoreForRef = useRef<string | null>(null);
  const selectedFilePathRef = useRef<string | null>(null);
  const selectedFileCacheKeyRef = useRef<string | null>(null);
  const sourcePaneRestoreInFlightRef = useRef<SourceRestoreState | null>(null);
  const sourcePaneRestoreGraceRef = useRef<{ fileKey: string; target: number; expiresAt: number } | null>(null);
  const sourcePaneActivationHoldRef = useRef<{ fileKey: string; target: number; expiresAt: number } | null>(null);
  const sourcePaneReEnforcingRef = useRef<boolean>(false);
  const sourcePaneFileChangeInProgressRef = useRef<boolean>(false);
  const sourcePaneFrozenPositionsRef = useRef<Set<string>>(new Set());
  const repoIdentityRef = useRef<{ owner: string; repo: string } | null>(null);
  const selectedPrRef = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const hoveredPaneRef = useRef<'source' | 'preview' | null>(null);

  // Pane zoom management hook
  const {
    zoomLevel: paneZoomLevel,
    resetZoom: resetPaneZoom,
    adjustZoom: adjustPaneZoom,
    applyCodeZoom,
    isDefaultZoom: isDefaultPaneZoom,
  } = usePaneZoom({ editorRef, diffEditorRef, hoveredPaneRef });

  const isLocalRepo = repoRef?.owner === "__local__" && repoRef?.repo === "local";
  const isLocalDirectoryMode = Boolean(activeLocalDir);

  const formatLocalDirDisplay = useCallback((path: string) => {
    const normalized = path.replace(/\//g, "\\");
    const parts = normalized.split("\\").filter(Boolean);
    if (parts.length <= 2) {
      return normalized;
    }
    return `...\\${parts[parts.length - 2]}\\${parts[parts.length - 1]}`;
  }, []);

  const enterLocalDirectoryMode = useCallback((directory: string) => {
    setActiveLocalDir(directory);
    addLocalDir(directory);
    setRepoInput(formatLocalDirDisplay(directory));
    setRepoRef({ owner: "__local__", repo: "local" });
    setSelectedPr(1);
    setSelectedFilePath(null);
    setPrSearchFilter("");
    setPrMode("repo");
  }, [formatLocalDirDisplay, addLocalDir]);

  const exitLocalDirectoryMode = useCallback(() => {
    if (!isLocalDirectoryMode) return;
    setActiveLocalDir(null);
  }, [isLocalDirectoryMode]);

  const handlePickLocalFolder = useCallback(async () => {
    try {
      const result = await openDialog({ directory: true, multiple: false });
      const selected = typeof result === "string" ? result : null;
      if (!selected) {
        return;
      }
      enterLocalDirectoryMode(selected);
    } catch (error) {
      console.error("Failed to open folder picker", error);
    }
  }, [enterLocalDirectoryMode]);

  const persistScrollCache = useCallback((cache: ScrollCacheState) => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      // Use sessionStorage for all scroll positions (session-only)
      window.sessionStorage.setItem(SCROLL_CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
      // Silent fail
    }
  }, []);

  const saveScrollPosition = useCallback((section: ScrollCacheSection, identifier: string | null, rawPosition: number) => {
    const position = Math.max(0, Math.round(rawPosition));
    const now = Date.now();
    const cache = scrollCacheRef.current;

    switch (section) {
      case "fileList":
        if (!identifier) {
          break;
        }
        cache.fileList = cache.fileList ?? {};
        cache.fileList[identifier] = { position, updatedAt: now };
        break;
      case "fileComments":
        if (!identifier) {
          break;
        }
        cache.fileComments = cache.fileComments ?? {};
        cache.fileComments[identifier] = { position, updatedAt: now };
        break;
      case "sourcePane":
        if (!identifier) {
          break;
        }
        cache.sourcePane = cache.sourcePane ?? {};
        cache.sourcePane[identifier] = { position, updatedAt: now };
        break;
    }

    const pruned = pruneScrollCache(cache);
    scrollCacheRef.current = pruned;
    persistScrollCache(pruned);
  }, [persistScrollCache]);

  const persistSourceScrollPosition = useCallback((
    fileKey: string | null,
    rawPosition: number,
    context: "scroll" | "restore" | "fileChange",
    options?: { allowZero?: boolean },
  ) => {
    if (!fileKey) {
      return;
    }
    
    // If this file's position is frozen (during file change), reject updates
    if (sourcePaneFrozenPositionsRef.current.has(fileKey) && context === "scroll") {
      return;
    }
    
    let normalized = Math.max(0, Math.round(rawPosition));
    const lastKnown = sourcePaneLastScrollTopRef.current[fileKey];
    if (!options?.allowZero && normalized === 0 && lastKnown && lastKnown > 0) {
      normalized = lastKnown;
    }
    sourcePaneLastScrollTopRef.current[fileKey] = normalized;
    saveScrollPosition("sourcePane", fileKey, normalized);
  }, [saveScrollPosition]);

  const shouldSkipSourceScrollSnapshot = useCallback((fileKey: string, position: number) => {
    const pending = sourcePaneRestoreInFlightRef.current;
    if (pending && pending.fileKey === fileKey) {
      const delta = Math.abs(position - pending.target);
      if (delta <= SOURCE_RESTORE_EPSILON) {
        // Note: Don't clear restore in-flight here; let the RAF loop handle grace period setup
        return false;
      }
      const elapsed = Date.now() - pending.startedAt;
      if (elapsed < SOURCE_RESTORE_TIMEOUT_MS && pending.attempts < SOURCE_RESTORE_MAX_ATTEMPTS) {
        return true;
      }
      sourcePaneRestoreInFlightRef.current = null;
    }

    const grace = sourcePaneRestoreGraceRef.current;
    if (grace && grace.fileKey === fileKey) {
      if (Date.now() <= grace.expiresAt) {
        const isPrematureZero = position <= SOURCE_RESTORE_EPSILON && grace.target > SOURCE_RESTORE_EPSILON;
        if (isPrematureZero) {
          return true;
        }
        if (position > SOURCE_RESTORE_EPSILON) {
          sourcePaneRestoreGraceRef.current = null;
        }
      } else {
        sourcePaneRestoreGraceRef.current = null;
      }
    }

    const activationHold = sourcePaneActivationHoldRef.current;
    if (activationHold && activationHold.fileKey === fileKey) {
      if (Date.now() <= activationHold.expiresAt) {
        const isPrematureZero = position <= SOURCE_RESTORE_EPSILON && activationHold.target > SOURCE_RESTORE_EPSILON;
        if (isPrematureZero) {
          return true;
        }
        if (position > SOURCE_RESTORE_EPSILON) {
          sourcePaneActivationHoldRef.current = null;
        }
      } else {
        sourcePaneActivationHoldRef.current = null;
      }
    }

    return false;
  }, []);

  const syncPreviewToEditor = useCallback((editorInstance: any) => {
    const previewNode = previewViewerRef.current;
    if (!previewNode || !editorInstance || typeof editorInstance.getScrollTop !== "function") {
      return;
    }

    const editorScrollTop = editorInstance.getScrollTop();
    const scrollHeight = typeof editorInstance.getScrollHeight === "function"
      ? editorInstance.getScrollHeight()
      : 0;
    const layoutInfo = typeof editorInstance.getLayoutInfo === "function"
      ? editorInstance.getLayoutInfo()
      : null;
    const editorClientHeight = layoutInfo?.height ?? previewNode.clientHeight;
    const editorMaxScroll = Math.max(0, scrollHeight - editorClientHeight);
    const previewMaxScroll = Math.max(0, previewNode.scrollHeight - previewNode.clientHeight);

    let previewTarget = 0;
    if (editorMaxScroll > 0 && previewMaxScroll > 0) {
      const scrollPercentage = editorScrollTop / editorMaxScroll;
      previewTarget = scrollPercentage * previewMaxScroll;
    }

    // Prevent feedback loops for the non-markdown <pre> preview (it syncs back onScroll).
    isScrollingSyncRef.current = true;
    previewNode.scrollTop = Math.max(0, Math.min(previewMaxScroll, previewTarget));
    setTimeout(() => {
      isScrollingSyncRef.current = false;
    }, 50);
  }, []);

  const getScrollPosition = useCallback((section: ScrollCacheSection, identifier: string | null) => {
    const now = Date.now();
    const cache = scrollCacheRef.current;
    let entry: ScrollCacheEntry | undefined;

    if (section === "fileList") {
      if (identifier) {
        entry = cache.fileList?.[identifier];
      }
      if (!entry) {
        entry = cache.fileList?.[LEGACY_SCROLL_KEY];
      }
    } else if (section === "fileComments") {
      if (identifier) {
        entry = cache.fileComments?.[identifier];
      }
      if (!entry) {
        entry = cache.fileComments?.[LEGACY_SCROLL_KEY];
      }
    } else if (section === "sourcePane") {
      if (identifier) {
        entry = cache.sourcePane?.[identifier];
      }
    }

    if (!entry) {
      return null;
    }

    if (now - entry.updatedAt > SCROLL_CACHE_TTL_MS) {
      const pruned = pruneScrollCache(cache);
      scrollCacheRef.current = pruned;
      persistScrollCache(pruned);
      return null;
    }

    return entry.position;
  }, [persistScrollCache]);

  // Auto-focus textarea when comment composer opens
  useEffect(() => {
    if (isFileCommentComposerVisible && fileCommentTextareaRef.current) {
      // When editing an existing comment, prevent focus from scrolling
      // When creating a new comment, allow scrolling to make the composer visible
      fileCommentTextareaRef.current.focus({ preventScroll: editingCommentId !== null });
    }
  }, [isFileCommentComposerVisible, editingCommentId]);

  useEffect(() => {
    const pruned = pruneScrollCache(scrollCacheRef.current);
    scrollCacheRef.current = pruned;
    persistScrollCache(pruned);
  }, [persistScrollCache]);

  // Keep imperative ref for the selected file path in sync during render
  selectedFilePathRef.current = selectedFilePath;

  useEffect(() => {
    if (repoRef) {
      repoIdentityRef.current = { owner: repoRef.owner, repo: repoRef.repo };
    } else {
      repoIdentityRef.current = null;
    }
  }, [repoRef]);

  useEffect(() => {
    selectedPrRef.current = selectedPr;
  }, [selectedPr]);

  const repoScopeKey = useMemo(() => {
    if (!repoRef || selectedPr === null) {
      return null;
    }
    return `${repoRef.owner}/${repoRef.repo}#${selectedPr}`;
  }, [repoRef?.owner, repoRef?.repo, selectedPr]);

  const selectedFileCacheKey = useMemo(() => {
    if (!repoScopeKey || !selectedFilePath) {
      return null;
    }
    return `${repoScopeKey}:${selectedFilePath}`;
  }, [repoScopeKey, selectedFilePath]);


  useEffect(() => {
    if (replyingToCommentId === null) {
      return;
    }
    const replyTextarea = replyTextareaRefs.current[replyingToCommentId];
    if (replyTextarea) {
      replyTextarea.focus();
      const endPosition = replyTextarea.value.length;
      replyTextarea.setSelectionRange(endPosition, endPosition);
    }
  }, [replyingToCommentId]);

  useEffect(() => {
    if (!showCommentPanelMenu && !commentContextMenu) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (commentPanelMenuRef.current && !commentPanelMenuRef.current.contains(event.target as Node)) {
        setShowCommentPanelMenu(false);
      }
      if (commentContextMenuRef.current && !commentContextMenuRef.current.contains(event.target as Node)) {
        setCommentContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showCommentPanelMenu, commentContextMenu]);

  useEffect(() => {
    if (isFileCommentComposerVisible) {
      setShowCommentPanelMenu(false);
    }
  }, [isFileCommentComposerVisible]);

  const handleCtrlEnter = useCallback((
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    action?: () => void,
  ) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      action?.();
    }
  }, []);

  const triggerFileCommentSubmit = useCallback((mode?: "single" | "review") => {
    if (!fileCommentFormRef.current) {
      return;
    }
    if (mode === "review" && fileCommentReviewButtonRef.current) {
      fileCommentFormRef.current.requestSubmit(fileCommentReviewButtonRef.current);
      return;
    }
    if (mode === "single" && fileCommentPostButtonRef.current) {
      fileCommentFormRef.current.requestSubmit(fileCommentPostButtonRef.current);
      return;
    }
    fileCommentFormRef.current.requestSubmit();
  }, []);

  const triggerButtonClick = useCallback((button: HTMLButtonElement | null) => {
    if (button) {
      button.click();
    }
  }, []);

  const scrollPreviewToAnchor = useCallback((anchorId: string) => {
    if (!anchorId || !previewViewerRef.current) {
      return false;
    }
    const selector = `#${CSS.escape(anchorId)}`;
    const targetElement = previewViewerRef.current.querySelector(selector) as HTMLElement | null;
    if (!targetElement) {
      return false;
    }
    const previewPane = previewViewerRef.current;
    const targetRect = targetElement.getBoundingClientRect();
    const paneRect = previewPane.getBoundingClientRect();
    const scrollOffset = targetRect.top - paneRect.top + previewPane.scrollTop;
    previewPane.scrollTo({ top: scrollOffset, behavior: 'smooth' });
    return true;
  }, []);

  useEffect(() => {
    if (!pendingAnchorId) {
      return;
    }
    let rafId: number | null = null;
    let attempts = 0;
    const maxAttempts = 60;

    const tryScroll = () => {
      if (scrollPreviewToAnchor(pendingAnchorId)) {
        setPendingAnchorId(null);
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) {
        rafId = window.requestAnimationFrame(tryScroll);
      } else {
        setPendingAnchorId(null);
      }
    };

    rafId = window.requestAnimationFrame(tryScroll);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [pendingAnchorId, scrollPreviewToAnchor]);

  // Monitor memory usage periodically to detect leaks (only in development mode to save battery)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    
    const memoryInterval = setInterval(() => {
      if ((performance as any).memory) {
        const memory = (performance as any).memory;
        const usedMB = Math.round(memory.usedJSHeapSize / 1024 / 1024);
        const totalMB = Math.round(memory.totalJSHeapSize / 1024 / 1024);
        const limitMB = Math.round(memory.jsHeapSizeLimit / 1024 / 1024);
        
        console.log(`Memory: ${usedMB}MB / ${totalMB}MB (limit: ${limitMB}MB)`);
        
        // Warn if approaching memory limit
        if (usedMB > limitMB * 0.9) {
          console.warn(`⚠️ Memory usage high: ${usedMB}MB / ${limitMB}MB`);
        }
      }
    }, 30000); // Log every 30 seconds
    
    return () => clearInterval(memoryInterval);
  }, []);

  // Listen for comment submission progress events
  useEffect(() => {
    const unlisten = listen<{ current: number; total: number; file: string }>(
      'comment-submit-progress',
      (event) => {
        setSubmissionProgress(event.payload);
      }
    );
    
    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  const authQuery = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async () => {
      const status = await invoke<AuthStatus>("cmd_check_auth_status");
      
      // Update network status based on authentication result
      if (status.is_offline) {
        markOffline();
      } else if (status.is_authenticated) {
        markOnline();
      }
      
      // Cache auth status for instant reload
      localStorage.setItem('cached-auth-status', JSON.stringify(status));
      
      return status;
    },
    retry: 3, // Retry up to 3 times for transient network errors
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000), // Exponential backoff, max 5s
    staleTime: 5 * 60 * 1000, // Consider auth status fresh for 5 minutes
    refetchOnWindowFocus: true, // Re-check auth when window regains focus
    refetchOnReconnect: true, // Re-check auth when browser detects network reconnection
    initialData: () => {
      // Load cached auth status immediately
      const cached = localStorage.getItem('cached-auth-status');
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
  });

  // Re-validate authentication when coming back online
  useEffect(() => {
    if (isOnline && authQuery.data?.is_offline) {
      console.log('🔄 Network back online, re-validating authentication...');
      authQuery.refetch();
    }
  }, [isOnline, authQuery.data?.is_offline]);

  // Handle app wake from sleep/hibernation - refetch all queries
  useEffect(() => {
    let lastVisibilityChange = Date.now();
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const timeSinceLastChange = Date.now() - lastVisibilityChange;
        
        // If more than 5 minutes have passed, the system likely slept
        if (timeSinceLastChange > 5 * 60 * 1000) {
          console.log('🔄 System wake detected after sleep, refetching all queries...');
          queryClient.refetchQueries({ type: 'active' });
        }
      }
      lastVisibilityChange = Date.now();
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [queryClient]);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const status = await invoke<AuthStatus>("cmd_start_github_oauth");
      return status;
    },
    onSuccess: (status) => {
      queryClient.setQueryData(AUTH_QUERY_KEY, status);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await invoke("cmd_logout");
    },
    onSuccess: () => {
      queryClient.setQueryData<AuthStatus>(AUTH_QUERY_KEY, {
        is_authenticated: false,
        login: null,
        avatar_url: null,
        is_offline: false,
      });
      queryClient.removeQueries({ queryKey: ["pull-requests"] });
      queryClient.removeQueries({ queryKey: ["pull-request"] });
      setRepoRef(null);
      setSelectedPr(null);
      setSelectedFilePath(null);
    },
  });

  const prsUnderReviewQuery = useQuery({
    queryKey: ["prs-under-review"], // Remove login from key since it's local storage
    queryFn: async () => {
      const prs = await invoke<PrUnderReview[]>("cmd_get_prs_under_review");
      // Cache the results with timestamp in localStorage for instant display on next load
      const cacheData = {
        data: prs,
        timestamp: Date.now(),
      };
      localStorage.setItem('cached-prs-under-review', JSON.stringify(cacheData));
      return prs;
    },
    enabled: authQuery.data?.is_authenticated === true,
    ...RETRY_CONFIG,
    staleTime: 5 * 60 * 1000, // 5 minutes - local reviews don't change often
    placeholderData: () => {
      // Show cached data immediately while loading
      const cached = localStorage.getItem('cached-prs-under-review');
      if (cached) {
        try {
          const cacheData = JSON.parse(cached);
          return cacheData.data || cacheData; // Handle both old and new format
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
  });

  // Query all MRU repos for OPEN PRs with pending reviews
  const mruOpenPrsQueries = useQueries({
    queries: repoMRU.slice(0, 10).map(repoString => {
      const match = repoString.match(/^([^/]+)\/(.+)$/);
      if (!match) return { queryKey: ["mru-open-prs-skip"], enabled: false };
      
      const [, owner, repo] = match;
      const currentLogin = authQuery.data?.login;
      
      return {
        queryKey: ["mru-open-prs", owner, repo, currentLogin],
        queryFn: async () => {
          if (!currentLogin) {
            return [];
          }
          
          // Fetch open PRs with has_pending_review flag already populated by backend
          const prs = await invoke<PullRequestSummary[]>("cmd_list_pull_requests", {
            owner,
            repo,
            state: "open",
            currentLogin,
          });
          
          // Filter for PRs with pending reviews and convert to PrUnderReview format
          const prsWithPendingReviews: PrUnderReview[] = prs
            .filter(pr => pr.has_pending_review)
            .map(pr => ({
              owner,
              repo,
              number: pr.number,
              title: pr.title,
              has_local_review: false,
              has_pending_review: true,
              viewed_count: 0,
              total_count: pr.file_count,
              state: pr.state,
              merged: pr.merged,
            }));
          
          if (prsWithPendingReviews.length > 0) {
            console.log(`✓ Found ${prsWithPendingReviews.length} PR(s) with pending review in ${owner}/${repo} (open)`);
          }
          
          // Cache results in localStorage
          const cacheKey = `mru-open-prs-${owner}-${repo}`;
          const cacheData = {
            data: prsWithPendingReviews,
            timestamp: Date.now(),
          };
          localStorage.setItem(cacheKey, JSON.stringify(cacheData));
          
          return prsWithPendingReviews;
        },
        enabled: authQuery.data?.is_authenticated === true && !!currentLogin,
        ...RETRY_CONFIG,
        staleTime: 60 * 60 * 1000, // 1 hour
        gcTime: 60 * 60 * 1000, // Keep in cache for 1 hour
        placeholderData: () => {
          // Load from cache for instant display
          const cacheKey = `mru-open-prs-${owner}-${repo}`;
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            try {
              const cacheData = JSON.parse(cached);
              return cacheData.data || cacheData;
            } catch {
              return undefined;
            }
          }
          return undefined;
        },
      };
    }),
  });

  // Query all MRU repos for CLOSED PRs with pending reviews (only after open queries finish)
  const allOpenQueriesFinished = mruOpenPrsQueries.length > 0 && mruOpenPrsQueries.every(q => 
    (q.isFetched || q.isError) && !q.isLoading && !q.isFetching
  );
  const mruClosedPrsQueries = useQueries({
    queries: repoMRU.slice(0, 10).map(repoString => {
      const match = repoString.match(/^([^/]+)\/(.+)$/);
      if (!match) return { queryKey: ["mru-closed-prs-skip"], enabled: false };
      
      const [, owner, repo] = match;
      const currentLogin = authQuery.data?.login;
      
      return {
        queryKey: ["mru-closed-prs", owner, repo, currentLogin],
        queryFn: async () => {
          if (!currentLogin) {
            return [];
          }
          
          // Fetch closed PRs with has_pending_review flag already populated by backend
          const prs = await invoke<PullRequestSummary[]>("cmd_list_pull_requests", {
            owner,
            repo,
            state: "closed",
            currentLogin,
          });
          
          // Filter for PRs with pending reviews and convert to PrUnderReview format
          const prsWithPendingReviews: PrUnderReview[] = prs
            .filter(pr => pr.has_pending_review)
            .map(pr => ({
              owner,
              repo,
              number: pr.number,
              title: pr.title,
              has_local_review: false,
              has_pending_review: true,
              viewed_count: 0,
              total_count: pr.file_count,
              state: pr.state,
              merged: pr.merged,
            }));
          
          if (prsWithPendingReviews.length > 0) {
            console.log(`✓ Found ${prsWithPendingReviews.length} PR(s) with pending review in ${owner}/${repo} (closed)`);
          }
          
          // Cache results in localStorage
          const cacheKey = `mru-closed-prs-${owner}-${repo}`;
          const cacheData = {
            data: prsWithPendingReviews,
            timestamp: Date.now(),
          };
          localStorage.setItem(cacheKey, JSON.stringify(cacheData));
          
          return prsWithPendingReviews;
        },
        enabled: authQuery.data?.is_authenticated === true && !!currentLogin && allOpenQueriesFinished,
        ...RETRY_CONFIG,
        staleTime: 60 * 60 * 1000, // 1 hour
        gcTime: 60 * 60 * 1000, // Keep in cache for 1 hour
        placeholderData: () => {
          // Load from cache for instant display
          const cacheKey = `mru-closed-prs-${owner}-${repo}`;
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            try {
              const cacheData = JSON.parse(cached);
              return cacheData.data || cacheData;
            } catch {
              return undefined;
            }
          }
          return undefined;
        },
      };
    }),
  });

  const pullsQuery = useQuery({
    queryKey: ["pull-requests", repoRef?.owner, repoRef?.repo, showClosedPRs],
    queryFn: async () => {
      try {
        const data = await invoke<PullRequestSummary[]>("cmd_list_pull_requests", {
          owner: repoRef?.owner,
          repo: repoRef?.repo,
          state: showClosedPRs ? "all" : "open",
        });
        markOnline();
        return data;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isNetworkError = 
          errorMsg.includes('http error') ||
          errorMsg.includes('error sending request') ||
          errorMsg.includes('fetch') || 
          errorMsg.includes('network') || 
          errorMsg.includes('Failed to invoke') ||
          errorMsg.includes('connection') ||
          errorMsg.includes('timeout');
        
        if (isNetworkError) {
          console.log('🌐 Network error detected on PR list:', errorMsg);
          markOffline();
        }
        throw error;
      }
    },
    enabled: Boolean(repoRef && authQuery.data?.is_authenticated && !isLocalDirectoryMode && !isLocalRepo),
    ...RETRY_CONFIG,
  });

  const { refetch: refetchPulls } = pullsQuery;

  useEffect(() => {
    if (pullsQuery.isError) {
      console.error("Failed to load pull requests", pullsQuery.error);
    }
  }, [pullsQuery.isError, pullsQuery.error]);

  const pullDetailQuery = useQuery({
    queryKey: [
      "pull-request",
      repoRef?.owner,
      repoRef?.repo,
      selectedPr,
      authQuery.data?.login,
      activeLocalDir,
    ],
    queryFn: async () => {
      if (activeLocalDir) {
        return await invoke<PullRequestDetail>("cmd_load_local_directory", {
          directory: activeLocalDir,
        });
      }
      if (isLocalRepo) {
        throw new Error("No local folder selected. Use Signed in → Open Local Folder…");
      }
      const currentLogin = authQuery.data?.login ?? null;
      
      // Always try network first (to detect coming back online)
      try {
        const data = await invoke<PullRequestDetail>("cmd_get_pull_request", {
          owner: repoRef?.owner,
          repo: repoRef?.repo,
          number: selectedPr,
          currentLogin,
        });
        
        // Successful network request - mark online
        markOnline();
        
        // Cache the result
        if (repoRef && selectedPr) {
          await offlineCache.cachePRDetail(repoRef.owner, repoRef.repo, selectedPr, data);
          console.log(`💾 Cached PR #${selectedPr} for offline access`);
        }
        
        return data;
      } catch (error) {
        // Check if it's a network error (Tauri invoke errors or HTTP errors)
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isNetworkError = 
          errorMsg.includes('http error') ||
          errorMsg.includes('error sending request') ||
          errorMsg.includes('fetch') || 
          errorMsg.includes('network') || 
          errorMsg.includes('Failed to invoke') ||
          errorMsg.includes('connection') ||
          errorMsg.includes('timeout');
        
        if (isNetworkError) {
          console.log('🌐 Network error detected:', errorMsg);
          markOffline();
          
          // Try cache as fallback
          if (repoRef && selectedPr) {
            const cached = await offlineCache.getCachedPRDetail(repoRef.owner, repoRef.repo, selectedPr);
            if (cached) {
              console.log(`📦 Loaded PR #${selectedPr} from offline cache (after network error)`);
              return cached;
            }
          }
          throw new Error('Network unavailable and no cached data. Data will load when connection is restored.');
        }
        throw error;
      }
    },
    enabled:
      Boolean(
        (activeLocalDir && repoRef) ||
          (!isLocalRepo && repoRef && selectedPr && authQuery.data?.is_authenticated && authQuery.data?.login),
      ),
    staleTime: 0, // Always consider data stale to force refetch
    refetchOnMount: true, // Refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when window regains focus
    retry: (failureCount, error) => {
      // Don't retry if offline and no cache available
      if (!isOnline && error instanceof Error && error.message.includes('No cached data available')) {
        return false;
      }
      // Otherwise use normal retry logic
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  const { refetch: refetchPullDetail } = pullDetailQuery;
  const prDetail = pullDetailQuery.data;

  useEffect(() => {
    if (pullDetailQuery.isError) {
      console.error("Failed to load PR detail", pullDetailQuery.error);
    }
  }, [pullDetailQuery.isError, pullDetailQuery.error]);

  // Force fresh data when PR selection changes
  useEffect(() => {
    if (isLocalDirectoryMode) return;
    if (repoRef && selectedPr) {
      // Remove query when online to force fresh fetch, invalidate when offline to preserve cached data
      if (isOnline) {
        queryClient.removeQueries({ 
          queryKey: ["pull-request", repoRef.owner, repoRef.repo, selectedPr, authQuery.data?.login]
        });
      } else {
        queryClient.invalidateQueries({ 
          queryKey: ["pull-request", repoRef.owner, repoRef.repo, selectedPr, authQuery.data?.login]
        });
      }
    }
  }, [repoRef?.owner, repoRef?.repo, selectedPr, authQuery.data?.login, isOnline, queryClient]);

  // Auto-cache all files when PR opens (if online)
  useEffect(() => {
    if (isLocalDirectoryMode) return;
    if (!prDetail || !repoRef || !selectedPr || !isOnline) return;
    
    const cacheAllFiles = async () => {
      console.log(`🔄 Caching ${prDetail.files.length} files for offline access...`);
      let cached = 0;
      
      for (const file of prDetail.files) {
        try {
          const [headContent, baseContent] = await invoke<[string | null, string | null]>("cmd_get_file_contents", {
            owner: repoRef.owner,
            repo: repoRef.repo,
            filePath: file.path,
            baseSha: prDetail.base_sha,
            headSha: prDetail.head_sha,
            status: file.status,
            previousFilename: file.previous_filename ?? null,
          });
          
          await offlineCache.cacheFileContent(
            repoRef.owner,
            repoRef.repo,
            selectedPr,
            file.path,
            prDetail.head_sha,
            prDetail.base_sha,
            headContent,
            baseContent
          );
          cached++;
        } catch (error) {
          console.error(`Failed to cache file ${file.path}:`, error);
        }
      }
      
      console.log(`✅ Cached ${cached}/${prDetail.files.length} files for offline access`);
    };
    
    cacheAllFiles();
  }, [prDetail, repoRef, selectedPr, isOnline]);

  // Memoize ReactMarkdown components to prevent Mermaid from re-rendering
  const markdownComponents = useMemo(() => ({
    h1: ({children, ...props}: any) => {
      const id = generateHeadingId(String(children));
      return <h1 id={id} {...props}>{children}</h1>;
    },
    h2: ({children, ...props}: any) => {
      const id = generateHeadingId(String(children));
      return <h2 id={id} {...props}>{children}</h2>;
    },
    h3: ({children, ...props}: any) => {
      const id = generateHeadingId(String(children));
      return <h3 id={id} {...props}>{children}</h3>;
    },
    h4: ({children, ...props}: any) => {
      const id = generateHeadingId(String(children));
      return <h4 id={id} {...props}>{children}</h4>;
    },
    h5: ({children, ...props}: any) => {
      const id = generateHeadingId(String(children));
      return <h5 id={id} {...props}>{children}</h5>;
    },
    h6: ({children, ...props}: any) => {
      const id = generateHeadingId(String(children));
      return <h6 id={id} {...props}>{children}</h6>;
    },
    code: ({ className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : null;
      
      if (language === 'mermaid') {
        const mermaidContent = String(children).trim();
        return (
          <div 
            onClick={() => {
              setMediaViewerContent({ type: 'mermaid', content: mermaidContent });
              setMaximizedPane('media');
            }}
            className="mermaid-clickable"
            title="Click to view fullscreen"
          >
            <MermaidCode>{mermaidContent}</MermaidCode>
          </div>
        );
      }
      
      return <code className={className} {...props}>{children}</code>;
    },
  }), [setMediaViewerContent, setMaximizedPane]);

  const handleToggleRepoPanel = useCallback(() => {
    if (!repoRef) {
      setIsRepoPanelCollapsed(false);
      return;
    }
    setIsRepoPanelCollapsed((prev) => !prev);
  }, [repoRef]);

  const handleTogglePrPanel = useCallback(() => {
    setIsPrPanelCollapsed((prev) => !prev);
  }, []);

  const handleRefreshPulls = useCallback(async () => {
    if (repoRef && selectedPr) {
      // Remove query when online to force fresh fetch, invalidate when offline to preserve cached data
      if (isOnline) {
        queryClient.removeQueries({ 
          queryKey: ["pull-request", repoRef.owner, repoRef.repo, selectedPr, authQuery.data?.login]
        });
      } else {
        queryClient.invalidateQueries({ 
          queryKey: ["pull-request", repoRef.owner, repoRef.repo, selectedPr, authQuery.data?.login]
        });
      }
    }
    
    void refetchPulls();
    void refetchPullDetail();
  }, [repoRef, selectedPr, authQuery.data?.login, refetchPullDetail, refetchPulls, queryClient, isOnline]);

  const handleResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsResizing(true);
  }, []);

  const handleSidebarResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isSidebarCollapsed) {
        return;
      }
      event.preventDefault();
      setIsSidebarResizing(true);
    },
    [isSidebarCollapsed],
  );

  const comments = useMemo(() => {
    const allComments = prDetail?.comments ?? [];
    return allComments;
  }, [prDetail]);
  
  // Filter to get only PR-level (issue) comments, not file review comments
  const prLevelComments = useMemo(() => {
    const filtered = comments.filter((c: PullRequestComment) => !c.is_review_comment);
    return filtered;
  }, [comments]);

  const reviews = useMemo(() => prDetail?.reviews ?? [], [prDetail?.reviews]);
  const pendingReviewFromServer = useMemo(() => {
    const review = reviews.find(
      (item: PullRequestReview) => item.is_mine && item.state.toUpperCase() === "PENDING"
    );
    return review ?? null;
  }, [reviews]);

  // Only use pendingReviewOverride - user must explicitly click "Show Review" to load GitHub review
  const pendingReview = pendingReviewOverride;

  // Auto-update local review commit ID when PR is refreshed
  useEffect(() => {
    if (!prDetail || !repoRef || !selectedPr || !pendingReview) {
      console.log('🔄 Commit update skipped:', { 
        hasPrDetail: !!prDetail, 
        hasRepoRef: !!repoRef, 
        hasSelectedPr: !!selectedPr, 
        hasPendingReview: !!pendingReview 
      });
      return;
    }
    
    // Check if this is a local review (ID matches PR number)
    const isLocalReview = pendingReview.id === selectedPr;
    console.log('🔄 Checking for commit update:', {
      pendingReviewId: pendingReview.id,
      selectedPr,
      isLocalReview,
      pendingCommit: pendingReview.commit_id,
      currentCommit: prDetail.head_sha,
    });
    
    if (!isLocalReview) {
      console.log('🔄 Not a local review, skipping commit update');
      return;
    }
    
    // If the PR's head commit is different from the pending review's commit, update it
    if (prDetail.head_sha !== pendingReview.commit_id) {
      console.log(`🔄 Updating local review commit from ${pendingReview.commit_id} to ${prDetail.head_sha}`);
      
      invoke("cmd_local_update_review_commit", {
        owner: repoRef.owner,
        repo: repoRef.repo,
        prNumber: selectedPr,
        newCommitId: prDetail.head_sha,
      })
        .then(() => {
          console.log('✅ Local review commit ID updated');
          // Refresh the pending review data
          void prsUnderReviewQuery.refetch();
        })
        .catch((err) => {
          console.error('Failed to update review commit:', err);
        });
    } else {
      console.log('✅ Commit IDs already match, no update needed');
    }
  }, [prDetail, repoRef, selectedPr, pendingReview, prsUnderReviewQuery]);

  useEffect(() => {
    if (!pendingReviewOverride) {
      return;
    }
    // Skip validation for local reviews (negative IDs or missing from GitHub reviews list)
    // Local reviews won't be in the reviews array until they're submitted to GitHub
    const isLocalReview = pendingReviewOverride.id < 0 || !reviews.some((r: PullRequestReview) => r.id === pendingReviewOverride.id);
    if (isLocalReview) {
      return;
    }
    const matchingReview = reviews.find((item: PullRequestReview) => item.id === pendingReviewOverride.id);
    if (!matchingReview || matchingReview.state.toUpperCase() !== "PENDING") {
      setPendingReviewOverride(null);
    }
  }, [pendingReviewOverride, reviews]);

  useEffect(() => {
    setPendingReviewOverride(null);
  }, [prDetail?.number]);

  // Reset manual close flag when PR changes to allow auto-open for new PR
  useEffect(() => {
    // State reset handled by PR change
  }, [selectedPr]);

  // Check for existing local review when PR loads
  useEffect(() => {
    const checkForLocalReview = async () => {
      if (!repoRef || !prDetail || pendingReviewOverride || pendingReviewFromServer) {
        return;
      }

      try {
        const localCommentData = await invoke<LocalComment[]>("cmd_local_get_comments", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          prNumber: prDetail.number,
        });

        if (localCommentData.length > 0) {
  
          // Create a pending review object for the local review
          const localReview = createLocalReview({
            prNumber: prDetail.number,
            author: authQuery.data?.login ?? "You",
            commitId: prDetail.head_sha,
          });
          setPendingReviewOverride(localReview);

          // Refetch PRs under review to show this PR in the list
        await prsUnderReviewQuery.refetch();          // Convert and set local comments
          const converted = convertLocalComments(localCommentData, {
            author: authQuery.data?.login ?? "You",
            reviewId: prDetail.number,
            isDraft: !isLocalDirectoryMode,
          });
  
          setLocalComments(converted);
        }
      } catch (error) {
        console.error("Failed to check for local review:", error);
      }
    };

    void checkForLocalReview();
  }, [repoRef, prDetail, pendingReviewOverride, pendingReviewFromServer, authQuery.data?.login]);

  // Clear local review override if a GitHub pending review is detected
  // BUT only if the override is a LOCAL review (not the same as the server review)
  useEffect(() => {
    const isOverrideFromServer = pendingReviewOverride?.id === pendingReviewFromServer?.id;
    // Only clear if we have both reviews AND they are different (override is local)
    if (pendingReviewFromServer && pendingReviewOverride && !isOverrideFromServer) {
      setPendingReviewOverride(null);
      setLocalComments([]);
    }
  }, [pendingReviewFromServer, pendingReviewOverride]);

  // Load local comments when we have a pending review
  const loadLocalComments = useCallback(async (reviewId?: number) => {
    // Use passed reviewId or fall back to pendingReview from state
    const effectiveReviewId = reviewId ?? pendingReview?.id;
    
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
        author: authQuery.data?.login ?? "You",
        reviewId: effectiveReviewId,
        isDraft: !isLocalDirectoryMode,
      });

      setLocalComments(converted);
    } catch (error) {
      console.error("Failed to load local comments:", error);
      setLocalComments([]);
    }
  }, [repoRef, prDetail, pendingReview, authQuery.data?.login]);

  // Debug effect to track localComments changes


  // Load local comments only when we have a pendingReviewOverride (not from server)
  useEffect(() => {
    if (pendingReviewOverride && !pendingReviewFromServer) {
      // Only load local comments for locally-created reviews
      void loadLocalComments(pendingReviewOverride.id);
    } else if (!pendingReviewOverride) {
      setLocalComments([]);
    }
  }, [pendingReviewOverride?.id, pendingReviewFromServer]); // Only depend on the ID, not the whole callback

  // Automatically load pending review comments from GitHub when PR loads
  useEffect(() => {
    if (pendingReviewFromServer && repoRef && prDetail && !pendingReviewOverride) {
      // Only auto-load if we haven't manually opened the review yet
      const fetchPendingComments = async () => {
        try {
          const pendingComments = await invoke<PullRequestComment[]>("cmd_get_pending_review_comments", {
            owner: repoRef.owner,
            repo: repoRef.repo,
            prNumber: prDetail.number,
            reviewId: pendingReviewFromServer.id,
            currentLogin: authQuery.data?.login ?? null,
          });
          setLocalComments(pendingComments);
          // Set the pending review override so reviewAwareComments includes these comments
          setPendingReviewOverride(pendingReviewFromServer);
        } catch (error) {
          console.error("Failed to auto-fetch pending review comments:", error);
        }
      };
      void fetchPendingComments();
    }
  }, [pendingReviewFromServer?.id, repoRef, prDetail?.number, authQuery.data?.login, pendingReviewOverride]);

  const reviewAwareComments = useMemo(() => {
    if (pendingReview) {
      // Include ALL published comments + pending review comments (GitHub or local)
      // Published comments don't have review_id matching pending review
      const publishedComments = comments.filter((comment: PullRequestComment) => !comment.is_draft);
      const pendingGitHubComments = comments.filter((comment: PullRequestComment) => comment.review_id === pendingReview.id && comment.is_draft);
      const merged = [...publishedComments, ...pendingGitHubComments, ...localComments];
      return merged;
    }
    return comments;
  }, [comments, pendingReview, localComments]);

  const effectiveFileCommentMode: "single" | "review" = fileCommentIsFileLevel
    ? "single"
    : fileCommentMode;

  const hasLocalPendingReview = Boolean(pendingReview && !pendingReview.html_url);
  const fileCommentDefaultMode: "single" | "review" = hasLocalPendingReview && effectiveFileCommentMode === "review"
    ? "review"
    : "single";
  const inlineDefaultMode: "single" | "review" = hasLocalPendingReview ? "review" : "single";
  const replyDefaultMode = inlineDefaultMode;

  const files = prDetail?.files ?? [];

  // Viewed files management hook
  const {
    viewedFiles,
    isFileViewed,
    toggleFileViewed,
    markAllFilesAsViewed,
  } = useViewedFiles({
    owner: repoRef?.owner ?? null,
    repo: repoRef?.repo ?? null,
    selectedPr,
    allFilePaths: files.map((f: PullRequestFile) => f.path),
  });

  // Use TOC-based file sorting hook
  const { sortedFiles, filteredSortedFiles, tocFileNameMap, isLoadingTocContent } = useTocSortedFiles({
    files,
    repoRef,
    prDetail,
    selectedPr,
    isLocalDirectoryMode,
    isOnline,
    markOnline,
    markOffline,
    showAllFileTypes,
    hideReviewedFiles,
    isFileViewed,
  });

  const visibleFiles = useMemo(() => {
    return filteredSortedFiles.slice(0, visibleFileCount);
  }, [filteredSortedFiles, visibleFileCount]);

  // Reset visible file count when PR changes
  useEffect(() => {
    setVisibleFileCount(50);
  }, [selectedPr]);

  useEffect(() => {
    lastFileListScrollTopRef.current = null;
  }, [repoScopeKey]);

  useEffect(() => {
    if (!repoScopeKey) {
      return;
    }

    const persistSnapshot = (
      position: number,
      _context: "scroll" | "panel-hidden" | "cleanup" | "restore" | "attached",
      options?: { allowZero?: boolean },
    ) => {
      let normalized = Math.max(0, Math.round(position));
      const lastKnown = lastFileListScrollTopRef.current;

      if (!options?.allowZero && normalized === 0 && lastKnown && lastKnown > 0) {
        normalized = lastKnown;
      }

      lastFileListScrollTopRef.current = normalized;
      saveScrollPosition("fileList", repoScopeKey, normalized);
    };

    if (isPrCommentsView || isInlineCommentOpen) {
      const lastKnown = lastFileListScrollTopRef.current;
      if (lastKnown !== null) {
        persistSnapshot(lastKnown, "panel-hidden", { allowZero: true });
      }
      return;
    }

    const node = fileListScrollRef.current;
    if (!node) {
      return;
    }

    lastFileListScrollTopRef.current = node.scrollTop;

    const handleScroll = () => {
      persistSnapshot(node.scrollTop, "scroll", { allowZero: true });
    };

    node.addEventListener("scroll", handleScroll, { passive: true });

    let rafId: number | null = null;
    let attempts = 0;
    const maxAttempts = 8;

    const tryRestore = () => {
      const stored = getScrollPosition("fileList", repoScopeKey);
      if (stored !== null && Math.abs(node.scrollTop - stored) > 1) {
        node.scrollTop = stored;
        persistSnapshot(stored, "restore", { allowZero: true });
      }

      const needsRetry = stored !== null && Math.abs(node.scrollTop - stored) > 1;
      if (needsRetry && attempts < maxAttempts) {
        attempts += 1;
        rafId = window.requestAnimationFrame(tryRestore);
      } else {
        rafId = null;
        if (stored === null) {
          lastFileListScrollTopRef.current = node.scrollTop;
        }
      }
    };

    rafId = window.requestAnimationFrame(tryRestore);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      node.removeEventListener("scroll", handleScroll);
      persistSnapshot(node.scrollTop, "cleanup");
    };
  }, [
    isPrCommentsView,
    isInlineCommentOpen,
    repoScopeKey,
    visibleFiles.length,
    getScrollPosition,
    saveScrollPosition,
  ]);

  // Auto-select first file when filtered sorted files load
  useEffect(() => {
    if (filteredSortedFiles.length > 0 && !selectedFilePath) {
      setSelectedFilePath(filteredSortedFiles[0].path);
    }
  }, [filteredSortedFiles, selectedFilePath]);

  // Scroll selected file into view in the file list
  useEffect(() => {
    if (!selectedFilePath || !fileListScrollRef.current || isPrCommentsView || isInlineCommentOpen) {
      return;
    }

    // Find the button element for the selected file
    const fileListElement = fileListScrollRef.current;
    const fileButton = fileListElement.querySelector(
      `button.file-list__button--active`
    ) as HTMLElement;

    if (fileButton) {
      // Scroll the button into view with smooth behavior
      fileButton.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
      });
    }
  }, [selectedFilePath, isPrCommentsView, isInlineCommentOpen]);

  // Progressively load more file metadata in the background
  useEffect(() => {
    if (visibleFileCount >= filteredSortedFiles.length) {
      return;
    }

    const timer = setTimeout(() => {
      setVisibleFileCount(prev => Math.min(prev + 50, filteredSortedFiles.length));
    }, 100);

    return () => clearTimeout(timer);
  }, [visibleFileCount, filteredSortedFiles.length]);

  // Preload file contents in the background (one at a time, in order)
  useEffect(() => {
    if (isLocalDirectoryMode) {
      return;
    }

    if (!prDetail || visibleFiles.length === 0 || !repoRef) {
      return;
    }

    const preloadNextFile = async () => {
      for (const file of visibleFiles) {
        // Check if this file's contents are already in the cache
        const cacheKey = ["file-contents", repoRef.owner, repoRef.repo, file.path, prDetail.base_sha, prDetail.head_sha];
        const cached = queryClient.getQueryData(cacheKey);
        
        if (!cached) {
          // Prefetch this file's contents
          await queryClient.prefetchQuery({
            queryKey: cacheKey,
            queryFn: async () => {
              const [headContent, baseContent] = await invoke<[string | null, string | null]>("cmd_get_file_contents", {
                owner: repoRef.owner,
                repo: repoRef.repo,
                filePath: file.path,
                baseSha: prDetail.base_sha,
                headSha: prDetail.head_sha,
                status: file.status,
              });
              return { headContent, baseContent };
            },
            staleTime: Infinity,
            ...RETRY_CONFIG,
          });
          // Small delay between fetches to avoid overwhelming the backend
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    };

    preloadNextFile();
  }, [visibleFiles, prDetail, repoRef, queryClient]);

  const openInlineComment = useCallback(async (filePath?: string) => {
    const targetFilePath = filePath ?? selectedFilePath;
    if (!targetFilePath) {
      return;
    }
    setIsSidebarCollapsed(false);
    setIsInlineCommentOpen(true);
    setFileCommentError(null);
    setFileCommentSuccess(false);
    setIsFileCommentComposerVisible(false);
    
    // Load local comments if they exist
    if (repoRef && prDetail) {
      try {
        const localCommentData = await invoke<LocalComment[]>("cmd_local_get_comments", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          prNumber: prDetail.number,
        });

        if (localCommentData.length > 0) {
          // Create or find a local review object
          let localReview = reviews.find((r: PullRequestReview) => r.id === prDetail.number);
          if (!localReview) {
            // Create a fake review object for local comments
            localReview = {
              id: prDetail.number,
              state: "PENDING",
              author: authQuery.data?.login ?? "You",
              submitted_at: null,
              body: null,
              html_url: null,
              commit_id: prDetail.head_sha,
              is_mine: true,
            };
          }
          
          // Convert to PullRequestComment format
          const converted = convertLocalComments(localCommentData, {
            author: authQuery.data?.login ?? "You",
            reviewId: localReview.id,
            isDraft: !isLocalDirectoryMode,
          });
          setLocalComments(converted);
          setPendingReviewOverride(localReview);
          
          // Refetch PRs under review to show this PR in the list
          await prsUnderReviewQuery.refetch();
        }
      } catch (error) {
        console.error("Failed to load local comments:", error);
      }
    }
  }, [selectedFilePath, repoRef, prDetail, pendingReview, authQuery.data?.login, prsUnderReviewQuery]);

  const closeInlineComment = useCallback(() => {
    setIsInlineCommentOpen(false);
    setFileCommentError(null);
    setFileCommentSuccess(false);
    setIsFileCommentComposerVisible(false);
  }, []);

  const toggleUserMenu = useCallback(() => {
    setIsUserMenuOpen((previous) => !previous);
  }, []);

  const closeUserMenu = useCallback(() => {
    setIsUserMenuOpen(false);
  }, []);

  const togglePrFilterMenu = useCallback(() => {
    setIsPrFilterMenuOpen((previous) => !previous);
  }, []);

  const closePrFilterMenu = useCallback(() => {
    setIsPrFilterMenuOpen(false);
  }, []);

  const handleOpenDevtools = useCallback(() => {
    closeUserMenu();
    openDevtoolsWindow();
  }, [closeUserMenu]);

  const handleOpenLogFolder = useCallback(async () => {
    closeUserMenu();
    try {
      await invoke('cmd_open_log_folder');
    } catch (error) {
      console.error('Failed to open log folder:', error);
    }
  }, [closeUserMenu]);

  const handleLogout = useCallback(() => {
    closeUserMenu();
    logoutMutation.mutate();
  }, [closeUserMenu, logoutMutation]);
  const pullsErrorMessage = pullsQuery.isError
    ? pullsQuery.error instanceof Error
      ? pullsQuery.error.message
      : "Failed to load pull requests."
    : null;

  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
    setIsSidebarResizing(false);
    closeUserMenu();
  }, [closeUserMenu]);

  // File content loading with offline caching
  const { selectedFile } = useFileContents({
    selectedFilePath,
    repoRef,
    prDetail,
    selectedPr,
    isLocalDirectoryMode,
    isOnline,
    markOnline,
    markOffline,
    activeLocalDir,
  });

  // Memoize markdown preview content to prevent re-rendering on every keystroke
  const memoizedMarkdownContent = useMemo(() => {
    if (!selectedFile || !isMarkdownFile(selectedFile)) {
      return null;
    }
    return selectedFile.head_content ?? "";
  }, [selectedFile?.head_content, selectedFile?.path]);

  // Anchor-based scroll synchronization between source and preview
  const getEditorForScrollSync = useCallback(() => {
    if (showDiff) {
      return diffEditorRef.current?.getModifiedEditor?.() ?? null;
    }
    return editorRef.current;
  }, [showDiff]);
  
  const {
    syncSourceToPreview,
    syncPreviewToSource,
    rebuildAnchors,
    triggerInitialSync,
    scheduleSourceScrollEndSync,
    schedulePreviewScrollEndSync,
  } = useScrollSync({
    sourceContent: selectedFile?.head_content ?? null,
    previewRef: previewViewerRef,
    getEditor: getEditorForScrollSync,
    isEnabled: isMarkdownFile(selectedFile),
    zoomLevel: paneZoomLevel,
  });

  // Monaco event subscriptions are created once in `onMount` and can otherwise capture stale
  // versions of these callbacks (e.g., after switching between non-markdown and markdown files).
  // Keep refs to the latest implementations so scroll sync stays live in PR mode.
  const syncSourceToPreviewRef = useRef(syncSourceToPreview);
  const scheduleSourceScrollEndSyncRef = useRef(scheduleSourceScrollEndSync);
  useEffect(() => {
    syncSourceToPreviewRef.current = syncSourceToPreview;
  }, [syncSourceToPreview]);
  useEffect(() => {
    scheduleSourceScrollEndSyncRef.current = scheduleSourceScrollEndSync;
  }, [scheduleSourceScrollEndSync]);

  const isMarkdownSelectedRef = useRef(false);
  useEffect(() => {
    isMarkdownSelectedRef.current = isMarkdownFile(selectedFile);
  }, [selectedFile, isMarkdownFile]);

  const syncPreviewToEditorRef = useRef(syncPreviewToEditor);
  useEffect(() => {
    syncPreviewToEditorRef.current = syncPreviewToEditor;
  }, [syncPreviewToEditor]);

  const syncPreviewToSourceRef = useRef(syncPreviewToSource);
  useEffect(() => {
    syncPreviewToSourceRef.current = syncPreviewToSource;
  }, [syncPreviewToSource]);

  const syncPreviewToSourceNonMarkdown = useCallback((previewScrollTop: number) => {
    const previewNode = previewViewerRef.current;
    if (!previewNode) return;

    const editor = getEditorForScrollSync();
    if (!editor) return;

    const previewMaxScroll = Math.max(0, previewNode.scrollHeight - previewNode.clientHeight);
    const scrollPercent = previewMaxScroll > 0 ? previewScrollTop / previewMaxScroll : 0;

    const editorScrollHeight = editor.getScrollHeight?.() ?? 0;
    const layoutInfo = editor.getLayoutInfo?.();
    const editorClientHeight = layoutInfo?.height ?? 0;
    const editorMaxScroll = Math.max(0, editorScrollHeight - editorClientHeight);
    const targetEditorScrollTop = scrollPercent * editorMaxScroll;

    editor.setScrollTop?.(Math.max(0, Math.min(editorMaxScroll, targetEditorScrollTop)));
  }, [getEditorForScrollSync]);

  // Trigger initial sync when file changes (after scroll position is restored)
  useEffect(() => {
    if (isMarkdownFile(selectedFile) && selectedFile?.head_content) {
      // Delay to ensure preview has rendered and source scroll is restored
      const timeout = setTimeout(() => {
        triggerInitialSync();
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [selectedFilePath, selectedFile, isMarkdownFile, triggerInitialSync]);

  // Rebuild anchors when zoom changes
  useEffect(() => {
    if (isMarkdownFile(selectedFile)) {
      const timeout = setTimeout(() => {
        rebuildAnchors();
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [paneZoomLevel, selectedFile, isMarkdownFile, rebuildAnchors]);

  // CRITICAL: Eagerly capture scroll position BEFORE React unmounts Monaco editor
  // This must run synchronously in useLayoutEffect before any DOM changes
  useLayoutEffect(() => {
    const currentFileKey = selectedFileCacheKeyRef.current;
    const newFileKey = selectedFileCacheKey;
    
    // If file is changing and we have a current file, capture its scroll position NOW
    if (currentFileKey && newFileKey && currentFileKey !== newFileKey) {
      const currentPosition = sourcePaneLastScrollTopRef.current[currentFileKey];
      
      if (typeof currentPosition === "number" && currentPosition > SOURCE_RESTORE_EPSILON) {
        // FREEZE this file's position to prevent corruption from spurious scroll events
        sourcePaneFrozenPositionsRef.current.add(currentFileKey);
        persistSourceScrollPosition(currentFileKey, currentPosition, "fileChange", { allowZero: false });
        
      } else if (currentPosition === undefined || currentPosition === 0) {
        // Ref doesn't have position - check localStorage for previous session
        const cacheEntry = scrollCacheRef.current.sourcePane?.[currentFileKey];
        if (cacheEntry && Date.now() - cacheEntry.updatedAt <= SCROLL_CACHE_TTL_MS && cacheEntry.position > SOURCE_RESTORE_EPSILON) {
          // FREEZE this file's position
          sourcePaneFrozenPositionsRef.current.add(currentFileKey);
          persistSourceScrollPosition(currentFileKey, cacheEntry.position, "fileChange", { allowZero: false });
        }
      }
      
      // Set flag to block scroll events during transition
      sourcePaneFileChangeInProgressRef.current = true;
    }
  }, [selectedFileCacheKey, persistSourceScrollPosition]);

  useEffect(() => {
    if (!selectedFilePath || !selectedFileCacheKey) {
      selectedFileCacheKeyRef.current = null;
      sourcePaneRestoreInFlightRef.current = null;
      sourcePaneRestoreGraceRef.current = null;
      sourcePaneActivationHoldRef.current = null;
      return;
    }

    const previousFileKey = selectedFileCacheKeyRef.current;
    const isFileChange = previousFileKey !== selectedFileCacheKey;

    if (isFileChange) {
      // Note: file change flag and eager save already handled in useLayoutEffect above
      // to run synchronously before Monaco unmounts
      
      let cachedPosition: number | null = null;
      if (typeof sourcePaneLastScrollTopRef.current[selectedFileCacheKey] === "number") {
        cachedPosition = sourcePaneLastScrollTopRef.current[selectedFileCacheKey];
      } else {
        const cacheEntry = scrollCacheRef.current.sourcePane?.[selectedFileCacheKey];
        if (cacheEntry && Date.now() - cacheEntry.updatedAt <= SCROLL_CACHE_TTL_MS) {
          cachedPosition = cacheEntry.position;
        }
      }

      if (typeof cachedPosition === "number" && cachedPosition > SOURCE_RESTORE_EPSILON) {
        sourcePaneActivationHoldRef.current = {
          fileKey: selectedFileCacheKey,
          target: cachedPosition,
          expiresAt: Date.now() + SOURCE_RESTORE_ACTIVATION_GRACE_MS,
        };
      } else {
        sourcePaneActivationHoldRef.current = null;
      }
    }

    selectedFileCacheKeyRef.current = selectedFileCacheKey;

    let attempts = 0;
    const maxAttempts = 20;
    let rafId: number | null = null;
    let settleRafId: number | null = null;

    const cancelRafs = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      if (settleRafId !== null) {
        window.cancelAnimationFrame(settleRafId);
      }
      sourcePaneRestoreInFlightRef.current = null;
    };

    const enforceRestore = (editorInstance: any) => {
      const pending = sourcePaneRestoreInFlightRef.current;
      if (!pending || pending.fileKey !== selectedFileCacheKey) {
        return;
      }
      const currentTop = editorInstance.getScrollTop?.() ?? 0;
      const delta = Math.abs(currentTop - pending.target);
      if (delta <= SOURCE_RESTORE_EPSILON) {
        sourcePaneRestoreInFlightRef.current = null;
        const graceExpiresAt = Date.now() + SOURCE_RESTORE_GRACE_MS;
        sourcePaneRestoreGraceRef.current = {
          fileKey: pending.fileKey,
          target: pending.target,
          expiresAt: graceExpiresAt,
        };
        
        // Clear file change flag and unfreeze positions now that restore is complete
        sourcePaneFileChangeInProgressRef.current = false;
        if (previousFileKey) {
          sourcePaneFrozenPositionsRef.current.delete(previousFileKey);
        }
        
        // Keep enforcing scroll position during grace period
        let graceCheckCount = 0;
        const graceInterval = setInterval(() => {
          graceCheckCount++;
          const now = Date.now();
          const currentFileKey = selectedFileCacheKeyRef.current;
          
          // Stop if file changed or grace expired
          if (currentFileKey !== pending.fileKey || now > graceExpiresAt) {
            clearInterval(graceInterval);
            return;
          }
          
          // Check if scroll position drifted
          const actualTop = editorInstance.getScrollTop?.() ?? 0;
          const drift = Math.abs(actualTop - pending.target);
          if (drift > SOURCE_RESTORE_EPSILON) {
            editorInstance.setScrollTop?.(pending.target);
            syncPreviewToEditor(editorInstance);
          }
        }, 50); // Check every 50ms
        
        return;
      }
      if (
        Date.now() - pending.startedAt > SOURCE_RESTORE_TIMEOUT_MS ||
        pending.attempts >= SOURCE_RESTORE_MAX_ATTEMPTS
      ) {
        sourcePaneRestoreInFlightRef.current = null;
        sourcePaneFileChangeInProgressRef.current = false;
        // Unfreeze previous file on timeout
        if (previousFileKey) {
          sourcePaneFrozenPositionsRef.current.delete(previousFileKey);
        }
        console.warn("Source restore timeout", {
          selectedFilePath,
          target: pending.target,
          actual: currentTop,
        });
        return;
      }
      pending.attempts += 1;
      editorInstance.setScrollTop?.(pending.target);
      syncPreviewToEditor(editorInstance);
      settleRafId = window.requestAnimationFrame(() => enforceRestore(editorInstance));
    };

    const tryRestore = () => {
      const editorInstance = showDiff
        ? diffEditorRef.current?.getModifiedEditor?.()
        : editorRef.current;

      if (!editorInstance) {
        if (attempts < maxAttempts) {
          attempts += 1;
          rafId = window.requestAnimationFrame(tryRestore);
        }
        return;
      }

      if (
        skipSourceRestoreForRef.current &&
        skipSourceRestoreForRef.current !== selectedFilePath
      ) {
        skipNextSourceScrollRestoreRef.current = false;
        skipSourceRestoreForRef.current = null;
      }

      if (
        skipNextSourceScrollRestoreRef.current &&
        skipSourceRestoreForRef.current === selectedFilePath
      ) {
        skipNextSourceScrollRestoreRef.current = false;
        skipSourceRestoreForRef.current = null;
        return;
      }

      const stored = getScrollPosition("sourcePane", selectedFileCacheKey);
      const target = stored ?? 0;
      const currentTop = editorInstance.getScrollTop?.() ?? 0;
      const shouldEnforceRestore =
        target > SOURCE_RESTORE_EPSILON ||
        Math.abs(currentTop - target) > SOURCE_RESTORE_EPSILON;

      if (shouldEnforceRestore) {
        // Do NOT clear activation hold - let it continue protecting during restore
        sourcePaneRestoreInFlightRef.current = {
          fileKey: selectedFileCacheKey,
          target,
          startedAt: Date.now(),
          attempts: 0,
        };
      } else {
        // No restore needed, can safely clear activation hold
        sourcePaneActivationHoldRef.current = null;
        sourcePaneRestoreInFlightRef.current = null;
      }

      editorInstance.setScrollTop(target);
      syncPreviewToEditor(editorInstance);
      if (shouldEnforceRestore) {
        settleRafId = window.requestAnimationFrame(() => enforceRestore(editorInstance));
      }
      persistSourceScrollPosition(selectedFileCacheKey, target, "restore", { allowZero: true });
    };

    tryRestore();

    return () => {
      cancelRafs();
    };
  }, [
    selectedFilePath,
    showDiff,
    selectedFile?.head_content,
    selectedFile?.base_content,
    selectedFileCacheKey,
    getScrollPosition,
    persistSourceScrollPosition,
    syncPreviewToEditor,
  ]);

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
    let threads: Array<{ parent: PullRequestComment; replies: PullRequestComment[] }> = [];
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
      threads = threads.filter((thread) => thread.parent.is_mine || (!!authQuery.data?.login && thread.parent.author === authQuery.data.login));
    }
    
    return threads;
  }, [fileComments, showOnlyMyComments, authQuery.data?.login]);

  useEffect(() => {
    if (!selectedFileCacheKey) {
      return;
    }

    const panel = commentPanelBodyRef.current;
    if (!panel) {
      return;
    }

    if (!isInlineCommentOpen) {
      return;
    }

    const storedPosition = getScrollPosition("fileComments", selectedFileCacheKey);

    const persistSnapshot = (
      position: number,
      _context: "scroll" | "cleanup" | "restore",
      options?: { allowZero?: boolean },
    ) => {
      let normalized = Math.max(0, Math.round(position));
      const lastKnown = commentPanelLastScrollTopRef.current ?? storedPosition ?? null;
      if (!options?.allowZero && normalized === 0 && lastKnown && lastKnown > 0) {
        normalized = lastKnown;
      }
      commentPanelLastScrollTopRef.current = normalized;
      saveScrollPosition("fileComments", selectedFileCacheKey, normalized);
    };

    let suppressScrollPersistence = true;

    const handleScroll = () => {
      if (suppressScrollPersistence) {
        return;
      }
      persistSnapshot(panel.scrollTop, "scroll", { allowZero: true });
    };

    panel.addEventListener("scroll", handleScroll, { passive: true });

    if (storedPosition !== null) {
      commentPanelLastScrollTopRef.current = storedPosition;
    } else {
      commentPanelLastScrollTopRef.current = panel.scrollTop;
    }

    let rafId: number | null = null;
    let attempts = 0;
    const maxAttempts = 8;

    const settleRestore = () => {
      if (!suppressScrollPersistence) {
        return;
      }
      suppressScrollPersistence = false;
    };

    const restore = () => {
      // Check if we should preserve a specific scroll position (e.g., after delete)
      const preservePosition = preserveScrollPositionRef.current;
      const stored = preservePosition !== null ? preservePosition : storedPosition;
      
      if (stored !== null && Math.abs(panel.scrollTop - stored) > 1) {
        panel.scrollTop = stored;
        if (Math.abs(panel.scrollTop - stored) <= 1) {
          persistSnapshot(stored, "restore", { allowZero: true });
        }
      }

      const needsRetry = stored !== null && Math.abs(panel.scrollTop - stored) > 1;
      if (needsRetry && attempts < maxAttempts) {
        attempts += 1;
        rafId = window.requestAnimationFrame(restore);
      } else {
        rafId = null;
        settleRestore();
        if (stored === null) {
          persistSnapshot(panel.scrollTop, "restore", { allowZero: true });
        }
        // Clear the preserve flag after restoration is complete
        preserveScrollPositionRef.current = null;
      }
    };

    rafId = window.requestAnimationFrame(restore);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      suppressScrollPersistence = false;
      panel.removeEventListener("scroll", handleScroll);
      persistSnapshot(panel.scrollTop, "cleanup");
    };
  }, [
    selectedFileCacheKey,
    isInlineCommentOpen,
    commentThreads.length,
    getScrollPosition,
    saveScrollPosition,
  ]);

  // Force scroll position preservation after delete
  useEffect(() => {
    if (preserveScrollPositionRef.current !== null && commentPanelBodyRef.current) {
      const targetScroll = preserveScrollPositionRef.current;
      commentPanelBodyRef.current.scrollTop = targetScroll;
      
      // Also update the stored position
      if (selectedFileCacheKey) {
        saveScrollPosition("fileComments", selectedFileCacheKey, targetScroll);
        commentPanelLastScrollTopRef.current = targetScroll;
      }
      
      // Run again after a delay to catch any late scroll resets
      const timer = setTimeout(() => {
        if (commentPanelBodyRef.current && preserveScrollPositionRef.current !== null) {
          commentPanelBodyRef.current.scrollTop = preserveScrollPositionRef.current;
        }
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [commentThreads.length, isFileCommentComposerVisible, selectedFileCacheKey, saveScrollPosition]);

  const shouldShowFileCommentComposer = isFileCommentComposerVisible;
  const noCommentsDueToFilters = fileComments.length === 0 && (showOnlyMyComments || hasHiddenOutdatedComments);
  const formattedRepo = activeLocalDir
    ? formatLocalDirDisplay(activeLocalDir)
    : repoRef
      ? `${repoRef.owner}/${repoRef.repo}`
      : "";
  const formattedRepoTitle = activeLocalDir ? activeLocalDir : formattedRepo;

  // Load drafts from localStorage on mount
  useEffect(() => {
    if (repoRef && selectedPr) {
      const key = `drafts_${repoRef.owner}_${repoRef.repo}_${selectedPr}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        try {
          const loadedDrafts = JSON.parse(stored);
          // Clean up empty drafts
          const cleanedDrafts: Record<string, { reply?: Record<number, string>, inline?: string }> = {};
          for (const [filePath, fileDraft] of Object.entries(loadedDrafts)) {
            const cleaned: { reply?: Record<number, string>, inline?: string } = {};
            
            // Type guard for fileDraft
            if (fileDraft && typeof fileDraft === 'object') {
              // Keep inline draft only if non-empty
              if ('inline' in fileDraft && typeof fileDraft.inline === 'string' && fileDraft.inline.trim()) {
                cleaned.inline = fileDraft.inline;
              }
              
              // Keep reply drafts only if non-empty
              if ('reply' in fileDraft && fileDraft.reply && typeof fileDraft.reply === 'object') {
                const nonEmptyReplies: Record<number, string> = {};
                for (const [commentId, replyText] of Object.entries(fileDraft.reply)) {
                  if (replyText && typeof replyText === 'string' && replyText.trim()) {
                    nonEmptyReplies[Number(commentId)] = replyText;
                  }
                }
                if (Object.keys(nonEmptyReplies).length > 0) {
                  cleaned.reply = nonEmptyReplies;
                }
              }
            }
            
            // Only keep file entry if it has any non-empty drafts
            if (cleaned.inline || cleaned.reply) {
              cleanedDrafts[filePath] = cleaned;
            }
          }
          setDraftsByFile(cleanedDrafts);
        } catch (e) {
          console.error('Failed to parse stored drafts:', e);
        }
      }
    }
  }, [repoRef, selectedPr]);

  // Save drafts to localStorage whenever they change (debounced to avoid lag during typing)
  useEffect(() => {
    if (!repoRef || !selectedPr) return;
    
    const key = `drafts_${repoRef.owner}_${repoRef.repo}_${selectedPr}`;
    
    // Debounce localStorage writes to improve typing performance
    const timeoutId = setTimeout(() => {
      localStorage.setItem(key, JSON.stringify(draftsByFile));
    }, 500); // Wait 500ms after last change before saving
    
    return () => clearTimeout(timeoutId);
  }, [draftsByFile, repoRef, selectedPr]);

  // Automatically restore inline draft when file with draft is selected
  useEffect(() => {
    if (selectedFilePath && draftsByFile[selectedFilePath]?.inline) {
      const draft = draftsByFile[selectedFilePath].inline;
      if (draft && !isAddingInlineComment) {
        setInlineCommentDraft(draft);
      }
    }
  }, [selectedFilePath, draftsByFile, isAddingInlineComment]);

  // Save inline comment draft with debounce to improve typing performance
  useEffect(() => {
    if (!selectedFilePath || !isAddingInlineComment) return;
    
    const timeoutId = setTimeout(() => {
      setDraftsByFile(prev => ({
        ...prev,
        [selectedFilePath]: {
          ...prev[selectedFilePath],
          inline: inlineCommentDraft || undefined
        }
      }));
    }, 300); // Debounce 300ms
    
    return () => clearTimeout(timeoutId);
  }, [selectedFilePath, inlineCommentDraft, isAddingInlineComment]);

  // Save reply draft with debounce to improve typing performance
  useEffect(() => {
    if (!selectedFilePath || replyingToCommentId === null) return;
    
    const timeoutId = setTimeout(() => {
      if (replyDraft) {
        setDraftsByFile(prev => ({
          ...prev,
          [selectedFilePath]: {
            ...prev[selectedFilePath],
            reply: {
              ...(prev[selectedFilePath]?.reply || {}),
              [replyingToCommentId]: replyDraft
            }
          }
        }));
      } else {
        // Clear the reply draft if empty
        setDraftsByFile(prev => {
          const updated = { ...prev };
          if (updated[selectedFilePath]?.reply) {
            const newReply = { ...updated[selectedFilePath].reply };
            delete newReply[replyingToCommentId];
            updated[selectedFilePath] = { ...updated[selectedFilePath], reply: newReply };
          }
          return updated;
        });
      }
    }, 300); // Debounce 300ms
    
    return () => clearTimeout(timeoutId);
  }, [selectedFilePath, replyDraft, replyingToCommentId]);

  // Save file-level comment draft with debounce to improve typing performance
  useEffect(() => {
    if (!selectedFilePath || !isFileCommentComposerVisible) return;
    
    const timeoutId = setTimeout(() => {
      setDraftsByFile(prev => ({
        ...prev,
        [selectedFilePath]: {
          ...prev[selectedFilePath],
          fileLevel: fileCommentDraft
        }
      }));
    }, 300); // Debounce 300ms
    
    return () => clearTimeout(timeoutId);
  }, [selectedFilePath, fileCommentDraft, isFileCommentComposerVisible]);

  // Restore file-level draft when switching files or opening composer
  useEffect(() => {
    if (isFileCommentComposerVisible && selectedFilePath) {
      const draft = draftsByFile[selectedFilePath]?.fileLevel;
      if (draft !== undefined && !editingCommentId) {
        setFileCommentDraft(draft);
      } else if (!editingCommentId && !draftsByFile[selectedFilePath]?.fileLevel) {
        // Clear the draft if there's no saved draft for this file
        setFileCommentDraft("");
      }
    }
  }, [isFileCommentComposerVisible, selectedFilePath, draftsByFile, editingCommentId]);

  useEffect(() => {
    if (repoRef) {
      setIsRepoPanelCollapsed(true);
    } else {
      setIsRepoPanelCollapsed(false);
    }
  }, [repoRef]);

  useEffect(() => {
    if (selectedPr) {
      setIsPrPanelCollapsed(true);
    } else {
      setIsPrPanelCollapsed(false);
    }
  }, [selectedPr]);

  // Reset navigation history when PR changes
  useEffect(() => {
    setFileNavigationHistory([]);
    setFileNavigationIndex(-1);
  }, [selectedPr]);

  // Track file navigation history (only when user navigates, not from history buttons)
  useEffect(() => {
    if (!selectedFilePath || isNavigatingFromHistory) {
      if (isNavigatingFromHistory) {
        setIsNavigatingFromHistory(false);
      }
      return;
    }

    setFileNavigationHistory(prev => {
      // If we're in the middle of history, truncate forward history
      const newHistory = fileNavigationIndex >= 0 
        ? prev.slice(0, fileNavigationIndex + 1)
        : prev;
      
      // Don't add duplicate if the last entry is the same file
      if (newHistory.length > 0 && newHistory[newHistory.length - 1] === selectedFilePath) {
        return prev;
      }
      
      // Add new entry
      const updated = [...newHistory, selectedFilePath];
      setFileNavigationIndex(updated.length - 1);
      return updated;
    });
  }, [selectedFilePath, isNavigatingFromHistory, fileNavigationIndex]);

  useEffect(() => {
    if (filteredSortedFiles.length > 0) {
      setSelectedFilePath((current) => {
        if (current && filteredSortedFiles.some((file) => file.path === current)) {
          return current;
        }
        return filteredSortedFiles[0].path;
      });
    } else {
      setSelectedFilePath(null);
    }
  }, [filteredSortedFiles]);

  useEffect(() => {
    if (commentSuccess) {
      const timeout = window.setTimeout(() => setCommentSuccess(false), 2400);
      return () => window.clearTimeout(timeout);
    }
  }, [commentSuccess]);

  useEffect(() => {
    if (!pendingReview) {
      setReviewSummaryDraft("");
      setReviewSummaryError(null);
    }
  }, [pendingReview]);

  useEffect(() => {
    // Reset scroll position when file changes
    if (editorRef.current) {
      editorRef.current.setScrollTop(0);
    }
    if (previewViewerRef.current) {
      previewViewerRef.current.scrollTop = 0;
    }
  }, [selectedFilePath]);

  useEffect(() => {
    if (!isUserMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!userMenuRef.current) {
        return;
      }
      if (userMenuRef.current.contains(event.target as Node)) {
        return;
      }
      closeUserMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeUserMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeUserMenu, isUserMenuOpen]);

  // Move cursor to end of textarea when editing a comment
  useEffect(() => {
    if (editingCommentId !== null && fileCommentTextareaRef.current) {
      const textarea = fileCommentTextareaRef.current;
      // Wait for next tick to ensure textarea value is set
      setTimeout(() => {
        const length = textarea.value.length;
        textarea.setSelectionRange(length, length);
        textarea.focus();
      }, 0);
    }
  }, [editingCommentId]);

  useEffect(() => {
    if (!isPrFilterMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!prFilterMenuRef.current) {
        return;
      }
      if (prFilterMenuRef.current.contains(event.target as Node)) {
        return;
      }
      closePrFilterMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePrFilterMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePrFilterMenu, isPrFilterMenuOpen]);

  useEffect(() => {
    if (!showSourceMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!sourceMenuRef.current) {
        return;
      }
      if (sourceMenuRef.current.contains(event.target as Node)) {
        return;
      }
      setShowSourceMenu(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowSourceMenu(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showSourceMenu]);

  useEffect(() => {
    if (!showFilesMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!filesMenuRef.current) {
        return;
      }
      if (filesMenuRef.current.contains(event.target as Node)) {
        return;
      }
      setShowFilesMenu(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowFilesMenu(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showFilesMenu]);

  useEffect(() => {
    setCommentDraft("");
    setCommentError(null);
    setCommentSuccess(false);
    setFileCommentDraft("");
    setFileCommentLine("");
    setFileCommentError(null);
    setFileCommentSuccess(false);
    setFileCommentIsFileLevel(false);
    setFileCommentMode("single");
    setFileCommentSide("RIGHT");
    setIsInlineCommentOpen(false);
    setIsGeneralCommentOpen(false);
  }, [prDetail?.number]);

  useEffect(() => {
    setFileCommentLine("");
    setFileCommentError(null);
    setFileCommentSuccess(false);
    setFileCommentIsFileLevel(false);
    setFileCommentMode("single");
    setFileCommentSide("RIGHT");
    // Don't close the inline comment panel if it's already open
    // This allows clicking comment badges to navigate and keep panel open
    setIsGeneralCommentOpen(false);
    setIsFileCommentComposerVisible(false);
  }, [selectedFilePath]);

  useEffect(() => {
    if (!fileCommentSuccess) {
      return;
    }
    setIsFileCommentComposerVisible(false);
    const resetTimer = window.setTimeout(() => {
      setFileCommentSuccess(false);
    }, 2400);
    return () => {
      window.clearTimeout(resetTimer);
    };
  }, [fileCommentSuccess]);

  useEffect(() => {
    if (!isInlineCommentOpen) {
      setIsFileCommentComposerVisible(false);
    }
  }, [isInlineCommentOpen]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }
    const handleMouseMove = (event: MouseEvent) => {
      const container = workspaceBodyRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const relativeX = event.clientX - rect.left;
      const clamped = Math.min(Math.max(relativeX / rect.width, 0.2), 0.8);
      setSplitRatio(clamped);
    };

    const stopResizing = () => {
      setIsResizing(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResizing);
    window.addEventListener("mouseleave", stopResizing);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResizing);
      window.removeEventListener("mouseleave", stopResizing);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!isSidebarResizing) {
      return;
    }
    if (isSidebarCollapsed) {
      setIsSidebarResizing(false);
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const shell = appShellRef.current;
      if (!shell) {
        return;
      }
      const rect = shell.getBoundingClientRect();
      const rawWidth = event.clientX - rect.left;
      const maxWidth = rect.width - MIN_CONTENT_WIDTH;
      const upperBound = Math.max(MIN_SIDEBAR_WIDTH, maxWidth);
      const clamped = Math.min(Math.max(rawWidth, MIN_SIDEBAR_WIDTH), upperBound);
      setSidebarWidth(clamped);
    };

    const stopResizing = () => {
      setIsSidebarResizing(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResizing);
    window.addEventListener("mouseleave", stopResizing);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResizing);
      window.removeEventListener("mouseleave", stopResizing);
    };
  }, [isSidebarResizing, isSidebarCollapsed]);

  useEffect(() => {
    if (isResizing || isSidebarResizing) {
      if (previousBodyCursorRef.current === null) {
        previousBodyCursorRef.current = document.body.style.cursor;
        previousBodyUserSelectRef.current = document.body.style.userSelect;
      }
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else if (
      previousBodyCursorRef.current !== null ||
      previousBodyUserSelectRef.current !== null
    ) {
      document.body.style.cursor = previousBodyCursorRef.current ?? "";
      document.body.style.userSelect = previousBodyUserSelectRef.current ?? "";
      previousBodyCursorRef.current = null;
      previousBodyUserSelectRef.current = null;
    }
  }, [isResizing, isSidebarResizing]);

  useEffect(() => {
    const shell = appShellRef.current;
    if (!shell) {
      return;
    }
    if (isSidebarCollapsed) {
      shell.style.removeProperty("--sidebar-width");
      return;
    }
    shell.style.setProperty("--sidebar-width", `${Math.round(sidebarWidth)}px`);
  }, [sidebarWidth, isSidebarCollapsed]);

  useEffect(() => {
    const element = workspaceBodyRef.current;
    if (!element) {
      return;
    }
    const value = `${(splitRatio * 100).toFixed(2)}%`;
    element.style.setProperty("--split-ratio", value);
    return () => {
      element.style.removeProperty("--split-ratio");
    };
  }, [splitRatio]);

  const handleRepoSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = repoInput.trim();
      const match = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed);
      if (!match) {
        if (!isLocalDirectoryMode) {
          setRepoError("Use the format owner/repo");
        }
        return;
      }
      const owner = match[1];
      const repository = match[2];
      exitLocalDirectoryMode();
      if (repoRef && repoRef.owner === owner && repoRef.repo === repository) {
        setRepoError(null);
        void refetchPulls();
        return;
      }
      setRepoError(null);
      setRepoRef({ owner, repo: repository });
      setSelectedPr(null);
      setSelectedFilePath(null);
      setPrSearchFilter("");
      queryClient.removeQueries({ queryKey: ["pull-request"] });
    },
    [repoInput, repoRef, queryClient, refetchPulls, exitLocalDirectoryMode, isLocalDirectoryMode],
  );

  // Enhance PRs under review with viewed file counts and check for pending reviews
  const enhancedPrsUnderReview = useMemo(() => {
    const basePrs = prsUnderReviewQuery.data || [];
    
    // Collect all PRs from multiple sources
    const prMap = new Map<string, PrUnderReview>();
    
    // First, add PRs from backend (with local reviews)
    basePrs.forEach(pr => {
      const key = `${pr.owner}/${pr.repo}#${pr.number}`;
      prMap.set(key, pr);
    });
    
    // Add PRs with pending reviews from MRU queries (both open and closed)
    [...mruOpenPrsQueries, ...mruClosedPrsQueries].forEach(query => {
      if (query.data && Array.isArray(query.data)) {
        query.data.forEach((pr: PrUnderReview) => {
          const key = `${pr.owner}/${pr.repo}#${pr.number}`;
          if (!prMap.has(key)) {
            prMap.set(key, pr);
          }
          // Cache state/merged metadata from MRU queries
          if (pr.state !== undefined && pr.merged !== undefined) {
            const cached = prMetadata[key];
            if (!cached || cached.state !== pr.state || cached.merged !== pr.merged) {
              setPrMetadata(prev => ({
                ...prev,
                [key]: {
                  state: pr.state!,
                  merged: pr.merged!,
                  locked: prev[key]?.locked,
                },
              }));
            }
          }
        });
      }
    });
    
    // Finally, add PRs from viewedFiles that have partial progress
    Object.keys(viewedFiles).forEach(prKey => {
      if (!prMap.has(prKey)) {
        // Parse the key: owner/repo#number
        const match = prKey.match(/^([^/]+)\/([^#]+)#(\d+)$/);
        if (match) {
          const [, owner, repo, numberStr] = match;
          const number = parseInt(numberStr, 10);
          
          // Try to get PR details from cache first
          const cachedPrDetail = queryClient.getQueryData<PullRequestDetail>([
            "pull-request",
            owner,
            repo,
            number,
            authQuery.data?.login,
          ]);
          
          // Try to get from pulls list cache as fallback
          let title = prTitles[prKey] || "";
          let totalCount = prFileCounts[prKey] || 0;
          let state: string | undefined;
          let merged: boolean | undefined;
          let locked: boolean | undefined;
          
          // Check cached metadata first
          const cachedMetadata = prMetadata[prKey];
          if (cachedMetadata) {
            state = cachedMetadata.state;
            merged = cachedMetadata.merged;
            locked = cachedMetadata.locked;
          }
          
          if (cachedPrDetail) {
            title = cachedPrDetail.title;
            // Update cached title and count from detail
            const actualCount = showAllFileTypes 
              ? cachedPrDetail.files.length
              : cachedPrDetail.files.filter(f => f.language === "markdown" || f.language === "yaml").length;
            totalCount = actualCount;
            if (prFileCounts[prKey] !== actualCount) {
              setPrFileCounts(prev => ({ ...prev, [prKey]: actualCount }));
            }
            if (prTitles[prKey] !== title) {
              setPrTitles(prev => ({ ...prev, [prKey]: title }));
            }
          } else {
            // Check pulls query cache for this repo (both open and closed)
            const cachedOpenPulls = queryClient.getQueryData<PullRequestSummary[]>([
              "pull-requests",
              owner,
              repo,
              false, // showClosedPRs
            ]);
            const cachedClosedPulls = queryClient.getQueryData<PullRequestSummary[]>([
              "pull-requests",
              owner,
              repo,
              true, // showClosedPRs
            ]);
            const prSummary = [...(cachedOpenPulls || []), ...(cachedClosedPulls || [])].find(p => p.number === number);
            if (prSummary) {
              title = prSummary.title;
              state = prSummary.state;
              merged = prSummary.merged;
              locked = prSummary.locked;
              if (prTitles[prKey] !== title) {
                setPrTitles(prev => ({ ...prev, [prKey]: title }));
              }
              // Cache the metadata
              if (state !== undefined && merged !== undefined && locked !== undefined) {
                const definedState: string = state;
                const definedMerged: boolean = merged;
                const definedLocked: boolean = locked;
                if (!cachedMetadata || cachedMetadata.state !== definedState || cachedMetadata.merged !== definedMerged || cachedMetadata.locked !== definedLocked) {
                  setPrMetadata(prev => ({
                    ...prev,
                    [prKey]: {
                      state: definedState,
                      merged: definedMerged,
                      locked: definedLocked,
                    },
                  }));
                }
              }
            }
          }
          
          // Add even without title - we'll show repo/number if needed
          if (title || totalCount > 0) {
            prMap.set(prKey, {
              owner,
              repo,
              number,
              title,
              has_local_review: false,
              has_pending_review: false,
              viewed_count: 0,
              total_count: totalCount,
              state,
              merged,
              locked,
            });
          }
        }
      }
    });
    
    // Now process all PRs
    return Array.from(prMap.values()).map(pr => {
      const prKey = `${pr.owner}/${pr.repo}#${pr.number}`;
      const viewed = viewedFiles[prKey] || [];
      
      // Get PR details if available to get total file count and title
      // Start with values from pr or cache
      let totalCount = pr.total_count || prFileCounts[prKey] || 0;
      let title = pr.title || prTitles[prKey] || "";
      let hasPendingReview = pr.has_pending_review;
      
      // Check if this PR is loaded in cache
      const cachedPrDetail = queryClient.getQueryData<PullRequestDetail>([
        "pull-request",
        pr.owner,
        pr.repo,
        pr.number,
        authQuery.data?.login,
      ]);
      
      if (cachedPrDetail) {
        // Calculate total count based on current filter state
        const actualCount = showAllFileTypes
          ? cachedPrDetail.files.length
          : cachedPrDetail.files.filter(f => 
              f.language === "markdown" || f.language === "yaml"
            ).length;
        totalCount = actualCount;
        title = cachedPrDetail.title;
        
        // Update cached count and title if changed
        if (prFileCounts[prKey] !== actualCount) {
          setPrFileCounts(prev => ({ ...prev, [prKey]: actualCount }));
        }
        if (prTitles[prKey] !== title) {
          setPrTitles(prev => ({ ...prev, [prKey]: title }));
        }
        
        // Check for pending reviews
        const myPendingReview = cachedPrDetail.reviews.find(
          r => r.is_mine && r.state === "PENDING"
        );
        hasPendingReview = !!myPendingReview;
      }
      
      const viewedCount = viewed.length;
      
      // Get cached state/merged if not already on pr
      let state = pr.state;
      let merged = pr.merged;
      let locked = pr.locked;
      if (state === undefined || merged === undefined) {
        const cachedMetadata = prMetadata[prKey];
        if (cachedMetadata) {
          state = cachedMetadata.state;
          merged = cachedMetadata.merged;
          locked = cachedMetadata.locked;
        }
      }
      
      const isLocalFolderEntry = pr.owner === "__local__" && pr.repo === "local";
      const hasLocalFolderPath = Boolean(pr.local_folder);

      // Only show local-folder entries based on review progress.
      const showPr = isLocalFolderEntry
        ? (hasLocalFolderPath && totalCount > 0 && viewedCount < totalCount)
        : (
          pr.has_local_review ||
          hasPendingReview ||
          (viewedCount > 0 && totalCount > 0 && viewedCount < totalCount)
        );
      
      return showPr ? {
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
        has_local_review: pr.has_local_review,
        has_pending_review: hasPendingReview,
        title,
        viewed_count: viewedCount,
        total_count: totalCount,
        state,
        merged,
        locked,
        local_folder: pr.local_folder ?? null,
      } as PrUnderReview : null;
    }).filter((pr): pr is NonNullable<typeof pr> => pr !== null);
  }, [prsUnderReviewQuery.data, viewedFiles, prFileCounts, prTitles, prMetadata, queryClient, authQuery.data?.login, repoMRU, mruOpenPrsQueries, mruClosedPrsQueries, showAllFileTypes]);

  // Fetch PR state/merged/locked for PRs under review that are missing it.
  useEffect(() => {
    if (!authQuery.data?.is_authenticated) return;

    const candidates = enhancedPrsUnderReview
      .filter(pr => !(pr.owner === "__local__" && pr.repo === "local"))
      .filter(pr => {
        const key = `${pr.owner}/${pr.repo}#${pr.number}`;
        const cached = prMetadata[key];
        const hasState = pr.state !== undefined || cached?.state !== undefined;
        const hasMerged = pr.merged !== undefined || cached?.merged !== undefined;
        const hasLocked = pr.locked !== undefined || cached?.locked !== undefined;
        return !(hasState && hasMerged && hasLocked);
      });

    if (candidates.length === 0) return;

    let cancelled = false;

    const run = async () => {
      for (const pr of candidates) {
        if (cancelled) return;
        const prKey = `${pr.owner}/${pr.repo}#${pr.number}`;
        try {
          const metadata = await queryClient.fetchQuery({
            queryKey: ["pull-request-metadata", pr.owner, pr.repo, pr.number],
            queryFn: async () =>
              await invoke<PullRequestMetadata>("cmd_get_pull_request_metadata", {
                owner: pr.owner,
                repo: pr.repo,
                number: pr.number,
              }),
            staleTime: 60 * 60 * 1000,
          });

          if (cancelled) return;

          setPrMetadata(prev => ({
            ...prev,
            [prKey]: {
              state: metadata.state,
              merged: metadata.merged,
              locked: metadata.locked,
            },
          }));
        } catch {
          // Ignore (offline / permissions / transient failures). We'll try again later.
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [authQuery.data?.is_authenticated, enhancedPrsUnderReview, prMetadata, queryClient]);

  // Prefetch PR details for PRs under review that don't have titles
  // Prioritize PRs with local reviews for immediate fetching
  useEffect(() => {
    if (!authQuery.data?.login) return;
    
    // Separate PRs with local reviews from others
    const prsWithLocalReviews = enhancedPrsUnderReview.filter(pr => pr.has_local_review);
    const otherPrs = enhancedPrsUnderReview.filter(pr => !pr.has_local_review);
    
    // Immediately fetch PRs with local reviews that lack titles (high priority)
    prsWithLocalReviews.forEach(pr => {
      if (!pr.title || pr.title === "") {
        if (pr.owner === "__local__" && pr.repo === "local") {
          return;
        }
        // Use fetchQuery instead of prefetchQuery to get results immediately
        void queryClient.fetchQuery({
          queryKey: ["pull-request", pr.owner, pr.repo, pr.number, authQuery.data?.login],
          queryFn: async () => {
            return await invoke<PullRequestDetail>("cmd_get_pull_request", {
              owner: pr.owner,
              repo: pr.repo,
              number: pr.number,
              currentLogin: authQuery.data?.login,
            });
          },
          staleTime: 60 * 60 * 1000, // Cache for 1 hour
        });
      }
    });
    
    // Prefetch other PRs in the background (lower priority)
    otherPrs.forEach(pr => {
      if (!pr.title || pr.title === "") {
        if (pr.owner === "__local__" && pr.repo === "local") {
          return;
        }
        void queryClient.prefetchQuery({
          queryKey: ["pull-request", pr.owner, pr.repo, pr.number, authQuery.data?.login],
          queryFn: async () => {
            return await invoke<PullRequestDetail>("cmd_get_pull_request", {
              owner: pr.owner,
              repo: pr.repo,
              number: pr.number,
              currentLogin: authQuery.data?.login,
            });
          },
        });
      }
    });
  }, [enhancedPrsUnderReview, queryClient, authQuery.data?.login]);

  // Add to MRU when pulls load successfully
  useEffect(() => {
    if (pullsQuery.isSuccess && repoRef && !pullsQuery.isError) {
      const repoString = `${repoRef.owner}/${repoRef.repo}`;
      addRepoToMRU(repoString);
    }
  }, [pullsQuery.isSuccess, pullsQuery.isError, repoRef, addRepoToMRU]);

  // Handle ESC key for media viewer
  useEffect(() => {
    if (maximizedPane !== 'media') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMaximizedPane(null);
        setMediaViewerContent(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [maximizedPane]);

  // Removed auto-navigate to pending review - users should manually open File Comments panel when desired

  // prFileCounts, prTitles, prMetadata now use useLocalStorage hook for automatic persistence

  useEffect(() => {
    const element = commentContextMenuRef.current;
    if (!element || !commentContextMenu) {
      return;
    }
    element.style.top = `${commentContextMenu.y}px`;
    element.style.left = `${commentContextMenu.x}px`;
  }, [commentContextMenu]);

  // Auto-switch PR mode based on whether there are PRs under review
  // Only switch after queries have finished loading to avoid premature switching
  useEffect(() => {
    // Check if queries have actually fetched at least once (not just "not loading")
    const allOpenQueriesReady = mruOpenPrsQueries.every(q => 
      (!q.isLoading && !q.isFetching && q.isFetched) || q.isError
    );
    const allClosedQueriesReady = mruClosedPrsQueries.every(q => 
      (!q.isLoading && !q.isFetching && q.isFetched) || q.isError
    );
    const prsQueryReady = (!prsUnderReviewQuery.isLoading && !prsUnderReviewQuery.isFetching && prsUnderReviewQuery.isFetched) || prsUnderReviewQuery.isError;
    
    // Only switch away from "under-review" if all queries have completed AND we confirmed there are no PRs
    if (prMode === "under-review" && enhancedPrsUnderReview.length === 0 && allOpenQueriesReady && allClosedQueriesReady && prsQueryReady) {
      setPrMode("repo");
    }
  }, [prMode, enhancedPrsUnderReview.length, mruOpenPrsQueries, mruClosedPrsQueries, prsUnderReviewQuery.isLoading, prsUnderReviewQuery.isFetching, prsUnderReviewQuery.isFetched]);

  // Handler for selecting a PR from the under-review list
  const handleSelectPrUnderReview = useCallback((pr: PrUnderReview) => {
    const isLocalUnderReview = pr.owner === "__local__" && pr.repo === "local" && !!pr.local_folder;

    if (isLocalUnderReview && pr.local_folder) {
      enterLocalDirectoryMode(pr.local_folder);
      setIsPrCommentsView(false);
      setIsPrCommentComposerOpen(false);
      return;
    }

    // Set the repo
    const repoString = `${pr.owner}/${pr.repo}`;
    setRepoInput(repoString);
    setRepoRef({ owner: pr.owner, repo: pr.repo });
    
    // Select the PR
    setSelectedPr(pr.number);
    setSelectedFilePath(null);
    setIsPrCommentsView(false);
    setIsPrCommentComposerOpen(false);
    
    // Keep the current PR mode (stay in "under-review" if already there)
  }, [enterLocalDirectoryMode]);

  // Navigation functions for file history
  const canNavigateBack = fileNavigationIndex > 0;
  const canNavigateForward = fileNavigationIndex < fileNavigationHistory.length - 1;
  
  const navigateBack = useCallback(() => {
    if (canNavigateBack) {
      const newIndex = fileNavigationIndex - 1;
      setFileNavigationIndex(newIndex);
      setIsNavigatingFromHistory(true);
      setSelectedFilePath(fileNavigationHistory[newIndex]);
    }
  }, [canNavigateBack, fileNavigationIndex, fileNavigationHistory]);
  
  const navigateForward = useCallback(() => {
    if (canNavigateForward) {
      const newIndex = fileNavigationIndex + 1;
      setFileNavigationIndex(newIndex);
      setIsNavigatingFromHistory(true);
      setSelectedFilePath(fileNavigationHistory[newIndex]);
    }
  }, [canNavigateForward, fileNavigationIndex, fileNavigationHistory]);

  // Get comment count for a file
  const getFileCommentCount = useCallback((filePath: string): number => {
    let fileComments = reviewAwareComments.filter((c: PullRequestComment) => c.path === filePath);
    
    // Apply outdated filter
    if (!showOutdatedComments) {
      fileComments = fileComments.filter((c: PullRequestComment) => !c.outdated);
    }
    
    // Apply "only my comments" filter
    if (showOnlyMyComments) {
      fileComments = fileComments.filter((c: PullRequestComment) => c.is_mine);
    }
    
    return fileComments.length;
  }, [reviewAwareComments, showOutdatedComments, showOnlyMyComments]);

  // Check if a file has any pending comments (draft or pending GitHub review)
  const fileHasPendingComments = useCallback((filePath: string): boolean => {
    return reviewAwareComments.some((c: PullRequestComment) => 
      c.path === filePath && 
      (c.is_draft || (c.review_id === pendingReview?.id && pendingReview?.html_url))
    );
  }, [reviewAwareComments, pendingReview]);

  // Check if a file has user-authored comments with replies (for green badge)
  const fileHasRepliedComments = useCallback((filePath: string): boolean => {
    const fileComments = reviewAwareComments.filter((c: PullRequestComment) => c.path === filePath);
    
    // Find user's comments
    const userComments = fileComments.filter((c: PullRequestComment) => c.is_mine);
    
    // Check if any user comment has replies
    return userComments.some((userComment: PullRequestComment) => {
      return fileComments.some((c: PullRequestComment) => c.in_reply_to_id === userComment.id);
    });
  }, [reviewAwareComments]);

  // Helper to check if a file draft entry should be deleted (no non-empty drafts)
  const shouldDeleteFileDraft = useCallback((fileDrafts: { inline?: string; reply?: Record<string, string> } | undefined): boolean => {
    if (!fileDrafts) return true;
    if (fileDrafts.inline && fileDrafts.inline.trim()) return false;
    if (fileDrafts.reply && Object.values(fileDrafts.reply).some(draft => draft && draft.trim())) return false;
    return true;
  }, []);

  // Check if a file has any drafts in progress (unsaved comments/replies)
  const fileHasDraftsInProgress = useCallback((filePath: string): boolean => {
    const fileDrafts = draftsByFile[filePath];
    if (!fileDrafts) return false;
    if (fileDrafts.inline && fileDrafts.inline.trim()) return true;
    if (fileDrafts.reply && Object.values(fileDrafts.reply).some(draft => draft && draft.trim())) return true;
    return false;
  }, [draftsByFile]);

  const handleLogin = useCallback(async () => {
    await loginMutation.mutateAsync();
  }, [loginMutation]);

  const submitCommentMutation = useMutation({
    mutationFn: async ({ body }: { body: string }) => {
      if (!repoRef || !prDetail) {
        throw new Error("Select a pull request before commenting.");
      }
      await invoke("cmd_submit_review_comment", {
        owner: repoRef.owner,
        repo: repoRef.repo,
        number: prDetail.number,
        body,
      });
    },
    onSuccess: async () => {
      setCommentDraft("");
      setCommentError(null);
      setCommentSuccess(true);
      setIsGeneralCommentOpen(false);
      if (isPrCommentComposerOpen) {
        setIsPrCommentComposerOpen(false);
      }
      
      // Clear IndexedDB cache and invalidate queries
      if (repoRef && prDetail) {
        await offlineCache.clearPRCache(repoRef.owner, repoRef.repo, prDetail.number);
      }
      await queryClient.invalidateQueries({ 
        queryKey: ["pull-request", repoRef?.owner, repoRef?.repo, selectedPr, authQuery.data?.login]
      });
      void refetchPullDetail();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to submit comment.";
      setCommentError(message);
    },
  });

  const submitFileCommentMutation = useMutation({
    mutationFn: async ({
      body,
      line,
      side,
      subjectType,
      mode,
      pendingReviewId,
    }: {
      body: string;
      line: number | null;
      side: "RIGHT" | "LEFT";
      subjectType: "file" | null;
      mode: "single" | "review";
      pendingReviewId: number | null;
    }) => {
      if (!repoRef || !prDetail || !selectedFilePath) {
        throw new Error("Select a file before commenting.");
      }

      // Local folder mode: always save to local review/log storage.
      if (isLocalDirectoryMode) {
        await invoke("cmd_local_add_comment", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          prNumber: prDetail.number,
          filePath: selectedFilePath,
          lineNumber: line,
          side,
          body,
          commitId: prDetail.head_sha,
          inReplyToId: null,
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
          filePath: selectedFilePath,
          lineNumber: line,
          side,
          body,
          commitId: prDetail.head_sha,
          inReplyToId: null,
        });
      } else {
        // For single comments, use the old API
        await invoke("cmd_submit_file_comment", {
          args: {
            owner: repoRef.owner,
            repo: repoRef.repo,
            number: prDetail.number,
            path: selectedFilePath,
            body,
            commit_id: prDetail.head_sha,
            line,
            side: line !== null ? side : null,
            subject_type: subjectType,
            mode,
            pending_review_id: pendingReviewId,
          },
        });
      }
    },
    onMutate: async ({ mode }) => {
      setFileCommentSubmittingMode(mode);
    },
    onSuccess: async () => {
      setFileCommentDraft("");
      setFileCommentLine("");
      setFileCommentError(null);
      setFileCommentSuccess(true);
      setFileCommentIsFileLevel(false);
      setFileCommentMode(pendingReview ? "review" : "single");
      setFileCommentSide("RIGHT");
      setIsFileCommentComposerVisible(false);
      
      // Clear IndexedDB cache for this PR to force fresh fetch
      if (repoRef && prDetail) {
        await offlineCache.clearPRCache(repoRef.owner, repoRef.repo, prDetail.number);
      }
      
      // Invalidate and refetch to get updated comments
      await queryClient.invalidateQueries({ 
        queryKey: ["pull-request", repoRef?.owner, repoRef?.repo, selectedPr, authQuery.data?.login]
      });
      void refetchPullDetail();
    },
    onSettled: () => {
      setFileCommentSubmittingMode(null);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to submit comment.";
      setFileCommentError(message);
    },
  });

  const openFileCommentComposer = useCallback((mode: "single" | "review") => {
    setFileCommentMode(mode);
    setFileCommentIsFileLevel(false);
    setFileCommentError(null);
    setFileCommentSuccess(false);
    setIsFileCommentComposerVisible(true);
  }, []);

  const startReviewMutation = useMutation({
    mutationFn: async () => {
      if (!repoRef || !prDetail) {
        throw new Error("Select a pull request before starting a review.");
      }

      // Use local storage instead of GitHub API
      await invoke("cmd_local_start_review", {
        owner: repoRef.owner,
        repo: repoRef.repo,
        prNumber: prDetail.number,
        commitId: prDetail.head_sha,
        body: null,
      });

      // Create a fake review object for the UI
      const fakeReview: PullRequestReview = {
        id: prDetail.number, // Use PR number as fake ID
        state: "PENDING",
        author: authQuery.data?.login ?? "You",
        submitted_at: null,
        body: null,
        html_url: null,
        commit_id: prDetail.head_sha,
        is_mine: true,
      };

      return fakeReview;
    },
    onSuccess: async (review) => {
      setPendingReviewOverride(review);
      void loadLocalComments(review.id); // Pass review ID directly to avoid race condition
      setIsInlineCommentOpen(true); // Show comments panel
      setIsFileCommentComposerVisible(false); // Show list, not composer
      setFileCommentError(null);
      setFileCommentSuccess(false);
      // Refetch PRs under review to show this PR in the list
      await prsUnderReviewQuery.refetch();
    },
    onError: (error: unknown) => {
      console.error("Review mutation error:", error);
      const message = error instanceof Error ? error.message : "Failed to start review.";
      openFileCommentComposer("review");
      setFileCommentError(message);
      setFileCommentSuccess(false);
    },
  });

  const submitReviewMutation = useMutation({
    mutationFn: async () => {
      if (!repoRef || !prDetail) {
        throw new Error("Select a pull request before submitting.");
      }

      // Check if there's a pending review from GitHub (not a local draft)
      // GitHub reviews will be in the reviews array from the server with PENDING state
      // Local reviews use PR number as ID and won't be in the server reviews array
      const isGithubPendingReview = pendingReview && 
        reviews.some((r: PullRequestReview) => r.id === pendingReview.id && r.state === "PENDING" && r.is_mine);
      
      if (isGithubPendingReview) {
        // Submit the GitHub pending review
        await invoke("cmd_submit_pending_review", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          number: prDetail.number,
          reviewId: pendingReview.id,
          event: "COMMENT",
          body: null,
        });
      } else {
        // Submit local review
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
      setPendingReviewOverride(null);
      setLocalComments([]);
      setFileCommentError(null);
      setFileCommentSuccess(true);
      setSubmissionProgress(null);
      
      // Remove query to force fresh fetch (we must be online to submit)
      queryClient.removeQueries({ 
        queryKey: ["pull-request", repoRef?.owner, repoRef?.repo, selectedPr, authQuery.data?.login]
      });
      
      void refetchPullDetail();
      void prsUnderReviewQuery.refetch();
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

      // If the PR conversation is locked, show a clear modal dialog (same style as Delete Comment)
      // so this failure cannot be missed.
      const normalized = message.toLowerCase();

      const prKey = repoRef && prDetail ? `${repoRef.owner}/${repoRef.repo}#${prDetail.number}` : null;
      const knownLocked = prKey ? prMetadata[prKey]?.locked : undefined;
      
      // Only match the specific locked conversation error patterns from the backend.
      // The backend returns: "Cannot submit review comments because this PR conversation is locked..."
      // or "Cannot submit review comments because PR #{number} is locked on GitHub..."
      // We must match exact phrases to avoid false positives with help text mentioning "is locked".
      const isLockedConversation =
        knownLocked === true ||
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

      setSubmissionProgress(null);
      // Reload local comments to show which ones are left (the ones that failed)
      void loadLocalComments();
    },
  });

  const deleteReviewMutation = useMutation({
    mutationFn: async (reviewId: number) => {
      if (!repoRef || !prDetail) {
        throw new Error("Select a pull request before deleting.");
      }

      await invoke("cmd_delete_review", {
        owner: repoRef.owner,
        repo: repoRef.repo,
        prNumber: prDetail.number,
        reviewId,
      });
    },
    onSuccess: async () => {
      setPendingReviewOverride(null);
      setLocalComments([]);
      setFileCommentError(null);
      
      // Clear IndexedDB cache for this PR to force fresh fetch
      if (repoRef && prDetail) {
        await offlineCache.clearPRCache(repoRef.owner, repoRef.repo, prDetail.number);
        console.log(`🗑️ Cleared cache for PR #${prDetail.number}`);
      }
      
      // Invalidate and refetch PR detail
      await queryClient.invalidateQueries({ 
        queryKey: ["pull-request", repoRef?.owner, repoRef?.repo, selectedPr, authQuery.data?.login]
      });
      void refetchPullDetail();
      void prsUnderReviewQuery.refetch();
      // Only close the comment panel if there are no remaining comments
      if (reviewAwareComments.length === 0) {
        setIsInlineCommentOpen(false);
      }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to delete review.";
      setFileCommentError(message);
    },
  });

  const updateCommentMutation = useMutation({
    mutationFn: async ({ commentId, body }: { commentId: number; body: string }) => {
      console.log("Updating comment", { commentId, body, editingComment });
      // Check if this is a local comment (local comments have url="#")
      const isLocalComment = editingComment?.url === "#" || !editingComment?.url;
      console.log("Is local comment:", isLocalComment, "url:", editingComment?.url);
      
      if (isLocalComment) {
        // Update local comment
        console.log("Calling cmd_local_update_comment");
        await invoke("cmd_local_update_comment", {
          commentId,
          body,
        });
        console.log("Comment updated successfully");
      } else {
        // Update GitHub comment
        console.log("Calling cmd_github_update_comment");
        if (!repoRef) throw new Error("Repository information not available");
        await invoke("cmd_github_update_comment", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          commentId,
          body,
        });
        console.log("GitHub comment updated successfully");
      }
    },
    onSuccess: async () => {
      console.log("Update comment success");
      setFileCommentDraft("");
      setFileCommentError(null);
      setFileCommentSuccess(true);
      setEditingCommentId(null);
      setEditingComment(null);
      setIsFileCommentComposerVisible(false);
      
      // Clear IndexedDB cache and invalidate queries to get updated comment
      if (repoRef && prDetail) {
        await offlineCache.clearPRCache(repoRef.owner, repoRef.repo, prDetail.number);
      }
      await queryClient.invalidateQueries({ 
        queryKey: ["pull-request", repoRef?.owner, repoRef?.repo, selectedPr, authQuery.data?.login]
      });
      
      // Reload appropriate data based on comment type
      if (editingComment?.url === "#" || !editingComment?.url) {
        void loadLocalComments();
      } else {
        void refetchPullDetail();
      }
    },
    onError: (error: unknown) => {
      console.error("Update comment error:", error);
      const message = error instanceof Error ? error.message : "Failed to update comment.";
      setFileCommentError(message);
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: number) => {
      console.log("Deleting comment", { commentId, editingComment });
      // Check if this is a local comment (local comments have url="#")
      const isLocalComment = editingComment?.url === "#" || !editingComment?.url;
      console.log("Is local comment:", isLocalComment, "url:", editingComment?.url);
      
      if (isLocalComment) {
        // Delete local comment
        console.log("Calling cmd_local_delete_comment");
        await invoke("cmd_local_delete_comment", {
          commentId,
        });
        console.log("Comment deleted successfully");
      } else {
        // Delete GitHub comment
        console.log("Calling cmd_github_delete_comment");
        if (!repoRef) throw new Error("Repository information not available");
        await invoke("cmd_github_delete_comment", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          commentId,
        });
        console.log("GitHub comment deleted successfully");
      }
    },
    onSuccess: async () => {
      setFileCommentDraft("");
      setFileCommentError(null);
      setEditingCommentId(null);
      setEditingComment(null);
      setIsFileCommentComposerVisible(false);
      
      // Clear IndexedDB cache and invalidate queries
      if (repoRef && prDetail) {
        await offlineCache.clearPRCache(repoRef.owner, repoRef.repo, prDetail.number);
      }
      await queryClient.invalidateQueries({ 
        queryKey: ["pull-request", repoRef?.owner, repoRef?.repo, selectedPr, authQuery.data?.login]
      });
      
      // Reload appropriate data based on comment type
      if (editingComment?.url === "#" || !editingComment?.url) {
        // This was a local comment - reload local comments
        await loadLocalComments();
        
        // Check if there are any comments left
        setTimeout(() => {
          if (commentPanelBodyRef.current && selectedFilePath) {
            const commentElements = Array.from(
              commentPanelBodyRef.current.querySelectorAll('[id^="comment-"]')
            ) as HTMLElement[];
            
            if (commentElements.length === 0) {
              // No comments left, close the panel
              setIsInlineCommentOpen(false);
              preserveScrollPositionRef.current = null;
            }
            // The scroll restoration effect will handle restoring the position
          }
        }, 100);
        
        // Check if there are any local comments left after deletion
        if (repoRef && prDetail) {
          console.log("Checking if local comments exist after deletion, current count:", localComments.length);
          // localComments hasn't been updated yet, so we need to check directly
          try {
            const remainingComments = await invoke<PullRequestComment[]>("cmd_local_get_comments", {
              owner: repoRef.owner,
              repo: repoRef.repo,
              prNumber: prDetail.number,
            });
            console.log("Remaining local comments after deletion:", remainingComments.length);
            
            if (remainingComments.length === 0) {
              // No comments left - delete the review
              console.log("No local comments left, deleting the review");
              await invoke("cmd_local_clear_review", {
                owner: repoRef.owner,
                repo: repoRef.repo,
                prNumber: prDetail.number,
              });
              console.log("Local review deleted successfully");
              
              // Clear the pending review override and close the panel
              setPendingReviewOverride(null);
              setIsInlineCommentOpen(false);
            }
          } catch (error) {
            console.error("Failed to check remaining comments or delete review:", error);
          }
        }
      } else {
        void refetchPullDetail();
      }
    },
    onError: (error: unknown) => {
      console.error("Delete comment error:", error);
      const message = error instanceof Error ? error.message : "Failed to delete comment.";
      setFileCommentError(message);
    },
  });

  const handleAddCommentClick = useCallback((filePath?: string) => {
    const targetFilePath = filePath ?? selectedFilePath;
    if (!targetFilePath) {
      return;
    }
    if (selectedFilePath !== targetFilePath) {
      setSelectedFilePath(targetFilePath);
    }
    setEditingCommentId(null);
    setEditingComment(null);
    setIsAddingInlineComment(true);
    // Restore draft if exists
    const draft = draftsByFile[targetFilePath]?.inline || "";
    setInlineCommentDraft(draft);
    setInlineCommentError(null);
    // Scroll to bottom after a brief delay to allow render
    setTimeout(() => {
      if (commentPanelBodyRef.current) {
        commentPanelBodyRef.current.scrollTop = commentPanelBodyRef.current.scrollHeight;
      }
    }, 100);
  }, [selectedFilePath, draftsByFile]);

  const handleSubmitReviewClick = useCallback(() => {
    if (localComments.length === 0) {
      setFileCommentError("Add at least one comment before submitting.");
      return;
    }
    submitReviewMutation.mutate();
  }, [localComments.length, submitReviewMutation]);

  const handleStartReviewClick = useCallback(async () => {
    console.log("Start review button clicked, localComments.length:", localComments.length);
    if (localComments.length > 0 && repoRef && prDetail) {
      // If there are local comments, load the review metadata and show the panel
      console.log("Local comments exist, loading review metadata");
      try {
        const metadata = await invoke<ReviewMetadata | null>("cmd_local_get_review_metadata", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          prNumber: prDetail.number,
        });

        if (metadata) {
  
          // Create a pending review object to match the expected format
          const localReview: PullRequestReview = {
            id: metadata.log_file_index, // Use log_file_index as the review ID
            body: metadata.body ?? "",
            state: "PENDING",
            author: authQuery.data?.login ?? "You",
            submitted_at: metadata.created_at,
            html_url: null, // Local reviews don't have URLs
            is_mine: true,
          };
          setPendingReviewOverride(localReview);
          // Refetch PRs under review to show this PR in the list
          console.log("Refetching PRs under review (existing local review)...");
          await prsUnderReviewQuery.refetch();
          console.log("PRs under review refetch complete");
        }
        
        setIsInlineCommentOpen(true);
        setIsFileCommentComposerVisible(false);
      } catch (error) {
        console.error("Failed to load review metadata:", error);
      }
    } else {
      // Otherwise create a new review
      console.log("No local comments, creating new review");
      startReviewMutation.mutate();
    }
  }, [localComments.length, repoRef, prDetail, authQuery.data?.login, startReviewMutation]);

  const handleStartReviewWithComment = useCallback(async () => {
    // This is called when user has typed a comment and clicks "Start review"
    // We need to save the comment first, then start the review
    console.log("handleStartReviewWithComment called!");
    
    if (!selectedFilePath) {
      setFileCommentError("Select a file before commenting.");
      return;
    }

    const trimmed = fileCommentDraft.trim();
    if (!trimmed) {
      // No comment typed, just start the review
      handleStartReviewClick();
      return;
    }

    // Validate line number if not file-level
    let parsedLine: number | null = null;
    
    // If no line number provided, treat as file-level comment
    if (!fileCommentLine || fileCommentLine.trim() === "") {
      parsedLine = null;
    } else if (!fileCommentIsFileLevel) {
      // Line number provided - validate it
      const numericLine = Number(fileCommentLine);
      if (!Number.isInteger(numericLine) || numericLine <= 0) {
        setFileCommentError("Line numbers must be positive integers.");
        return;
      }
      
      if (selectedFile) {
        const content = fileCommentSide === "RIGHT" ? selectedFile.head_content : selectedFile.base_content;
        if (content) {
          const lines = content.split("\n");
          // If content ends with newline, split creates trailing empty string - remove it
          const lineCount = content.endsWith("\n") ? lines.length - 1 : lines.length;
          if (numericLine > lineCount) {
            setFileCommentError(`Line number ${numericLine} exceeds file length (${lineCount} lines).`);
            return;
          }
        }
      }
      
      parsedLine = numericLine;
    }

    if (!repoRef || !prDetail) {
      setFileCommentError("Select a pull request before commenting.");
      return;
    }

    setFileCommentError(null);

    try {
      console.log("Starting review first before adding comment...");
      // First, start the review to create the review metadata
      await invoke("cmd_local_start_review", {
        owner: repoRef.owner,
        repo: repoRef.repo,
        prNumber: prDetail.number,
        commitId: prDetail.head_sha,
        body: null,
      });

      console.log("Review started, now adding comment...");
      // Now save the comment to local storage
      await invoke("cmd_local_add_comment", {
        owner: repoRef.owner,
        repo: repoRef.repo,
        prNumber: prDetail.number,
        filePath: selectedFilePath,
        lineNumber: parsedLine,
        side: fileCommentSide,
        body: trimmed,
        commitId: prDetail.head_sha,
        inReplyToId: null,
      });

      // Clear the form
      setFileCommentDraft("");
      setFileCommentLine("");
      setFileCommentIsFileLevel(false);
      setFileCommentSide("RIGHT");

      // Create a local review object and set it first
      // This will trigger the effect that loads local comments automatically
      if (prDetail) {
        console.log("prDetail exists, creating local review object");
        const localReview = createLocalReview({
          prNumber: prDetail.number,
          author: authQuery.data?.login ?? "You",
          commitId: prDetail.head_sha,
        });
        setPendingReviewOverride(localReview);
        
        // Show the review panel with the newly added comment
        setIsInlineCommentOpen(true);
        setIsFileCommentComposerVisible(false);
        
        await prsUnderReviewQuery.refetch();
      }
    } catch (error) {
      console.error("Failed to save comment in handleStartReviewWithComment:", error);
      const message = error instanceof Error ? error.message : "Failed to save comment.";
      setFileCommentError(message);
    }
  }, [
    selectedFilePath,
    fileCommentDraft,
    fileCommentIsFileLevel,
    fileCommentLine,
    fileCommentSide,
    selectedFile,
    repoRef,
    prDetail,
    authQuery.data?.login,
    loadLocalComments,
  ]);

  const handleShowReviewClick = useCallback(async () => {
    
    if (!repoRef || !prDetail) return;
    
    // Handle GitHub pending review
    if (pendingReviewFromServer) {
      setPendingReviewOverride(pendingReviewFromServer);
      setIsLoadingPendingComments(true);
      
      // Fetch the pending review comments from GitHub
      try {
        console.log("Fetching pending review comments for review:", pendingReviewFromServer.id);
        const pendingComments = await invoke<PullRequestComment[]>("cmd_get_pending_review_comments", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          prNumber: prDetail.number,
          reviewId: pendingReviewFromServer.id,
          currentLogin: authQuery.data?.login ?? null,
        });
        console.log("Fetched pending review comments:", pendingComments);
        setLocalComments(pendingComments);
      } catch (error) {
        console.error("Failed to fetch pending review comments:", error);
        setLocalComments([]);
      } finally {
        setIsLoadingPendingComments(false);
      }
    } 
    // Handle local review
    else if (localComments.length > 0) {
      console.log("Showing local review with", localComments.length, "comments");
      // Local comments are already loaded, just need to show them
      // Find or create a local pending review object
      let localReview = reviews.find((r: PullRequestReview) => r.id === prDetail.number);
      if (!localReview) {
        // Create a fake review object for local comments
        localReview = {
          id: prDetail.number,
          state: "PENDING",
          author: authQuery.data?.login ?? "You",
          submitted_at: null,
          body: null,
          html_url: null,
          commit_id: prDetail.head_sha,
          is_mine: true,
        };
      }
      setPendingReviewOverride(localReview);
      
      // Refetch PRs under review to show this PR in the list
      console.log("Refetching PRs under review (show local review)...");
      await prsUnderReviewQuery.refetch();
      console.log("PRs under review refetch complete");
    }
    
    setIsInlineCommentOpen(true);
    setIsFileCommentComposerVisible(false);
    console.log("Panel state updated: isInlineCommentOpen=true");
  }, [pendingReviewFromServer, repoRef, prDetail, authQuery.data?.login, localComments, reviews, prsUnderReviewQuery]);

  const handleDeleteReviewClick = useCallback(() => {
    setShowDeleteReviewConfirm(true);
  }, []);

  const confirmDeleteReview = useCallback(async () => {
    if (!pendingReview || !repoRef || !prDetail) return;
    
    setShowDeleteReviewConfirm(false);
    
    // Check if this is a GitHub review (exists in server reviews array) or local review
    // Use same logic as submitReviewMutation for consistency
    const isGithubReview = reviews.some((r: PullRequestReview) => r.id === pendingReview.id && r.state === "PENDING" && r.is_mine);
    
    if (isGithubReview) {
      // GitHub review - use the delete review mutation
      void deleteReviewMutation.mutate(pendingReview.id);
    } else {
      // Local review - clear from database
      try {
        await invoke("cmd_local_clear_review", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          prNumber: prDetail.number,
          prTitle: prDetail.title || null,
        });
        setPendingReviewOverride(null);
        setLocalComments([]);
        void prsUnderReviewQuery.refetch();
        // Only close the comment panel if there are no remaining comments
        if (comments.length === 0) {
          setIsInlineCommentOpen(false);
        }
      } catch (error) {
        console.error("Failed to delete local review:", error);
        const message = error instanceof Error ? error.message : "Failed to delete local review.";
        setFileCommentError(message);
      }
    }
  }, [pendingReview, repoRef, prDetail, deleteReviewMutation, reviews]);

  // const handleCloseReviewClick = useCallback(() => {
  //   // Clear the review override to go back to viewing published comments, but keep panel open
  //   setPendingReviewOverride(null);
  //   setLocalComments([]);
  //   // Keep isInlineCommentOpen=true so the panel stays open showing published comments
  // }, []);

  const handleCommentSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = commentDraft.trim();
      if (!trimmed) {
        setCommentError("Add your feedback before sending.");
        return;
      }
      setCommentError(null);
      submitCommentMutation.mutate({ body: trimmed });
    },
    [commentDraft, submitCommentMutation],
  );

  const handleFileCommentSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const nativeEvent = event.nativeEvent as SubmitEvent;
      const submitter = nativeEvent?.submitter as HTMLButtonElement | null;
      const submitModeAttr = submitter?.getAttribute("data-submit-mode");
      const requestedMode: "single" | "review" | null =
        submitModeAttr === "review" ? "review" :
        submitModeAttr === "single" ? "single" :
        null;
      
      // Check if we're editing an existing comment
      if (editingCommentId !== null) {
        const trimmed = fileCommentDraft.trim();
        if (!trimmed) {
          setFileCommentError("Add your feedback before updating.");
          return;
        }
        
        setFileCommentError(null);
        updateCommentMutation.mutate({
          commentId: editingCommentId,
          body: trimmed,
        });
        return;
      }
      
      // Normal comment submission flow
      if (!selectedFilePath) {
        setFileCommentError("Select a file before commenting.");
        return;
      }

      const trimmed = fileCommentDraft.trim();
      if (!trimmed) {
        setFileCommentError("Add your feedback before sending.");
        return;
      }

      const commentMode: "single" | "review" = requestedMode ?? effectiveFileCommentMode;

      let parsedLine: number | null = null;
      let isFileLevelComment = fileCommentIsFileLevel;
      
      // If no line number provided, treat as file-level comment
      if (!fileCommentLine || fileCommentLine.trim() === "") {
        isFileLevelComment = true;
        parsedLine = null;
      } else if (!fileCommentIsFileLevel) {
        // Line number provided - validate it
        const numericLine = Number(fileCommentLine);
        if (!Number.isInteger(numericLine) || numericLine <= 0) {
          setFileCommentError("Line numbers must be positive integers.");
          return;
        }
        
        // Validate line number against file content
        if (selectedFile) {
          const content = fileCommentSide === "RIGHT" ? selectedFile.head_content : selectedFile.base_content;
          if (content) {
            const lines = content.split("\n");
            // If content ends with newline, split creates trailing empty string - remove it
            const lineCount = content.endsWith("\n") ? lines.length - 1 : lines.length;
            if (numericLine > lineCount) {
              setFileCommentError(`Line number ${numericLine} exceeds file length (${lineCount} lines).`);
              return;
            }
          }
        }
        
        parsedLine = numericLine;
      }

      setFileCommentError(null);
      submitFileCommentMutation.mutate({
        body: trimmed,
        line: parsedLine,
        side: fileCommentSide,
        mode: commentMode,
        subjectType: isFileLevelComment ? "file" : null,
        pendingReviewId: commentMode === "review" && pendingReview ? pendingReview.id : null,
      });
    },
    [
      editingCommentId,
      fileCommentDraft,
      fileCommentIsFileLevel,
      fileCommentLine,
      fileCommentMode,
      fileCommentSide,
      effectiveFileCommentMode,
      pendingReview,
      selectedFilePath,
      submitFileCommentMutation,
      updateCommentMutation,
      selectedFile,
    ],
  );

  const handleGlyphClick = useCallback((lineNumber: number) => {
    const lineNumberStr = String(lineNumber);
    
    // If inline editor is already open, just update the line number
    if (isAddingInlineComment) {
      setInlineCommentLine(lineNumberStr);
      // Scroll to bottom to make sure the editor is visible
      setTimeout(() => {
        if (commentPanelBodyRef.current) {
          commentPanelBodyRef.current.scrollTop = commentPanelBodyRef.current.scrollHeight;
        }
      }, 100);
    }
    // If file comment composer is open, update its line number
    else if (isFileCommentComposerVisible) {
      setFileCommentLine(lineNumberStr);
      setFileCommentIsFileLevel(false);
    }
    // Otherwise, open inline editor with the line number
    else {
      setIsAddingInlineComment(true);
      setInlineCommentLine(lineNumberStr);
      setInlineCommentDraft("");
      setInlineCommentError(null);
      setIsInlineCommentOpen(true);
      // Auto-expand sidebar if it's collapsed
      setIsSidebarCollapsed(false);
      // Scroll to bottom after a brief delay to allow render
      setTimeout(() => {
        if (commentPanelBodyRef.current) {
          commentPanelBodyRef.current.scrollTop = commentPanelBodyRef.current.scrollHeight;
        }
      }, 100);
    }
  }, [
    isAddingInlineComment,
    isFileCommentComposerVisible,
  ]);

  // Update ref whenever the callback changes
  handleGlyphClickRef.current = handleGlyphClick;

  const pullRequests = pullsQuery.data ?? [];
  
  // Filter PRs based on search input
  const filteredPullRequests = useMemo(() => {
    if (!pullRequests || pullRequests.length === 0) {
      return [];
    }
    if (!prSearchFilter || !prSearchFilter.trim()) {
      return pullRequests;
    }
    const searchNumber = parseInt(prSearchFilter.trim(), 10);
    if (!isNaN(searchNumber)) {
      return pullRequests.filter(pr => pr && pr.number === searchNumber);
    }
    // Also allow searching by title
    const searchLower = prSearchFilter.toLowerCase();
    return pullRequests.filter(pr => 
      pr && (
        pr.number.toString().includes(prSearchFilter) ||
        (pr.title && pr.title.toLowerCase().includes(searchLower)) ||
        (pr.author && pr.author.toLowerCase().includes(searchLower))
      )
    );
  }, [pullRequests, prSearchFilter]);
  const selectedPrSummary = selectedPr
    ? pullRequests.find((pr) => pr.number === selectedPr) ?? null
    : null;

  const authData = authQuery.data;
  if (authQuery.isLoading || authQuery.isPending) {
    return <div className="empty-state">Checking authentication…</div>;
  }

  if (!authData?.is_authenticated) {
    return (
      <div className="login-screen">
        <div>
          <h1 className="login-title">Sign in to GitHub</h1>
          <p className="login-hint">
            Connect with your GitHub account to browse pull requests and craft Markdown or YAML feedback without leaving the app.
          </p>
        </div>
        <div className="login-actions">
          <button onClick={handleLogin} disabled={loginMutation.isPending}>
            {loginMutation.isPending ? "Waiting for GitHub…" : "Continue with GitHub"}
          </button>
        </div>
      </div>
    );
  }
  const repoPanelExpanded = repoRef ? !isRepoPanelCollapsed : true;
  const prPanelExpanded = selectedPr ? !isPrPanelCollapsed : true;
  const userMenuAriaProps = isUserMenuOpen
    ? { "aria-expanded": "true" as const }
    : { "aria-expanded": "false" as const };
  const repoPanelAriaProps = repoPanelExpanded
    ? { "aria-expanded": "true" as const }
    : { "aria-expanded": "false" as const };
  const prPanelAriaProps = prPanelExpanded
    ? { "aria-expanded": "true" as const }
    : { "aria-expanded": "false" as const };

  return (
    <div
      ref={appShellRef}
      className={`app-shell${isSidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}`}
    >
      <aside className={`sidebar${isSidebarCollapsed ? " sidebar--collapsed" : ""}`}>
        <div className="sidebar__top">
          <button
            type="button"
            className="sidebar__collapse"
            onClick={toggleSidebar}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? ">" : "<"}
          </button>
          {!isSidebarCollapsed && (
            <>
              {!isOnline && (
                <div 
                  className="network-status network-status--offline"
                  title="Offline - using cached data"
                >
                  <svg className="network-status__icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M23.64 7c-.45-.34-4.93-4-11.64-4-1.5 0-2.89.19-4.15.48L18.18 13.8 23.64 7zm-6.6 8.22L3.27 1.44 2 2.72l2.05 2.06C1.91 5.76.59 6.82.36 7l11.63 14.49.01.01.01-.01 3.9-4.86 3.32 3.32 1.27-1.27-3.46-3.46z"/>
                  </svg>
                  <span className="network-status__text">Offline</span>
                </div>
              )}
              <div className="user-menu" ref={userMenuRef}>
              <button
                type="button"
                className={`user-chip user-chip--button${isUserMenuOpen ? " user-chip--open" : ""}`}
                onClick={toggleUserMenu}
                aria-haspopup="menu"
                {...userMenuAriaProps}
              >
                {authData.avatar_url ? (
                  <img src={authData.avatar_url} alt={authData.login ?? "GitHub user"} />
                ) : (
                  <div className="user-chip__avatar-fallback">
                    {(authData.login ?? "").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="user-chip__details">
                  <span className="chip-label">Signed in</span>
                  <span className="chip-value">{authData.login}</span>
                </div>
                <span className="user-chip__chevron" aria-hidden="true">
                  {isUserMenuOpen ? "^" : "v"}
                </span>
              </button>
              {isUserMenuOpen && (
                <div className="user-menu__popover" role="menu">
                  <button
                    type="button"
                    className="user-menu__item"
                    onClick={() => {
                      closeUserMenu();
                      void handlePickLocalFolder();
                    }}
                    role="menuitem"
                  >
                    Open Local Folder…
                  </button>
                  <button
                    type="button"
                    className="user-menu__item"
                    onClick={handleOpenLogFolder}
                    role="menuitem"
                  >
                    Open Log Folder
                  </button>
                  {import.meta.env.DEV && (
                    <button
                      type="button"
                      className="user-menu__item"
                      onClick={handleOpenDevtools}
                      role="menuitem"
                    >
                      Debugging
                    </button>
                  )}
                  <button
                    type="button"
                    className="user-menu__item"
                    onClick={handleLogout}
                    disabled={logoutMutation.isPending}
                    role="menuitem"
                  >
                    {logoutMutation.isPending ? "Signing out…" : "Logout"}
                  </button>
                </div>
              )}
            </div>
            </>
          )}
        </div>
        {!isSidebarCollapsed && (
          <div
            className={`sidebar__content${isInlineCommentOpen ? " sidebar__content--comments" : ""}`}
          >
            {isInlineCommentOpen ? (
              <>
                {prDetail && (
                  <div className="panel panel--collapsible panel--collapsed">
                    <div className="panel__header panel__header--condensed">
                      <button
                        type="button"
                        className="panel__title-button panel__title-button--inline"
                        onClick={() => {
                          setIsInlineCommentOpen(false);
                          setIsPrPanelCollapsed(false);
                        }}
                        title="Switch PR"
                      >
                        <span className="panel__expando-icon" aria-hidden="true">
                          &gt;
                        </span>
                        <span className="panel__title-text">PR</span>
                        <span className="panel__summary panel__summary--inline" title={`#${prDetail.number} · ${prDetail.title}`}>
                          #{prDetail.number} · {prDetail.title}
                        </span>
                      </button>
                      <a
                        href={`https://github.com/${repoRef?.owner}/${repoRef?.repo}/pull/${prDetail.number}`}
                        target="_blank"
                        rel="noreferrer"
                        className="panel__icon-button panel__icon-button--icon-only"
                        title="Open on GitHub"
                        aria-label="Open on GitHub"
                      >
                        <svg
                          className="panel__icon-svg"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path
                            d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zm-4 4h2v2H8v9h9v-4h2v6H6V7h4z"
                            fill="currentColor"
                          />
                        </svg>
                      </a>
                    </div>
                  </div>
                )}
                {prDetail && <div className="spacer-8" />}
              <div className="comment-panel">
                <div className="comment-panel__header">
                  <div className="comment-panel__title-wrapper">
                    {!shouldShowFileCommentComposer && (
                      <button
                        type="button"
                        className="comment-panel__back"
                        onClick={() => {
                          setShowCommentPanelMenu(false);
                          closeInlineComment();
                        }}
                        aria-label="Hide file comments"
                        title="Hide file comments"
                      >
                        ←
                      </button>
                    )}
                    <div className="comment-panel__title-group">
                      <span className="comment-panel__title">{shouldShowFileCommentComposer ? (editingCommentId !== null ? 'Edit comment' : 'Add comment') : 'File comments'}</span>
                      {selectedFilePath && (
                        <span className="comment-panel__subtitle" title={selectedFilePath}>
                          {selectedFilePath}
                        </span>
                      )}
                    </div>
                  </div>
                  {shouldShowFileCommentComposer ? (
                    editingCommentId !== null ? (
                      <button
                        type="button"
                        className="comment-panel__close"
                        onClick={() => {
                          setIsFileCommentComposerVisible(false);
                          setEditingCommentId(null);
                          setEditingComment(null);
                          setFileCommentDraft("");
                          setFileCommentLine("");
                          setFileCommentError(null);
                        }}
                        aria-label="Cancel edit"
                        title="Cancel edit"
                      >
                        ×
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="comment-panel__close comment-panel__close--restore"
                        onClick={() => {
                          // Transfer the draft from full editor to inline editor
                          const currentDraft = fileCommentDraft;
                          const currentLine = fileCommentLine;
                          setIsFileCommentComposerVisible(false);
                          setEditingCommentId(null);
                          setEditingComment(null);
                          setFileCommentDraft("");
                          setFileCommentLine("");
                          setFileCommentError(null);
                        
                          // If there's content in the full editor, restore it to inline editor
                          if (currentDraft.trim() || (selectedFilePath && draftsByFile[selectedFilePath]?.inline)) {
                            setIsAddingInlineComment(true);
                            const draft = currentDraft || (selectedFilePath ? draftsByFile[selectedFilePath]?.inline || "" : "");
                            setInlineCommentDraft(draft);
                            setInlineCommentLine(currentLine);
                            // Save to draftsByFile
                            if (selectedFilePath && draft) {
                              setDraftsByFile(prev => ({
                                ...prev,
                                [selectedFilePath]: {
                                  ...prev[selectedFilePath],
                                  inline: draft
                                }
                              }));
                            }
                          }
                        }}
                        aria-label="Back to comments"
                        title="Back to comments"
                      >
                        ⊟
                      </button>
                    )
                  ) : (
                    <div className="source-menu-container" ref={commentPanelMenuRef}>
                      <button
                        type="button"
                        className="panel__title-button"
                        onClick={() => setShowCommentPanelMenu((prev) => !prev)}
                        aria-label="File comments options"
                      >
                        …
                      </button>
                      {showCommentPanelMenu && (
                        <div className="source-menu">
                          <button
                            type="button"
                            className="source-menu__item"
                            onClick={() => {
                              setShowOutdatedComments((prev) => !prev);
                              setShowCommentPanelMenu(false);
                            }}
                          >
                            {showOutdatedComments ? 'Hide Outdated Comments' : 'Show Outdated Comments'}
                          </button>
                          <button
                            type="button"
                            className="source-menu__item"
                            onClick={() => {
                              setShowOnlyMyComments((prev) => !prev);
                              setShowCommentPanelMenu(false);
                            }}
                          >
                            {showOnlyMyComments ? "Show Everyone's Comments" : 'Show Only My Comments'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div 
                  className="comment-panel__body" 
                  ref={commentPanelBodyRef}
                  onContextMenu={(e) => {
                    // Only show "Add Comment" if right-clicking on empty space
                    if (e.target === commentPanelBodyRef.current) {
                      e.preventDefault();
                      setCommentContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        comment: null
                      });
                    }
                  }}
                >
                  {selectedFile ? (
                    shouldShowFileCommentComposer ? (
                      <form
                        className="comment-panel__form"
                        onSubmit={handleFileCommentSubmit}
                        ref={fileCommentFormRef}
                      >
                        <textarea
                          ref={fileCommentTextareaRef}
                          value={fileCommentDraft}
                          placeholder="Leave feedback on the selected file…"
                          onChange={(event) => {
                            setFileCommentDraft(event.target.value);
                            setFileCommentError(null);
                            setFileCommentSuccess(false);
                          }}
                          rows={6}
                          onKeyDown={(event) =>
                            handleCtrlEnter(event, () => {
                              if (editingCommentId !== null) {
                                triggerFileCommentSubmit();
                              } else {
                                triggerFileCommentSubmit(fileCommentDefaultMode);
                              }
                            })
                          }
                        />
                        {editingCommentId === null && fileCommentIsFileLevel && (
                          <label className="comment-panel__checkbox">
                            <input
                              type="checkbox"
                              checked={true}
                              disabled={true}
                            />
                            Mark as file-level comment
                          </label>
                        )}
                        {!fileCommentIsFileLevel && editingCommentId === null && (
                          <div className="comment-panel__row">
                            <label>
                              Line number
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                placeholder="(optional)"
                                value={fileCommentLine}
                                onChange={(event) => {
                                  setFileCommentLine(event.target.value);
                                  setFileCommentError(null);
                                  setFileCommentSuccess(false);
                                }}
                              />
                            </label>
                            {showDiff && (
                              <label>
                                Comment side
                                <select
                                  value={fileCommentSide}
                                  onChange={(event) => {
                                    setFileCommentSide(event.target.value as "RIGHT" | "LEFT");
                                    setFileCommentError(null);
                                    setFileCommentSuccess(false);
                                  }}
                                >
                                  <option value="RIGHT">Head (new code)</option>
                                  <option value="LEFT">Base (original code)</option>
                                </select>
                              </label>
                            )}
                          </div>
                        )}
                        {editingCommentId === null && (
                          <div className="comment-panel__status">
                            {fileCommentError && (
                              <span className="comment-status comment-status--error">{fileCommentError}</span>
                            )}
                            {!fileCommentError && fileCommentSuccess && (
                              <span className="comment-status comment-status--success">Comment saved</span>
                            )}
                          </div>
                        )}
                        {editingCommentId !== null && (
                          <div className="comment-panel__status">
                            {fileCommentError && (
                              <span className="comment-status comment-status--error">{fileCommentError}</span>
                            )}
                            {!fileCommentError && fileCommentSuccess && (
                              <span className="comment-status comment-status--success">Comment saved</span>
                            )}
                          </div>
                        )}
                        <div className="comment-panel__footer">
                          {editingCommentId !== null ? (
                            <div className="comment-panel__edit-actions">
                              <button
                                type="submit"
                                className="comment-submit"
                                disabled={updateCommentMutation.isPending}
                              >
                                {updateCommentMutation.isPending
                                  ? "Updating…"
                                  : (isLocalDirectoryMode ? "Update (log file)" : "Update Comment")}
                              </button>
                              <button
                                type="button"
                                className="comment-panel__action-button comment-panel__action-button--danger"
                                onClick={() => setShowDeleteConfirm(true)}
                                disabled={deleteCommentMutation.isPending}
                              >
                                {deleteCommentMutation.isPending ? "Deleting…" : "Delete Comment"}
                              </button>
                            </div>
                          ) : (
                            <div className="comment-panel__submit-actions">
                              {pendingReview?.html_url && (
                                <div className="comment-panel__info-note">
                                  Submit or delete the pending GitHub review to be able to add a comment to a new review.
                                </div>
                              )}
                              {!isOnline && !isLocalDirectoryMode && (
                                <div className="comment-panel__info-note comment-panel__info-note--warning">
                                  ⚠️ Offline - Direct comments disabled. Use "Start review" to save comments locally.
                                </div>
                              )}
                              <button
                                type="submit"
                                className={`comment-submit${fileCommentDefaultMode === "review" ? " comment-submit--secondary" : ""}`}
                                disabled={submitFileCommentMutation.isPending || (!isOnline && !isLocalDirectoryMode)}
                                data-submit-mode="single"
                                ref={fileCommentPostButtonRef}
                                title={
                                  isLocalDirectoryMode
                                    ? "Saved locally to log files"
                                    : !isOnline
                                      ? "Direct comments are disabled while offline"
                                      : ""
                                }
                              >
                                {submitFileCommentMutation.isPending && fileCommentSubmittingMode === "single"
                                  ? (isLocalDirectoryMode ? "Saving…" : "Sending…")
                                  : (isLocalDirectoryMode ? "Save comment (log file)" : "Post comment")}
                              </button>
                              {!isLocalDirectoryMode && (
                                effectiveFileCommentMode === "review" ? (
                                  pendingReview ? (
                                    hasLocalPendingReview ? (
                                      <button
                                        type="submit"
                                        className={`comment-submit${fileCommentDefaultMode === "review" ? "" : " comment-submit--secondary"}`}
                                        disabled={submitFileCommentMutation.isPending}
                                        data-submit-mode="review"
                                        ref={fileCommentReviewButtonRef}
                                      >
                                        {submitFileCommentMutation.isPending && fileCommentSubmittingMode === "review"
                                          ? "Saving…"
                                          : "Add to review"}
                                      </button>
                                    ) : null
                                  ) : (
                                    <button
                                      type="button"
                                      className="comment-submit comment-submit--secondary"
                                      disabled={startReviewMutation.isPending}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        setFileCommentMode("review");
                                        if (localComments.length > 0) {
                                          handleShowReviewClick();
                                        } else {
                                          handleStartReviewWithComment();
                                        }
                                      }}
                                    >
                                      {startReviewMutation.isPending
                                        ? "Starting…"
                                        : (localComments.length > 0 ? "Show review" : "Start review")}
                                    </button>
                                  )
                                ) : (
                                  <button
                                    type="button"
                                    className="comment-submit comment-submit--secondary"
                                    disabled={startReviewMutation.isPending}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setFileCommentMode("review");
                                      console.log("Start/Show review button clicked, localComments.length:", localComments.length, "fileCommentDraft:", fileCommentDraft);
                                      if (localComments.length > 0) {
                                        console.log("Calling handleShowReviewClick (show existing review)");
                                        handleShowReviewClick();
                                      } else {
                                        console.log("Calling handleStartReviewWithComment (new review)");
                                        handleStartReviewWithComment();
                                      }
                                    }}
                                  >
                                    {startReviewMutation.isPending
                                      ? "Starting…"
                                      : (localComments.length > 0 ? "Show review" : "Start review")}
                                  </button>
                                )
                              )}
                            </div>
                          )}
                        </div>
                      </form>
                    ) : (
                      <div className="comment-panel__existing">
                        {noCommentsDueToFilters && (
                          <div className="comment-panel__empty-state">
                            <p>No comments match the current filters.</p>
                          </div>
                        )}
                        {!noCommentsDueToFilters && fileComments.length === 0 && !pendingReview && (
                          <div className="comment-panel__empty-state">
                            <p>There are no published comments.</p>
                          </div>
                        )}
                        {!noCommentsDueToFilters && fileComments.length === 0 && pendingReview && !isLoadingPendingComments && (
                          <div className="comment-panel__empty-state">
                            <p>
                              There are no comments in this pending review{" "}
                              {pendingReview.html_url && (
                                <a
                                  className="comment-panel__review-link"
                                  href={pendingReview.html_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label="Open review on GitHub"
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="16" height="16">
                                    <path
                                      d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zm-4 4h2v2H8v9h9v-4h2v6H6V7h4z"
                                      fill="currentColor"
                                    />
                                  </svg>
                                </a>
                              )}
                            </p>
                          </div>
                        )}
                        {/* eslint-disable-next-line react/no-children-prop */}
                        <ul className="comment-panel__list">
                          {commentThreads.map((thread) => (
                            <li key={thread.parent.id}>
                              <CommentThreadItem
                                thread={thread}
                                collapsedComments={collapsedComments}
                                setCollapsedComments={setCollapsedComments}
                                editorRef={editorRef}
                              >
                              {(allCommentsInThread: PullRequestComment[], _isCollapsed: boolean, parentComment: PullRequestComment) => (
                                <>
                                  {/* Render all comments in thread */}
                                  {allCommentsInThread.map((comment: any, index: number) => {
                                    const formattedTimestamp = new Date(comment.created_at).toLocaleString();
                                    const isPendingGitHubReviewComment = comment.review_id === pendingReview?.id && pendingReview?.html_url;
                                    const isPendingLocalReviewComment = comment.is_draft && !pendingReview?.html_url;
                                    
                                    // Edit button rules:
                                    // - Show for pending local review comments (draft, no GitHub review)
                                    // - Show for my own non-draft comments
                                    // - Hide for pending GitHub review comments
                                    const showEditButton = !isPendingGitHubReviewComment && 
                                      (isPendingLocalReviewComment || (comment.is_mine && !comment.is_draft));
                                    
                                    // Reply button rules:
                                    // - Show on all comments
                                    // - Hide for pending local review comments
                                    // - Hide for pending GitHub review comments
                                    const showReplyButton = !isPendingLocalReviewComment && 
                                      !isPendingGitHubReviewComment;
                                    
                                    return (
                                      <div 
                                        key={comment.id}
                                        id={`comment-${comment.id}`}
                                        className={`comment-panel__thread-comment${index > 0 ? " comment-panel__thread-comment--reply" : ""}`}
                                        onContextMenu={(e) => {
                                          e.preventDefault();
                                          setCommentContextMenu({
                                            x: e.clientX,
                                            y: e.clientY,
                                            comment: comment
                                          });
                                        }}
                                      >
                                        <div className="comment-panel__thread-comment-header" title={formattedTimestamp}>
                                          <div className="comment-panel__thread-comment-info">
                                            <span className="comment-panel__item-author">{comment.author}</span>
                                            {(comment.is_draft || isPendingGitHubReviewComment) && (
                                              <span className="comment-panel__item-badge">Pending</span>
                                            )}
                                            {comment.outdated && (
                                              <span className="comment-panel__item-badge comment-panel__item-badge--outdated">Outdated</span>
                                            )}
                                          </div>
                                          <div className="comment-panel__thread-comment-actions">
                                            {showEditButton && (
                                              <button
                                                type="button"
                                                className="comment-panel__item-edit"
                                                onClick={() => {
                                                  // Capture scroll position BEFORE opening the editor
                                                  const currentScrollTop = commentPanelBodyRef.current?.scrollTop ?? 0;
                                                  preserveScrollPositionRef.current = currentScrollTop;
                                                  
                                                  setEditingCommentId(comment.id);
                                                  setEditingComment(comment);
                                                  setFileCommentDraft(comment.body);
                                                  setFileCommentLine(comment.line?.toString() || "");
                                                  setFileCommentSide(comment.side || "RIGHT");
                                                  setFileCommentIsFileLevel(!comment.line);
                                                  setFileCommentError(null);
                                                  setFileCommentSuccess(false);
                                                  setIsFileCommentComposerVisible(true);
                                                }}
                                                aria-label="Edit comment"
                                                title="Edit comment"
                                              >
                                                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="16" height="16">
                                                  <path
                                                    d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
                                                    fill="currentColor"
                                                  />
                                                </svg>
                                              </button>
                                            )}
                                            {showReplyButton && (
                                              <button
                                                type="button"
                                                className="comment-panel__item-reply"
                                                onClick={() => {
                                                  setReplyingToCommentId(parentComment.id);
                                                  setReplyDraft("");
                                                  setReplyError(null);
                                                  setReplySuccess(false);
                                                  // Scroll down just enough to show the reply form
                                                  setTimeout(() => {
                                                    const panel = commentPanelBodyRef.current;
                                                    const actions = replyActionsRefs.current[parentComment.id];
                                                    if (!panel || !actions) {
                                                      return;
                                                    }

                                                    const panelRect = panel.getBoundingClientRect();
                                                    const actionsRect = actions.getBoundingClientRect();
                                                    const bottomOverflow = actionsRect.bottom - panelRect.bottom;
                                                    if (bottomOverflow > 0) {
                                                      panel.scrollTop += bottomOverflow + 16;
                                                      return;
                                                    }

                                                    const topOverflow = panelRect.top - actionsRect.top;
                                                    if (topOverflow > 0) {
                                                      panel.scrollTop -= topOverflow + 16;
                                                    }
                                                  }, 100);
                                                }}
                                                aria-label="Reply to comment"
                                                title="Reply to comment"
                                              >
                                                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="16" height="16">
                                                  <path
                                                    d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"
                                                    fill="currentColor"
                                                  />
                                                </svg>
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                        <div className="comment-panel__thread-comment-content">
                                          <ReactMarkdown 
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                              code: ({ className, children, ...props }) => {
                                                const match = /language-(\w+)/.exec(className || '');
                                                const language = match ? match[1] : null;
                                                
                                                if (language === 'mermaid') {
                                                  return <MermaidCode>{String(children).trim()}</MermaidCode>;
                                                }
                                                
                                                return <code className={className} {...props}>{children}</code>;
                                              }
                                            }}
                                          >
                                            {(() => {
                                              // Strip [Line #] prefix from file-level comments for display
                                              // (the line number is already shown in the header)
                                              const parsed = parseLinePrefix(comment.body);
                                              return parsed.hasLinePrefix ? parsed.remainingBody : comment.body;
                                            })()}
                                          </ReactMarkdown>
                                        </div>
                                      </div>
                                    );
                                  })}
                                {/* Reply composer shown under this thread */}
                                {replyingToCommentId === parentComment.id && (
                                  <div className="comment-panel__reply-composer">
                                    <div className="comment-panel__reply-composer-header">
                                      <span className="comment-panel__reply-composer-title">Reply to comment</span>
                                      <div className="comment-panel__reply-composer-header-actions">
                                        <button
                                          type="button"
                                          className="comment-panel__reply-composer-maximize"
                                          onClick={() => {
                                            setFileCommentDraft(replyDraft);
                                            setFileCommentLine(parentComment.line?.toString() || "");
                                            setFileCommentSide(parentComment.side || "RIGHT");
                                            setFileCommentIsFileLevel(!parentComment.line);
                                            setReplyingToCommentId(null);
                                            setReplyDraft("");
                                            openFileCommentComposer(pendingReview ? "review" : "single");
                                          }}
                                          aria-label="Maximize to full editor"
                                          title="Maximize"
                                        >
                                          ⊡
                                        </button>
                                        <button
                                          type="button"
                                          className="comment-panel__reply-composer-close"
                                          onClick={() => {
                                            setReplyingToCommentId(null);
                                            setReplyDraft("");
                                            setReplyError(null);
                                            setReplySuccess(false);
                                          }}
                                          aria-label="Close reply composer"
                                          title="Close"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    </div>
                                    <textarea
                                      ref={(element) => {
                                        if (element) {
                                          replyTextareaRefs.current[parentComment.id] = element;
                                        } else {
                                          delete replyTextareaRefs.current[parentComment.id];
                                        }
                                      }}
                                      value={replyDraft}
                                      onChange={(e) => {
                                        setReplyDraft(e.target.value);
                                      }}
                                      placeholder="Write a reply..."
                                      className="comment-panel__reply-textarea"
                                      rows={4}
                                      onKeyDown={(event) =>
                                        handleCtrlEnter(event, () => {
                                          if (replyDefaultMode === "review") {
                                            triggerButtonClick(replyReviewButtonRef.current);
                                          } else {
                                            triggerButtonClick(replyPostButtonRef.current);
                                          }
                                        })
                                      }
                                    />
                                    {replyError && (
                                      <div className="comment-panel__error">{replyError}</div>
                                    )}
                                    {replySuccess && (
                                      <div className="comment-panel__success">{isLocalDirectoryMode ? "Reply saved" : "Reply posted!"}</div>
                                    )}
                                    <div
                                      className="comment-panel__reply-actions"
                                      ref={(element) => {
                                        if (element) {
                                          replyActionsRefs.current[parentComment.id] = element;
                                        } else {
                                          delete replyActionsRefs.current[parentComment.id];
                                        }
                                      }}
                                    >
                                      <button
                                        type="button"
                                        className={`comment-submit${replyDefaultMode === "review" ? " comment-submit--secondary" : ""}`}
                                        disabled={!isOnline && !isLocalDirectoryMode}
                                        title={
                                          isLocalDirectoryMode
                                            ? "Saved locally to log files"
                                            : !isOnline
                                              ? "Direct comment replies are disabled while offline"
                                              : ""
                                        }
                                        ref={replyPostButtonRef}
                                        onClick={async () => {
                                          if (!replyDraft.trim()) {
                                            setReplyError("Reply cannot be empty");
                                            return;
                                          }
                                          if (!prDetail || !repoRef) {
                                            setReplyError("No PR details available");
                                            return;
                                          }
                                          if (!selectedFilePath) {
                                            setReplyError("No file selected");
                                            return;
                                          }
                                          try {
                                            setReplyError(null);

                                            if (isLocalDirectoryMode) {
                                              await invoke("cmd_local_add_comment", {
                                                owner: repoRef.owner,
                                                repo: repoRef.repo,
                                                prNumber: prDetail.number,
                                                filePath: selectedFilePath,
                                                lineNumber: parentComment.line || null,
                                                side: parentComment.side || "LEFT",
                                                body: replyDraft,
                                                commitId: prDetail.head_sha,
                                                inReplyToId: parentComment.id,
                                                localFolder: activeLocalDir ?? null,
                                              });
                                              await loadLocalComments();
                                            } else {
                                              await invoke("cmd_submit_file_comment", {
                                                args: {
                                                  owner: repoRef.owner,
                                                  repo: repoRef.repo,
                                                  number: prDetail.number,
                                                  path: selectedFilePath,
                                                  body: replyDraft,
                                                  commit_id: prDetail.head_sha,
                                                  line: parentComment.line || null,
                                                  side: parentComment.side || null,
                                                  subject_type: parentComment.line ? null : "file",
                                                  mode: "single",
                                                  pending_review_id: pendingReview?.id || null,
                                                  in_reply_to: parentComment.id,
                                                },
                                              });
                                              // Refetch comments
                                              await queryClient.refetchQueries({
                                                queryKey: ["pr-comments", repoRef.owner, repoRef.repo, selectedPr]
                                              });
                                              await queryClient.refetchQueries({
                                                queryKey: ["pull-request", repoRef.owner, repoRef.repo, selectedPr]
                                              });
                                            }

                                            setReplyDraft("");
                                            setReplyingToCommentId(null);
                                            if (selectedFilePath) {
                                              setDraftsByFile(prev => {
                                                const newDrafts = { ...prev };
                                                if (newDrafts[selectedFilePath]?.reply) {
                                                  delete newDrafts[selectedFilePath].reply![parentComment.id];
                                                  if (shouldDeleteFileDraft(newDrafts[selectedFilePath])) {
                                                    delete newDrafts[selectedFilePath];
                                                  }
                                                }
                                                return newDrafts;
                                              });
                                            }
                                          } catch (err) {
                                            setReplyError(err instanceof Error ? err.message : String(err));
                                          }
                                        }}
                                      >
                                        {isLocalDirectoryMode ? "Save reply (log file)" : "Post comment"}
                                      </button>
                                      {!isOnline && !isLocalDirectoryMode && (
                                        <div className="comment-panel__info-note comment-panel__info-note--warning">
                                          ⚠️ Offline - Use "Add to review" to save replies locally
                                        </div>
                                      )}
                                      {!isLocalDirectoryMode && hasLocalPendingReview ? (
                                        <button
                                          type="button"
                                          className={`comment-submit${replyDefaultMode === "review" ? "" : " comment-submit--secondary"}`}
                                          onClick={async () => {
                                            if (!replyDraft.trim()) {
                                              setReplyError("Reply cannot be empty");
                                              return;
                                            }
                                            if (!prDetail || !repoRef) {
                                              setReplyError("No PR details available");
                                              return;
                                            }
                                            try {
                                              setReplyError(null);
                                              
                                              // Add reply to local review
                                              await invoke("cmd_local_add_comment", {
                                                owner: repoRef.owner,
                                                repo: repoRef.repo,
                                                prNumber: prDetail.number,
                                                filePath: selectedFilePath,
                                                lineNumber: parentComment.line || null,
                                                side: parentComment.side || "LEFT",
                                                body: replyDraft,
                                                commitId: prDetail.head_sha,
                                                inReplyToId: parentComment.id,
                                              });
                                              
                                              // Clear form
                                              setReplyDraft("");
                                              setReplyingToCommentId(null);
                                              
                                              // Clear drafts
                                              if (selectedFilePath) {
                                                setDraftsByFile(prev => {
                                                  const newDrafts = { ...prev };
                                                  if (newDrafts[selectedFilePath]?.reply) {
                                                    delete newDrafts[selectedFilePath].reply![parentComment.id];
                                                    if (shouldDeleteFileDraft(newDrafts[selectedFilePath])) {
                                                      delete newDrafts[selectedFilePath];
                                                    }
                                                  }
                                                  return newDrafts;
                                                });
                                              }
                                              
                                              // Reload local comments
                                              await loadLocalComments();
                                            } catch (err) {
                                              setReplyError(err instanceof Error ? err.message : String(err));
                                            }
                                          }}
                                          ref={replyReviewButtonRef}
                                        >
                                          Add to review
                                        </button>
                                      ) : (!isLocalDirectoryMode && !pendingReview) ? (
                                        <button
                                          type="button"
                                          className="comment-submit comment-submit--secondary"
                                          onClick={async () => {
                                            if (!replyDraft.trim()) {
                                              setReplyError("Reply cannot be empty");
                                              return;
                                            }
                                            if (!prDetail || !repoRef) {
                                              setReplyError("No PR details available");
                                              return;
                                            }
                                            try {
                                              setReplyError(null);
                                              // Add reply to local review
                                              await invoke("cmd_local_add_comment", {
                                                owner: repoRef.owner,
                                                repo: repoRef.repo,
                                                prNumber: prDetail.number,
                                                filePath: selectedFilePath,
                                                lineNumber: parentComment.line || null,
                                                side: parentComment.side || "LEFT",
                                                body: replyDraft,
                                                commitId: prDetail.head_sha,
                                                inReplyToId: parentComment.id,
                                              });

                                              // Clear form
                                              setReplySuccess(true);
                                              setReplyDraft("");

                                              // Clear drafts
                                              if (selectedFilePath) {
                                                setDraftsByFile(prev => {
                                                  const newDrafts = { ...prev };
                                                  if (newDrafts[selectedFilePath]?.reply) {
                                                    delete newDrafts[selectedFilePath].reply![parentComment.id];
                                                    if (shouldDeleteFileDraft(newDrafts[selectedFilePath])) {
                                                      delete newDrafts[selectedFilePath];
                                                    }
                                                  }
                                                  return newDrafts;
                                                });
                                              }

                                              // Reload local comments and show review panel
                                              await loadLocalComments();
                                              setIsInlineCommentOpen(true);

                                              // Create pending review override
                                              if (prDetail && authQuery.data?.login) {
                                                const localReview = createLocalReview({
                                                  prNumber: prDetail.number,
                                                  author: authQuery.data.login,
                                                  commitId: prDetail.head_sha,
                                                });
                                            setPendingReviewOverride(localReview);
                                          }

                                          await prsUnderReviewQuery.refetch();
                                          
                                          setTimeout(() => {
                                            setReplyingToCommentId(null);
                                            setReplySuccess(false);
                                          }, 1500);
                                        } catch (err) {
                                              setReplyError(err instanceof Error ? err.message : String(err));
                                            }
                                          }}
                                        >
                                          Start review
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                )}
                                </>
                              )}
                              </CommentThreadItem>
                            </li>
                          ))}
                        </ul>
                        {/* Inline new comment composer */}
                        {(isAddingInlineComment || (selectedFilePath && draftsByFile[selectedFilePath]?.inline)) && (
                          <div className="comment-panel__reply-composer">
                            <div className="comment-panel__reply-composer-header">
                              <span className="comment-panel__reply-composer-title">New comment</span>
                              <div className="comment-panel__reply-composer-header-actions">
                                <button
                                  type="button"
                                  className="comment-panel__reply-composer-maximize"
                                  onClick={() => {
                                    setFileCommentDraft(inlineCommentDraft);
                                    setFileCommentLine(inlineCommentLine);
                                    setIsAddingInlineComment(false);
                                    setInlineCommentDraft("");
                                    setInlineCommentLine("");
                                    // Clear the draft from storage since it's being moved to full editor
                                    if (selectedFilePath) {
                                      setDraftsByFile(prev => {
                                        const newDrafts = { ...prev };
                                        if (newDrafts[selectedFilePath]) {
                                          delete newDrafts[selectedFilePath].inline;
                                          if (shouldDeleteFileDraft(newDrafts[selectedFilePath])) {
                                            delete newDrafts[selectedFilePath];
                                          }
                                        }
                                        return newDrafts;
                                      });
                                    }
                                    openFileCommentComposer(pendingReview ? "review" : "single");
                                  }}
                                  aria-label="Maximize to full editor"
                                  title="Maximize"
                                >
                                  ⊡
                                </button>
                                <button
                                  type="button"
                                  className="comment-panel__reply-composer-close"
                                  onClick={() => {
                                    setIsAddingInlineComment(false);
                                    setInlineCommentDraft("");
                                    setInlineCommentError(null);
                                    setFileCommentSuccess(false);
                                    // Clear the draft from storage
                                    if (selectedFilePath) {
                                      setDraftsByFile(prev => {
                                        const newDrafts = { ...prev };
                                        if (newDrafts[selectedFilePath]) {
                                          delete newDrafts[selectedFilePath].inline;
                                          if (shouldDeleteFileDraft(newDrafts[selectedFilePath])) {
                                            delete newDrafts[selectedFilePath];
                                          }
                                        }
                                        return newDrafts;
                                      });
                                    }
                                  }}
                                  aria-label="Close comment composer"
                                  title="Close"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                            <textarea
                              value={inlineCommentDraft}
                              onChange={(e) => {
                                setInlineCommentDraft(e.target.value);
                              }}
                              placeholder="Write a comment..."
                              className="comment-panel__reply-textarea"
                              rows={4}
                              autoFocus
                              onKeyDown={(event) =>
                                handleCtrlEnter(event, () => {
                                  if (inlineDefaultMode === "review") {
                                    triggerButtonClick(inlineCommentReviewButtonRef.current);
                                  } else {
                                    triggerButtonClick(inlineCommentPostButtonRef.current);
                                  }
                                })
                              }
                            />
                            <div className="comment-panel__line-input">
                              <label htmlFor="inline-comment-line">Line number: </label>
                              <input
                                id="inline-comment-line"
                                type="text"
                                placeholder="(optional)"
                                value={inlineCommentLine}
                                onChange={(e) => setInlineCommentLine(e.target.value)}
                              />
                            </div>
                            {inlineCommentError && (
                              <div className="comment-panel__error">{inlineCommentError}</div>
                            )}
                            {!isOnline && !isLocalDirectoryMode && (
                              <div className="comment-panel__info-note comment-panel__info-note--warning">
                                ⚠️ Offline - Direct comments disabled. Use "Add to review" to save comments locally.
                              </div>
                            )}
                            <div className="comment-panel__reply-actions">
                              <button
                                type="button"
                                className={`comment-submit${inlineDefaultMode === "review" ? " comment-submit--secondary" : ""}`}
                                disabled={!isOnline && !isLocalDirectoryMode}
                                title={
                                  isLocalDirectoryMode
                                    ? "Saved locally to log files"
                                    : !isOnline
                                      ? "Direct comments are disabled while offline"
                                      : ""
                                }
                                ref={inlineCommentPostButtonRef}
                                onClick={async () => {
                                  if (!inlineCommentDraft.trim()) {
                                    setInlineCommentError("Comment cannot be empty");
                                    return;
                                  }
                                  if (!prDetail || !repoRef || !selectedFilePath) {
                                    setInlineCommentError("No file selected");
                                    return;
                                  }
                                  try {
                                    setInlineCommentError(null);
                                    const lineNum = inlineCommentLine.trim() ? parseInt(inlineCommentLine.trim(), 10) : null;
                                    const hasLine = lineNum !== null && !isNaN(lineNum) && lineNum > 0;

                                    if (isLocalDirectoryMode) {
                                      await invoke("cmd_local_add_comment", {
                                        owner: repoRef.owner,
                                        repo: repoRef.repo,
                                        prNumber: prDetail.number,
                                        filePath: selectedFilePath,
                                        lineNumber: hasLine ? lineNum : null,
                                        side: hasLine ? "RIGHT" : "LEFT",
                                        body: inlineCommentDraft,
                                        commitId: prDetail.head_sha,
                                        inReplyToId: null,
                                        localFolder: activeLocalDir ?? null,
                                      });
                                      await loadLocalComments();
                                    } else {
                                      await invoke("cmd_submit_file_comment", {
                                        args: {
                                          owner: repoRef.owner,
                                          repo: repoRef.repo,
                                          number: prDetail.number,
                                          path: selectedFilePath,
                                          body: inlineCommentDraft,
                                          commit_id: prDetail.head_sha,
                                          line: hasLine ? lineNum : null,
                                          side: hasLine ? "RIGHT" : null,
                                          subject_type: hasLine ? null : "file",
                                          mode: "single",
                                          pending_review_id: null,
                                          in_reply_to: null,
                                        },
                                      });
                                      await queryClient.refetchQueries({
                                        queryKey: ["pr-comments", repoRef.owner, repoRef.repo, selectedPr]
                                      });
                                      await queryClient.refetchQueries({
                                        queryKey: ["pull-request", repoRef.owner, repoRef.repo, selectedPr]
                                      });
                                    }
                                    setInlineCommentDraft("");
                                    setInlineCommentLine("");
                                    setIsAddingInlineComment(false);
                                    if (selectedFilePath) {
                                      setDraftsByFile(prev => {
                                        const newDrafts = { ...prev };
                                        if (newDrafts[selectedFilePath]) {
                                          delete newDrafts[selectedFilePath].inline;
                                          if (shouldDeleteFileDraft(newDrafts[selectedFilePath])) {
                                            delete newDrafts[selectedFilePath];
                                          }
                                        }
                                        return newDrafts;
                                      });
                                    }
                                  } catch (err) {
                                    setInlineCommentError(err instanceof Error ? err.message : String(err));
                                  }
                                }}
                              >
                                {isLocalDirectoryMode ? "Save comment (log file)" : "Post comment"}
                              </button>
                              {!isLocalDirectoryMode && hasLocalPendingReview ? (
                                <button
                                  type="button"
                                  className={`comment-submit${inlineDefaultMode === "review" ? "" : " comment-submit--secondary"}`}
                                  onClick={async () => {
                                    if (!inlineCommentDraft.trim()) {
                                      setInlineCommentError("Comment cannot be empty");
                                      return;
                                    }
                                    if (!prDetail || !repoRef || !selectedFilePath) {
                                      setInlineCommentError("No file selected");
                                      return;
                                    }
                                    try {
                                      setInlineCommentError(null);
                                      
                                      // Parse line number
                                      const lineNum = inlineCommentLine.trim() ? parseInt(inlineCommentLine.trim(), 10) : null;
                                      const hasLine = lineNum !== null && !isNaN(lineNum) && lineNum > 0;
                                      
                                      // Add comment to local review
                                      await invoke("cmd_local_add_comment", {
                                        owner: repoRef.owner,
                                        repo: repoRef.repo,
                                        prNumber: prDetail.number,
                                        filePath: selectedFilePath,
                                        lineNumber: hasLine ? lineNum : null,
                                        side: hasLine ? "RIGHT" : "LEFT",
                                        body: inlineCommentDraft,
                                        commitId: prDetail.head_sha,
                                        inReplyToId: null,
                                      });
                                      
                                      // Clear form
                                      setInlineCommentDraft("");
                                      setInlineCommentLine("");
                                      setIsAddingInlineComment(false);
                                      
                                      // Clear drafts
                                      if (selectedFilePath) {
                                        setDraftsByFile(prev => {
                                          const newDrafts = { ...prev };
                                          if (newDrafts[selectedFilePath]) {
                                            delete newDrafts[selectedFilePath].inline;
                                            if (shouldDeleteFileDraft(newDrafts[selectedFilePath])) {
                                              delete newDrafts[selectedFilePath];
                                            }
                                          }
                                          return newDrafts;
                                        });
                                      }
                                      
                                      // Reload local comments
                                      await loadLocalComments();
                                    } catch (err) {
                                      setInlineCommentError(err instanceof Error ? err.message : String(err));
                                    }
                                  }}
                                  ref={inlineCommentReviewButtonRef}
                                >
                                  Add to review
                                </button>
                              ) : (!isLocalDirectoryMode && !pendingReview) ? (
                                <button
                                  type="button"
                                  className="comment-submit comment-submit--secondary"
                                  onClick={async () => {
                                    if (!inlineCommentDraft.trim()) {
                                      setInlineCommentError("Comment cannot be empty");
                                      return;
                                    }
                                    if (!prDetail || !repoRef || !selectedFilePath) {
                                      setInlineCommentError("No file selected");
                                      return;
                                    }
                                    try {
                                      setInlineCommentError(null);
                                      // Parse line number
                                      const lineNum = inlineCommentLine.trim() ? parseInt(inlineCommentLine.trim(), 10) : null;
                                      const hasLine = lineNum !== null && !isNaN(lineNum) && lineNum > 0;

                                      // Add comment to local review
                                      await invoke("cmd_local_add_comment", {
                                        owner: repoRef.owner,
                                        repo: repoRef.repo,
                                        prNumber: prDetail.number,
                                        filePath: selectedFilePath,
                                        lineNumber: hasLine ? lineNum : null,
                                        side: hasLine ? "RIGHT" : "LEFT",
                                        body: inlineCommentDraft,
                                        commitId: prDetail.head_sha,
                                        inReplyToId: null,
                                      });

                                      // Clear form
                                      setInlineCommentDraft("");
                                      setInlineCommentLine("");
                                      setIsAddingInlineComment(false);

                                      // Clear drafts
                                      if (selectedFilePath) {
                                        setDraftsByFile(prev => {
                                          const newDrafts = { ...prev };
                                          if (newDrafts[selectedFilePath]) {
                                            delete newDrafts[selectedFilePath].inline;
                                            if (shouldDeleteFileDraft(newDrafts[selectedFilePath])) {
                                              delete newDrafts[selectedFilePath];
                                            }
                                          }
                                          return newDrafts;
                                        });
                                      }

                                      // Reload local comments and show review panel
                                      await loadLocalComments();
                                      setIsInlineCommentOpen(true);

                                      // Create pending review override
                                      if (prDetail && authQuery.data?.login) {
                                        const localReview = createLocalReview({
                                          prNumber: prDetail.number,
                                          author: authQuery.data.login,
                                          commitId: prDetail.head_sha,
                                        });
                                        setPendingReviewOverride(localReview);
                                      }

                                      await prsUnderReviewQuery.refetch();
                                    } catch (err) {
                                      setInlineCommentError(err instanceof Error ? err.message : String(err));
                                    }
                                  }}
                                >
                                  Start review
                                </button>
                              ) : null}
                            </div>
                          </div>
                        )}
                        <div className="comment-panel__actions">
                          {pendingReview?.html_url ? (
                            <div className="comment-panel__info-note">
                              Submit or delete the pending GitHub review to be able to add a new comment.
                            </div>
                          ) : !isAddingInlineComment && !(selectedFilePath && draftsByFile[selectedFilePath]?.inline) && (
                            <>
                              <button
                                type="button"
                                className="comment-panel__action-button"
                                onClick={() => handleAddCommentClick()}
                                disabled={startReviewMutation.isPending}
                              >
                                Add comment
                              </button>
                              {!pendingReview && !isLocalDirectoryMode && (pendingReviewFromServer || localComments.length > 0) && (
                                <button
                                  type="button"
                                  className="comment-panel__action-button comment-panel__action-button--secondary"
                                  onClick={handleShowReviewClick}
                                >
                                  Show Review
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )
                  ) : pullDetailQuery.isLoading || isLoadingTocContent ? (
                    <div className="comment-panel__empty">Loading files…</div>
                  ) : (
                    <div className="comment-panel__empty">Select a file to leave feedback.</div>
                  )}
                </div>
                {pendingReview && !isLocalDirectoryMode && (
                  <div className="pr-comments-view__footer">
                    {submissionProgress && (
                      <div className="comment-panel__progress">
                        Submitting comment {submissionProgress.current} of {submissionProgress.total}...
                      </div>
                    )}
                    <div className="pr-comments-view__footer-buttons">
                      <button
                        type="button"
                        className="comment-panel__action-button comment-panel__action-button--primary"
                        onClick={handleSubmitReviewClick}
                        disabled={submitReviewMutation.isPending || localComments.length === 0}
                      >
                        {submitReviewMutation.isPending
                          ? (isLocalDirectoryMode ? "Saving…" : "Submitting…")
                          : (isLocalDirectoryMode ? (
                            <>
                              Save review
                              <br />
                              (log file)
                            </>
                          ) : "Submit review")}
                      </button>
                      <button
                        type="button"
                        className="comment-panel__action-button comment-panel__action-button--danger"
                        onClick={handleDeleteReviewClick}
                        disabled={deleteReviewMutation.isPending}
                      >
                        {deleteReviewMutation.isPending ? "Deleting…" : "Delete review"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              </>
            ) : (
              <>
                <div
                  className={`panel panel--collapsible panel--repo${
                    isRepoPanelCollapsed && repoRef ? " panel--collapsed" : ""
                  }`}
                >
                  <div
                    className={`panel__header${
                      isRepoPanelCollapsed && repoRef ? " panel__header--condensed" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="panel__title-button panel__title-button--inline"
                      onClick={handleToggleRepoPanel}
                      {...repoPanelAriaProps}
                    >
                      <span className="panel__expando-icon" aria-hidden="true">
                        {isRepoPanelCollapsed && repoRef ? ">" : "v"}
                      </span>
                      <span className="panel__title-text">Repository</span>
                      {repoRef && (
                        <span className="panel__summary panel__summary--inline" title={formattedRepoTitle}>
                          {formattedRepo}
                        </span>
                      )}
                    </button>
                    {repoRef && !isLocalDirectoryMode && (
                      <button
                        type="button"
                        className="panel__icon-button panel__icon-button--icon-only"
                        onClick={handleRefreshPulls}
                        title="Refresh pull requests"
                        aria-label="Refresh pull requests"
                      >
                        <svg
                          className="panel__icon-svg"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path
                            d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 0 0-8 8h2a6 6 0 0 1 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"
                            fill="currentColor"
                          />
                        </svg>
                        <span className="sr-only">Refresh pull requests</span>
                      </button>
                    )}
                  </div>
                  {!isRepoPanelCollapsed && (
                    <div className="panel__body">
                      <form className="repo-form" onSubmit={handleRepoSubmit}>
                        <div className="repo-form__input-group">
                          <input
                            value={repoInput}
                            placeholder="docs/handbook"
                            onChange={(event) => setRepoInput(event.target.value)}
                          />
                          {(repoMRU.length > 0 || localDirMRU.length > 0) && (
                            <div className="repo-form__dropdown-wrapper">
                              <button
                                type="button"
                                className={`repo-form__dropdown${showRepoMRU ? " repo-form__dropdown--open" : ""}`}
                                onClick={() => setShowRepoMRU(!showRepoMRU)}
                                aria-label="Recent repositories"
                              >
                                ▼
                              </button>
                              {showRepoMRU && (
                                <div className="repo-form__mru">
                                  {repoMRU.filter(r => r !== formattedRepo).map(repo => (
                                    <button
                                      key={repo}
                                      type="button"
                                      className="repo-form__mru-item"
                                      onClick={() => {
                                        setRepoInput(repo);
                                        setShowRepoMRU(false);
                                        // Auto-load the selected repository
                                        const match = /^([\w.-]+)\/([\w.-]+)$/.exec(repo);
                                        if (match) {
                                          const owner = match[1];
                                          const repository = match[2];
                                          setRepoError(null);
                                          exitLocalDirectoryMode();
                                          setRepoRef({ owner, repo: repository });
                                          setSelectedPr(null);
                                          setSelectedFilePath(null);
                                          setPrSearchFilter("");
                                          setPrMode("repo"); // Switch to repo mode when selecting from MRU
                                          queryClient.removeQueries({ queryKey: ["pull-request"] });
                                        }
                                      }}
                                    >
                                      {repo}
                                    </button>
                                  ))}
                                  {localDirMRU
                                    .filter((dir) => dir && dir !== activeLocalDir)
                                    .map((dir) => (
                                      <button
                                        key={dir}
                                        type="button"
                                        className="repo-form__mru-item"
                                        onClick={() => {
                                          setShowRepoMRU(false);
                                          enterLocalDirectoryMode(dir);
                                        }}
                                        title={dir}
                                      >
                                        {formatLocalDirDisplay(dir)}
                                      </button>
                                    ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <button
                          type="submit"
                          className="repo-form__submit"
                          disabled={pullsQuery.isFetching}
                        >
                          {pullsQuery.isFetching ? "Loading" : "Load"}
                        </button>
                      </form>
                      {repoError && <span className="repo-error">{repoError}</span>}
                      {formattedRepo && (
                        <span className="chip-label repo-indicator">
                          VIEWING {formattedRepo.toUpperCase()}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div
                  className={`panel panel--collapsible panel--pulls${
                    isPrPanelCollapsed && selectedPr ? " panel--collapsed" : ""
                  }`}
                >
                  <div
                    className={`panel__header${
                      isPrPanelCollapsed && selectedPr ? " panel__header--condensed" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="panel__title-button panel__title-button--inline"
                      onClick={handleTogglePrPanel}
                      disabled={!isLocalDirectoryMode && (prMode === "under-review" ? !enhancedPrsUnderReview.length : !pullRequests.length)}
                      {...prPanelAriaProps}
                    >
                      <span className="panel__expando-icon" aria-hidden="true">
                        {isPrPanelCollapsed && selectedPr ? ">" : "v"}
                      </span>
                      <span className="panel__title-text">{isPrPanelCollapsed && selectedPr ? "PR" : (prMode === "under-review" ? "PRs Under Review" : "PRs")}</span>
                      {selectedPrSummary ? (
                        <span
                          className="panel__summary panel__summary--inline"
                          title={`#${selectedPrSummary.number} · ${selectedPrSummary.title}`}
                        >
                          #{selectedPrSummary.number} · {selectedPrSummary.title}
                        </span>
                      ) : (
                        selectedPr && (
                          <span className="panel__summary panel__summary--inline">
                            Pull request #{selectedPr}
                          </span>
                        )
                      )}
                    </button>
                    {!isPrPanelCollapsed && (
                      <div ref={prFilterMenuRef} className="panel__menu-container">
                        <button
                          type="button"
                          className="panel__title-button"
                          onClick={togglePrFilterMenu}
                          title="Filter options"
                          aria-label="Filter options"
                        >
                          …
                        </button>
                      {isPrFilterMenuOpen && (
                        <div className="pr-filter-menu__popover" role="menu">
                          <button
                            type="button"
                            className="pr-filter-menu__item"
                            onClick={() => {
                              setPrMode(prMode === "under-review" ? "repo" : "under-review");
                              closePrFilterMenu();
                            }}
                            role="menuitem"
                          >
                            {prMode === "under-review" ? "Show Repo PRs" : "Show PRs Under Review"}
                          </button>
                          {prMode === "repo" && (
                            <button
                              type="button"
                              className="pr-filter-menu__item"
                              onClick={() => {
                                setShowClosedPRs(!showClosedPRs);
                                closePrFilterMenu();
                              }}
                              role="menuitem"
                            >
                              {showClosedPRs ? "Hide Closed PRs" : "Show Closed PRs"}
                            </button>
                          )}
                        </div>
                      )}
                      </div>
                    )}
                    {isPrPanelCollapsed && selectedPr && prDetail && repoRef && (
                      <a
                        href={`https://github.com/${repoRef.owner}/${repoRef.repo}/pull/${prDetail.number}`}
                        target="_blank"
                        rel="noreferrer"
                        className="panel__icon-button panel__icon-button--icon-only"
                        title="Open on GitHub"
                        aria-label="Open on GitHub"
                      >
                        <svg
                          className="panel__icon-svg"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path
                            d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zm-4 4h2v2H8v9h9v-4h2v6H6V7h4z"
                            fill="currentColor"
                          />
                        </svg>
                      </a>
                    )}
                  </div>
                  {!isPrPanelCollapsed && (
                    <div className="panel__body panel__body--with-search">
                      {prMode === "repo" && (
                        <div className="panel__search-header">
                          <input
                            type="text"
                            className="panel__search-input"
                            placeholder="Search PR # or title..."
                            value={prSearchFilter}
                            onChange={(e) => setPrSearchFilter(e.target.value)}
                          />
                        </div>
                      )}
                      <div className="panel__scroll-content">
                        {prMode === "under-review" ? (
                          // Only show loading if we have no results yet
                          enhancedPrsUnderReview.length === 0 && (prsUnderReviewQuery.isLoading || mruOpenPrsQueries.some(q => q.isLoading) || mruClosedPrsQueries.some(q => q.isLoading)) ? (
                            <div className="empty-state empty-state--subtle">Loading PRs under review…</div>
                          ) : enhancedPrsUnderReview.length === 0 ? (
                            <div className="empty-state empty-state--subtle">
                              No PRs under review.
                            </div>
                          ) : (
                            enhancedPrsUnderReview.map((pr) => {
                              const isLocalUnderReview = pr.owner === "__local__" && pr.repo === "local" && !!pr.local_folder;
                              const localFolder = pr.local_folder ?? "";
                              const localFolderParts = localFolder.replace(/\//g, "\\").split("\\").filter(Boolean);
                              const localFolderLeaf = localFolderParts.length > 0 ? localFolderParts[localFolderParts.length - 1] : "Local folder";
                              const prTitleLabel = isLocalUnderReview ? localFolderLeaf : `#${pr.number} · ${pr.title || `${pr.owner}/${pr.repo}#${pr.number}`}`;
                              const prRepoLabel = isLocalUnderReview && pr.local_folder
                                ? formatLocalDirDisplay(pr.local_folder)
                                : `${pr.owner}/${pr.repo}`;

                              return (
                              <button
                                key={`${pr.owner}/${pr.repo}/${pr.number}/${pr.local_folder ?? ""}`}
                                type="button"
                                className={`pr-item pr-item--compact${
                                  selectedPr === pr.number && repoRef?.owner === pr.owner && repoRef?.repo === pr.repo
                                    ? " pr-item--active"
                                    : ""
                                }`}
                                onClick={() => handleSelectPrUnderReview(pr)}
                              >
                                <div className="pr-item__header">
                                  <span className="pr-item__title">
                                    {prTitleLabel}
                                    {!isLocalUnderReview && pr.state && pr.state.toLowerCase() !== 'open' && (
                                      <>{'\u00a0\u00a0'}<span className={`pr-item__state-badge ${pr.merged ? 'pr-item__state-badge--merged' : 'pr-item__state-badge--closed'}`}>{pr.merged ? 'MERGED' : 'CLOSED'}</span></>
                                    )}
                                    {!isLocalUnderReview && pr.locked && (
                                      <>
                                        {'\u00a0\u00a0'}
                                        <span
                                          className="pr-item__state-badge pr-item__state-badge--closed pr-item__state-badge--icon"
                                          title="Locked for comments"
                                          aria-label="Locked for comments"
                                        >
                                          <svg
                                            viewBox="0 0 24 24"
                                            width="12"
                                            height="12"
                                            aria-hidden="true"
                                            focusable="false"
                                          >
                                            <path
                                              fill="currentColor"
                                              d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V7Zm7 12H7v-8h10v8Z"
                                            />
                                          </svg>
                                        </span>
                                      </>
                                    )}
                                  </span>
                                  <span 
                                    className="pr-item__file-count" 
                                    title={`${pr.viewed_count} files have been reviewed`}
                                  >
                                    {pr.viewed_count} / {pr.total_count || "?"}
                                  </span>
                                </div>
                                <span className="pr-item__repo">{prRepoLabel}</span>
                              </button>
                              );
                            })
                          )
                        ) : (
                          <>
                            {pullsQuery.isError ? (
                              <div className="empty-state empty-state--subtle">
                                Unable to load pull requests.
                                <br />
                                {pullsErrorMessage}
                              </div>
                            ) : pullsQuery.isLoading || pullsQuery.isFetching ? (
                              <div className="empty-state empty-state--subtle">Loading pull requests…</div>
                            ) : filteredPullRequests.length === 0 ? (
                              <div className="empty-state empty-state--subtle">
                                {prSearchFilter.trim() 
                                  ? "No pull requests match your search."
                                  : repoRef
                                  ? "No Markdown or YAML pull requests found."
                                  : "Enter a repository to begin."}
                              </div>
                            ) : (
                              filteredPullRequests.map((pr) => (
                                <button
                                  key={pr.number}
                                  type="button"
                                  className={`pr-item pr-item--compact${selectedPr === pr.number ? " pr-item--active" : ""}`}
                                  onClick={() => {
                                    setSelectedPr(pr.number);
                                    setSelectedFilePath(null);
                                    setIsPrCommentsView(false);
                                    setIsPrCommentComposerOpen(false);
                                    setIsInlineCommentOpen(false);
                                    setIsAddingInlineComment(false);
                                    setReplyingToCommentId(null);
                                  }}
                                >
                                  <span className="pr-item__title">
                                    #{pr.number} · {pr.title}
                                    {pr.state && pr.state.toLowerCase() !== 'open' && (
                                      <>{'\u00a0\u00a0'}<span className={`pr-item__state-badge ${pr.merged ? 'pr-item__state-badge--merged' : 'pr-item__state-badge--closed'}`}>{pr.merged ? 'MERGED' : 'CLOSED'}</span></>
                                    )}
                                    {pr.locked && (
                                      <>
                                        {'\u00a0\u00a0'}
                                        <span
                                          className="pr-item__state-badge pr-item__state-badge--closed pr-item__state-badge--icon"
                                          title="Locked for comments"
                                          aria-label="Locked for comments"
                                        >
                                          <svg
                                            viewBox="0 0 24 24"
                                            width="12"
                                            height="12"
                                            aria-hidden="true"
                                            focusable="false"
                                          >
                                            <path
                                              fill="currentColor"
                                              d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V7Zm7 12H7v-8h10v8Z"
                                            />
                                          </svg>
                                        </span>
                                      </>
                                    )}
                                  </span>
                                  <span className="pr-item__meta">
                                    <span>{pr.author}</span>
                                    <span>{new Date(pr.updated_at).toLocaleString()}</span>
                                    <span>{pr.head_ref}</span>
                                  </span>
                                </button>
                              ))
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {selectedPr && !isInlineCommentOpen && (
                  <div className="panel panel--files">
                    <div className="panel__header panel__header--static">
                      <span>{isPrCommentsView ? "PR Comments" : "Files"}</span>
                      <div className="panel__header-actions">
                        <div className="source-menu-container" ref={filesMenuRef}>
                          <button
                            type="button"
                            className="panel__title-button"
                            onClick={() => setShowFilesMenu(!showFilesMenu)}
                            aria-label="More options"
                          >
                            …
                          </button>
                          {showFilesMenu && (
                            <div className="source-menu">
                              {!isPrCommentsView && (
                                <button
                                  type="button"
                                  className="source-menu__item"
                                  onClick={() => {
                                    setIsPrCommentsView(true);
                                    setIsPrCommentComposerOpen(prLevelComments.length === 0);
                                    setShowFilesMenu(false);
                                  }}
                                >
                                  View PR Comments
                                </button>
                              )}
                              {isPrCommentsView && (
                                <button
                                  type="button"
                                  className="source-menu__item"
                                  onClick={() => {
                                    setIsPrCommentsView(false);
                                    setIsPrCommentComposerOpen(false);
                                    setShowFilesMenu(false);
                                  }}
                                >
                                  View Files
                                </button>
                              )}
                              {!isPrCommentsView && !showAllFileTypes && (
                                <button
                                  type="button"
                                  className="source-menu__item"
                                  onClick={() => {
                                    setShowAllFileTypes(true);
                                    setShowFilesMenu(false);
                                  }}
                                >
                                  Show all file types
                                </button>
                              )}
                              {!isPrCommentsView && showAllFileTypes && (
                                <button
                                  type="button"
                                  className="source-menu__item"
                                  onClick={() => {
                                    setShowAllFileTypes(false);
                                    setShowFilesMenu(false);
                                  }}
                                >
                                  Show only markdown
                                </button>
                              )}
                              {!isPrCommentsView && !hideReviewedFiles && (
                                <button
                                  type="button"
                                  className="source-menu__item"
                                  onClick={() => {
                                    setHideReviewedFiles(true);
                                    setShowFilesMenu(false);
                                  }}
                                >
                                  Hide reviewed files
                                </button>
                              )}
                              {!isPrCommentsView && hideReviewedFiles && (
                                <button
                                  type="button"
                                  className="source-menu__item"
                                  onClick={() => {
                                    setHideReviewedFiles(false);
                                    setShowFilesMenu(false);
                                  }}
                                >
                                  Show reviewed files
                                </button>
                              )}
                              {!isPrCommentsView && files && files.length > 0 && (
                                <button
                                  type="button"
                                  className="source-menu__item"
                                  onClick={() => {
                                    markAllFilesAsViewed();
                                    setShowFilesMenu(false);
                                  }}
                                >
                                  Mark all viewed
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {isPrCommentsView ? (
                      <div className="panel__body panel__body--flush">
                        <div className="pr-comments-view">
                          {isPrCommentComposerOpen ? (
                            <div className="pr-comment-composer">
                              <form
                                className="comment-composer comment-composer--pr-pane"
                                onSubmit={handleCommentSubmit}
                                ref={prCommentFormRef}
                              >
                                <textarea
                                  id="pr-comment-draft"
                                  value={commentDraft}
                                  placeholder="Share your thoughts on this change…"
                                  onChange={(event) => {
                                    setCommentDraft(event.target.value);
                                    setCommentError(null);
                                    setCommentSuccess(false);
                                  }}
                                  rows={4}
                                  onKeyDown={(event) =>
                                    handleCtrlEnter(event, () => {
                                      if (
                                        isOnline &&
                                        !isLocalDirectoryMode &&
                                        !submitCommentMutation.isPending
                                      ) {
                                        prCommentFormRef.current?.requestSubmit();
                                      }
                                    })
                                  }
                                />
                                <div className="comment-composer__actions">
                                  <div className="comment-composer__status">
                                    {commentError && (
                                      <span className="comment-status comment-status--error">{commentError}</span>
                                    )}
                                    {isLocalDirectoryMode && (
                                      <span className="comment-status comment-status--warning">
                                        PR comments aren&apos;t available in local folder mode
                                      </span>
                                    )}
                                    {!isLocalDirectoryMode && !isOnline && (
                                      <span className="comment-status comment-status--warning">
                                        ⚠️ Offline - PR comments disabled
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    type="submit"
                                    className="comment-submit"
                                    disabled={submitCommentMutation.isPending || !isOnline || isLocalDirectoryMode}
                                    title={
                                      isLocalDirectoryMode
                                        ? "PR comments aren't available in local folder mode"
                                        : !isOnline
                                          ? "PR comments are disabled while offline"
                                          : ""
                                    }
                                  >
                                    {submitCommentMutation.isPending ? "Posting…" : "Post comment"}
                                  </button>
                                </div>
                              </form>
                            </div>
                          ) : (
                            <>
                              {prLevelComments.length === 0 ? (
                                <div className="empty-state empty-state--subtle">No PR comments yet.</div>
                              ) : (
                                <div className="pr-comments-list">
                                  {prLevelComments.map((comment: PullRequestComment) => (
                                    <div key={comment.id} className="pr-comment">
                                      <div className="pr-comment__header">
                                        <span className="pr-comment__author">{comment.author}</span>
                                        <span className="pr-comment__date">
                                          {new Date(comment.created_at).toLocaleDateString()}
                                        </span>
                                      </div>
                                      <div className="pr-comment__body">{comment.body}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="pr-comments-view__footer">
                                <button
                                  type="button"
                                  className="comment-panel__action-button comment-panel__action-button--primary"
                                  onClick={() => {
                                    setCommentDraft("");
                                    setCommentError(null);
                                    setCommentSuccess(false);
                                    setIsPrCommentComposerOpen(true);
                                  }}
                                  disabled={isLocalDirectoryMode}
                                  title={
                                    isLocalDirectoryMode
                                      ? "PR comments aren't available in local folder mode"
                                      : ""
                                  }
                                >
                                  Add PR Comment
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="panel__body panel__body--flush">
                        {pullDetailQuery.isLoading || isLoadingTocContent ? (
                          <div className="empty-state empty-state--subtle">Loading files…</div>
                        ) : !prDetail ? (
                          <div className="empty-state empty-state--subtle">Select a pull request.</div>
                        ) : sortedFiles.length === 0 ? (
                          <div className="empty-state empty-state--subtle">No files in this pull request.</div>
                        ) : filteredSortedFiles.length === 0 ? (
                          <div className="empty-state empty-state--subtle">
                            No Markdown or YAML files in this pull request.
                          </div>
                        ) : (
                          <>
                            <ul className="file-list file-list--compact" ref={fileListScrollRef}>
                              {visibleFiles.map((file) => {
                                const displayName = formatFileLabel(file.path, tocFileNameMap);
                                const tooltip = formatFileTooltip(file);
                                const commentCount = getFileCommentCount(file.path);
                                const viewed = isFileViewed(file.path);

                                return (
                                  <li key={file.path} className="file-list__item">
                                    <input
                                      type="checkbox"
                                      className="file-list__checkbox"
                                      checked={viewed}
                                      onChange={() => toggleFileViewed(file.path)}
                                      onClick={(e) => e.stopPropagation()}
                                      title="Viewed"
                                      aria-label="Mark as viewed"
                                    />
                                    <button
                                      type="button"
                                      className={`file-list__button${
                                        selectedFilePath === file.path ? " file-list__button--active" : ""
                                      }`}
                                      onClick={() => setSelectedFilePath(file.path)}
                                      title={tooltip}
                                    >
                                      <span className="file-list__name">{displayName}</span>
                                      <span className="file-list__badge-wrapper">
                                        {commentCount > 0 ? (
                                          <span
                                            className={`file-list__badge${fileHasPendingComments(file.path) ? " file-list__badge--pending" : ""}${fileHasDraftsInProgress(file.path) ? " file-list__badge--draft" : ""}${!fileHasPendingComments(file.path) && !fileHasDraftsInProgress(file.path) && fileHasRepliedComments(file.path) ? " file-list__badge--replied" : ""}`}
                                            title={`${commentCount} comment${commentCount !== 1 ? "s" : ""}${fileHasDraftsInProgress(file.path) ? " (comment in progress)" : ""}${!fileHasPendingComments(file.path) && !fileHasDraftsInProgress(file.path) && fileHasRepliedComments(file.path) ? " (has replies)" : ""}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (selectedFilePath !== file.path) {
                                                setSelectedFilePath(file.path);
                                              }
                                              setIsInlineCommentOpen(true);
                                            }}
                                          >
                                            {commentCount}
                                          </span>
                                        ) : fileHasDraftsInProgress(file.path) ? (
                                          <span
                                            className="file-list__badge file-list__badge--draft file-list__badge--visible"
                                            title="Comment in progress"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (selectedFilePath !== file.path) {
                                                setSelectedFilePath(file.path);
                                              }
                                              setIsInlineCommentOpen(true);
                                            }}
                                          >
                                            +
                                          </span>
                                        ) : (
                                          <span
                                            role="button"
                                            tabIndex={0}
                                            className="file-list__badge file-list__badge--add"
                                            aria-label={`Add comment to ${displayName}`}
                                            title="Add file comment"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (selectedFilePath !== file.path) {
                                                setSelectedFilePath(file.path);
                                              }
                                              void openInlineComment(file.path);
                                              handleAddCommentClick(file.path);
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter" || e.key === " ") {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                if (selectedFilePath !== file.path) {
                                                  setSelectedFilePath(file.path);
                                                }
                                                void openInlineComment(file.path);
                                                handleAddCommentClick(file.path);
                                              }
                                            }}
                                          >
                                            +
                                          </span>
                                        )}
                                      </span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>

                            {pendingReview && !isLocalDirectoryMode && (
                              <div className="pr-comments-view__footer">
                                {submissionProgress && (
                                  <div className="comment-panel__progress">
                                    {isLocalDirectoryMode
                                      ? `Saving comment ${submissionProgress.current} of ${submissionProgress.total}...`
                                      : `Submitting comment ${submissionProgress.current} of ${submissionProgress.total}...`}
                                  </div>
                                )}
                                <div className="pr-comments-view__footer-buttons">
                                  <button
                                    type="button"
                                    className="comment-panel__action-button comment-panel__action-button--primary"
                                    onClick={handleSubmitReviewClick}
                                    disabled={submitReviewMutation.isPending || localComments.length === 0}
                                  >
                                    {submitReviewMutation.isPending
                                      ? isLocalDirectoryMode
                                        ? "Saving…"
                                        : "Submitting…"
                                      : isLocalDirectoryMode
                                        ? (
                                          <>
                                            Save review
                                            <br />
                                            (log file)
                                          </>
                                        )
                                        : "Submit review"}
                                  </button>
                                  <button
                                    type="button"
                                    className="comment-panel__action-button comment-panel__action-button--danger"
                                    onClick={handleDeleteReviewClick}
                                    disabled={deleteReviewMutation.isPending}
                                  >
                                    {deleteReviewMutation.isPending ? "Deleting…" : "Delete review"}
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {!isSidebarCollapsed && (
          <div
            className={`sidebar__resize-handle${
              isSidebarResizing ? " sidebar__resize-handle--active" : ""
            }`}
            onMouseDown={handleSidebarResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
          />
        )}
      </aside>

      <section className="content-area">
        <div className="workspace">
          <div className="workspace__body" ref={workspaceBodyRef}>
            <div className={`pane pane--diff ${maximizedPane === 'source' ? 'pane--maximized' : (maximizedPane === 'preview' || maximizedPane === 'media' || isImageFile(selectedFile)) ? 'pane--hidden' : ''}`}>
              <div className="pane__header">
                <div className="pane__title-group">
                  <span>
                    Source
                    {selectedFilePath && (
                      <span className="pane__subtitle" title={selectedFilePath}>
                        {" - "}{formatFilePathWithLeadingEllipsis(selectedFilePath)}
                      </span>
                    )}
                  </span>
                </div>
                <div className="pane__actions">
                  {commentSuccess && !isGeneralCommentOpen && (
                    <span className="pane__status comment-status comment-status--success">
                      Comment published
                    </span>
                  )}
                  {selectedFile && (
                    <div className="source-menu-container" ref={sourceMenuRef}>
                      <button
                        type="button"
                        className="panel__title-button"
                        onClick={() => setShowSourceMenu(!showSourceMenu)}
                        aria-label="More options"
                      >
                        …
                      </button>
                      {showSourceMenu && (
                        <div className="source-menu">
                          <button
                            type="button"
                            className="source-menu__item"
                            onClick={() => {
                              if (isInlineCommentOpen) {
                                closeInlineComment();
                              } else {
                                openInlineComment();
                              }
                              setShowSourceMenu(false);
                            }}
                          >
                            {isInlineCommentOpen ? "Hide File Comments" : "Show File Comments"}
                          </button>
                          <button
                            type="button"
                            className="source-menu__item"
                            onClick={() => {
                              setShowDiff(!showDiff);
                              setShowSourceMenu(false);
                            }}
                          >
                            {showDiff ? "Show Modified" : "Show Diff"}
                          </button>
                          {selectedFilePath && (
                            <button
                              type="button"
                              className="source-menu__item"
                              onClick={() => {
                                toggleFileViewed(selectedFilePath);
                                setShowSourceMenu(false);
                              }}
                            >
                              {isFileViewed(selectedFilePath) ? "Mark file as unviewed" : "Mark file as viewed"}
                            </button>
                          )}
                          {!isDefaultPaneZoom && (
                            <button
                              type="button"
                              className="source-menu__item"
                              onClick={() => {
                                resetPaneZoom();
                                setShowSourceMenu(false);
                              }}
                            >
                              Reset Zoom
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    className="panel__title-button panel__title-button--maximize"
                    onClick={() => {
                      if (maximizedPane === 'source') {
                        // Restore
                        if (savedSplitRatio && workspaceBodyRef.current) {
                          workspaceBodyRef.current.style.setProperty('--split-ratio', savedSplitRatio);
                        }
                        setMaximizedPane(null);
                        setSavedSplitRatio(null);
                      } else {
                        // Maximize
                        if (workspaceBodyRef.current) {
                          const currentRatio = workspaceBodyRef.current.style.getPropertyValue('--split-ratio') || '50%';
                          setSavedSplitRatio(currentRatio);
                        }
                        setMaximizedPane('source');
                      }
                    }}
                    aria-label={maximizedPane === 'source' ? 'Restore pane size' : 'Maximize pane'}
                    title={maximizedPane === 'source' ? 'Restore pane size' : 'Maximize pane'}
                  >
                    {maximizedPane === 'source' ? '⊟' : '⊡'}
                  </button>
                </div>
              </div>
              <div className="pane__content">
                {isGeneralCommentOpen && prDetail && (
                  <form
                    className="comment-composer comment-composer--inline"
                    onSubmit={handleCommentSubmit}
                    ref={generalCommentFormRef}
                  >
                    <label className="comment-composer__label" htmlFor="comment-draft">
                      Pull request feedback
                    </label>
                    <textarea
                      id="comment-draft"
                      value={commentDraft}
                      placeholder="Share your thoughts on this change…"
                      onChange={(event) => {
                        setCommentDraft(event.target.value);
                        setCommentError(null);
                        setCommentSuccess(false);
                      }}
                      rows={4}
                      onKeyDown={(event) =>
                        handleCtrlEnter(event, () => {
                          if (isOnline && !submitCommentMutation.isPending) {
                            generalCommentFormRef.current?.requestSubmit();
                          }
                        })
                      }
                    />
                    <div className="comment-composer__actions">
                      <div className="comment-composer__status">
                        {commentError && (
                          <span className="comment-status comment-status--error">{commentError}</span>
                        )}
                        {!isOnline && (
                          <span className="comment-status comment-status--warning">
                            ⚠️ Offline - PR comments disabled
                          </span>
                        )}
                      </div>
                      <button
                        type="submit"
                        className="comment-submit"
                        disabled={submitCommentMutation.isPending || !isOnline || isLocalDirectoryMode}
                        title={
                          isLocalDirectoryMode
                            ? "PR comments aren't available in local folder mode"
                            : (!isOnline ? "PR comments are disabled while offline" : "")
                        }
                      >
                        {isLocalDirectoryMode
                          ? "Unavailable (local folder)"
                          : (submitCommentMutation.isPending ? "Sending…" : "Post comment")}
                      </button>
                    </div>
                  </form>
                )}
                <div
                  className="pane__viewer pane__viewer--source"
                  onMouseEnter={() => {
                    hoveredPaneRef.current = 'source';
                  }}
                  onMouseLeave={() => {
                    if (hoveredPaneRef.current === 'source') {
                      hoveredPaneRef.current = null;
                    }
                  }}
                  onWheel={(e) => {
                    if (e.ctrlKey) {
                      e.preventDefault();
                      adjustPaneZoom(e.deltaY < 0 ? PANE_ZOOM_STEP : -PANE_ZOOM_STEP);
                    }
                  }}
                >
                  {selectedFile ? (
                    showDiff ? (
                      <DiffEditor
                        original={(selectedFile.base_content ?? "").replace(/\n+$/, "")}
                        modified={(selectedFile.head_content ?? "").replace(/\n+$/, "")}
                        language={selectedFile.language === "yaml" ? "yaml" : "markdown"}
                        options={{
                          readOnly: true,
                          renderSideBySide: false,
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          wordWrap: "on",
                          glyphMargin: true,
                          mouseWheelZoom: false,
                          unicodeHighlight: {
                            ambiguousCharacters: false,
                            invisibleCharacters: false,
                          },
                        }}
                        onMount={(editor) => {
                          diffEditorRef.current = editor;
                          applyCodeZoom(paneZoomLevel);
                          
                          editor.onDidDispose(() => {
                            if (diffEditorRef.current === editor) {
                              diffEditorRef.current = null;
                            }
                          });
                          const modifiedEditor = editor.getModifiedEditor();
                          if (modifiedEditor) {
                            modifiedEditor.onDidScrollChange(() => {
                              const fileKey = selectedFileCacheKeyRef.current;
                              if (!fileKey) {
                                return;
                              }
                              
                              // Ignore scroll events during file change transition to prevent corruption
                              if (sourcePaneFileChangeInProgressRef.current) {
                                return;
                              }
                              
                              const scrollTop = modifiedEditor.getScrollTop();
                              
                              // Check if we should skip this scroll snapshot
                              if (shouldSkipSourceScrollSnapshot(fileKey, scrollTop)) {
                                return;
                              }
                              persistSourceScrollPosition(fileKey, scrollTop, "scroll", { allowZero: true });

                              if (isMarkdownSelectedRef.current) {
                                // Anchor-based sync for markdown files
                                const lineHeight = Number(modifiedEditor.getOption?.(66)) || 19; // LINE_HEIGHT option
                                syncSourceToPreviewRef.current(scrollTop, lineHeight);
                                scheduleSourceScrollEndSyncRef.current();
                              } else {
                                // Percent-based sync for non-markdown
                                syncPreviewToEditorRef.current(modifiedEditor);
                              }
                            });

                            // If the editor can't scroll further (EOF/BOF), let mouse wheel keep the preview moving.
                            const modifiedDomNode = modifiedEditor.getDomNode?.();
                            if (modifiedDomNode) {
                              // Add Ctrl+Wheel zoom handler first (non-passive to allow preventDefault)
                              const zoomHandler = (e: WheelEvent) => {
                                if (e.ctrlKey) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  adjustPaneZoom(e.deltaY < 0 ? PANE_ZOOM_STEP : -PANE_ZOOM_STEP);
                                }
                              };
                              modifiedDomNode.addEventListener('wheel', zoomHandler, { passive: false });
                              
                              const handleWheel = (e: WheelEvent) => {
                                if (!isMarkdownSelectedRef.current) {
                                  return;
                                }
                                const preview = previewViewerRef.current;
                                if (!preview) {
                                  return;
                                }

                                const editorScrollTop = modifiedEditor.getScrollTop();
                                const editorMaxScroll = Math.max(0, modifiedEditor.getScrollHeight() - modifiedEditor.getLayoutInfo().height);
                                const previewMaxScroll = Math.max(0, preview.scrollHeight - preview.clientHeight);

                                const atTop = editorScrollTop <= 1;
                                const atBottom = editorMaxScroll > 0 && editorScrollTop >= editorMaxScroll - 1;

                                if (e.deltaY < 0 && atTop && preview.scrollTop > 0) {
                                  preview.scrollTop = Math.max(0, preview.scrollTop + e.deltaY);
                                } else if (e.deltaY > 0 && atBottom && preview.scrollTop < previewMaxScroll) {
                                  preview.scrollTop = Math.min(previewMaxScroll, preview.scrollTop + e.deltaY);
                                }
                              };

                              modifiedDomNode.addEventListener("wheel", handleWheel, { passive: true });
                              modifiedEditor.onDidDispose(() => {
                                modifiedDomNode.removeEventListener("wheel", handleWheel);
                                modifiedDomNode.removeEventListener("wheel", zoomHandler);
                              });
                            }
                          }
                          
                          const hoveredLineRef = { current: null as number | null };
                          const decorationsRef = { current: [] as string[] };
                          
                          // Handle mouse move for hover effect
                          modifiedEditor.onMouseMove((e) => {
                            const lineNumber = e.target.position?.lineNumber;
                            const isOverGlyphOrLineNumber = 
                              e.target.type === 2 || // GUTTER_GLYPH_MARGIN
                              e.target.type === 3;   // GUTTER_LINE_NUMBERS
                            
                            if (lineNumber && isOverGlyphOrLineNumber && hoveredLineRef.current !== lineNumber) {
                              hoveredLineRef.current = lineNumber;
                              decorationsRef.current = modifiedEditor.deltaDecorations(decorationsRef.current, [
                                {
                                  range: new (window as any).monaco.Range(lineNumber, 1, lineNumber, 1),
                                  options: {
                                    glyphMarginClassName: 'monaco-glyph-margin-plus',
                                    glyphMarginHoverMessage: { value: 'Add comment' }
                                  }
                                }
                              ]);
                            } else if (!isOverGlyphOrLineNumber && hoveredLineRef.current !== null) {
                              hoveredLineRef.current = null;
                              decorationsRef.current = modifiedEditor.deltaDecorations(decorationsRef.current, []);
                            }
                          });
                          
                          // Handle mouse down for clicking on glyph margin
                          modifiedEditor.onMouseDown((e) => {
                            const lineNumber = e.target.position?.lineNumber;
                            const isGlyphMargin = e.target.type === 2; // GUTTER_GLYPH_MARGIN
                            
                            if (lineNumber && isGlyphMargin && handleGlyphClickRef.current) {
                              handleGlyphClickRef.current(lineNumber);
                            }
                          });
                        }}
                      />
                    ) : (
                      <Editor
                        value={(selectedFile.head_content ?? "").replace(/\n+$/, "")}
                        language={selectedFile.language === "yaml" ? "yaml" : "markdown"}
                        options={{
                          readOnly: true,
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          wordWrap: "on",
                          glyphMargin: true,
                          mouseWheelZoom: false,
                          unicodeHighlight: {
                            ambiguousCharacters: false,
                            invisibleCharacters: false,
                          },
                        }}
                        onMount={(editor) => {
                          editorRef.current = editor;
                          applyCodeZoom(paneZoomLevel);
                          editor.onDidDispose(() => {
                            if (editorRef.current === editor) {
                              editorRef.current = null;
                            }
                          });
                          
                          // Scroll synchronization (anchor-based for markdown)
                          editor.onDidScrollChange(() => {
                            if (!previewViewerRef.current) return;
                            
                            // Skip if we're currently re-enforcing to avoid loops
                            if (sourcePaneReEnforcingRef.current) {
                              return;
                            }
                            
                            // Get actual scroll position from editor
                            const editorScrollTop = editor.getScrollTop();
                            const fileKey = selectedFileCacheKeyRef.current;
                            if (fileKey) {
                              if (shouldSkipSourceScrollSnapshot(fileKey, editorScrollTop)) {
                                // If suppression is active and this is a spurious zero, re-enforce target
                                const isPrematureZero = editorScrollTop <= SOURCE_RESTORE_EPSILON;
                                if (isPrematureZero) {
                                  const pending = sourcePaneRestoreInFlightRef.current;
                                  const grace = sourcePaneRestoreGraceRef.current;
                                  const activationHold = sourcePaneActivationHoldRef.current;
                                  
                                  let targetToEnforce = null;
                                  if (pending && pending.fileKey === fileKey && pending.target > SOURCE_RESTORE_EPSILON) {
                                    targetToEnforce = pending.target;
                                  } else if (grace && grace.fileKey === fileKey && Date.now() <= grace.expiresAt && grace.target > SOURCE_RESTORE_EPSILON) {
                                    targetToEnforce = grace.target;
                                  } else if (activationHold && activationHold.fileKey === fileKey && Date.now() <= activationHold.expiresAt && activationHold.target > SOURCE_RESTORE_EPSILON) {
                                    targetToEnforce = activationHold.target;
                                  }
                                  
                                  if (targetToEnforce !== null) {
                                    sourcePaneReEnforcingRef.current = true;
                                    editor.setScrollTop(targetToEnforce);
                                    setTimeout(() => {
                                      sourcePaneReEnforcingRef.current = false;
                                    }, 50);
                                  }
                                }
                              } else {
                                persistSourceScrollPosition(fileKey, editorScrollTop, "scroll", { allowZero: true });
                              }
                            }
                            
                            if (isMarkdownSelectedRef.current) {
                              // Anchor-based sync for markdown files
                              const lineHeight = Number(editor.getOption?.(66)) || 19; // LINE_HEIGHT option
                              syncSourceToPreviewRef.current(editorScrollTop, lineHeight);
                              scheduleSourceScrollEndSyncRef.current();
                            } else {
                              // Percent-based sync for non-markdown
                              syncPreviewToEditorRef.current(editor);
                            }
                          });

                          // If the editor can't scroll further (EOF/BOF), let mouse wheel keep the preview moving.
                          const domNode = editor.getDomNode?.();
                          if (domNode) {
                            // Add Ctrl+Wheel zoom handler first (non-passive to allow preventDefault)
                            const zoomHandler = (e: WheelEvent) => {
                              if (e.ctrlKey) {
                                e.preventDefault();
                                e.stopPropagation();
                                adjustPaneZoom(e.deltaY < 0 ? PANE_ZOOM_STEP : -PANE_ZOOM_STEP);
                              }
                            };
                            domNode.addEventListener('wheel', zoomHandler, { passive: false });
                            
                            const handleWheel = (e: WheelEvent) => {
                              if (!isMarkdownSelectedRef.current) {
                                return;
                              }
                              const preview = previewViewerRef.current;
                              if (!preview) {
                                return;
                              }

                              const editorScrollTop = editor.getScrollTop();
                              const editorMaxScroll = Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height);
                              const previewMaxScroll = Math.max(0, preview.scrollHeight - preview.clientHeight);

                              const atTop = editorScrollTop <= 1;
                              const atBottom = editorMaxScroll > 0 && editorScrollTop >= editorMaxScroll - 1;

                              if (e.deltaY < 0 && atTop && preview.scrollTop > 0) {
                                preview.scrollTop = Math.max(0, preview.scrollTop + e.deltaY);
                              } else if (e.deltaY > 0 && atBottom && preview.scrollTop < previewMaxScroll) {
                                preview.scrollTop = Math.min(previewMaxScroll, preview.scrollTop + e.deltaY);
                              }
                            };

                            domNode.addEventListener("wheel", handleWheel, { passive: true });
                            editor.onDidDispose(() => {
                              domNode.removeEventListener("wheel", handleWheel);
                              domNode.removeEventListener("wheel", zoomHandler);
                            });
                          }

                          // Handle mouse move for line hover detection
                          editor.onMouseMove((e) => {
                            const lineNumber = e.target.position?.lineNumber;
                            
                            // Only show decoration when hovering over the line number or glyph margin
                            const isOverGlyphOrLineNumber = 
                              e.target.type === 2 || // GUTTER_GLYPH_MARGIN
                              e.target.type === 3;   // GUTTER_LINE_NUMBERS
                            
                            if (lineNumber && isOverGlyphOrLineNumber && hoveredLineRef.current !== lineNumber) {
                              hoveredLineRef.current = lineNumber;
                              decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
                                {
                                  range: new (window as any).monaco.Range(lineNumber, 1, lineNumber, 1),
                                  options: {
                                    glyphMarginClassName: 'monaco-glyph-margin-plus',
                                    glyphMarginHoverMessage: { value: 'Add comment' }
                                  }
                                }
                              ]);
                            } else if (!isOverGlyphOrLineNumber && hoveredLineRef.current !== null) {
                              hoveredLineRef.current = null;
                              decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
                            }
                          });

                          // Handle mouse down for clicking on glyph margin
                          editor.onMouseDown((e) => {
                            const lineNumber = e.target.position?.lineNumber;
                            const isGlyphMargin = e.target.type === 2; // GUTTER_GLYPH_MARGIN
                            
                            if (lineNumber && isGlyphMargin && handleGlyphClickRef.current) {
                              handleGlyphClickRef.current(lineNumber);
                            }
                            
                            // Handle ctrl+click / cmd+click on links
                            if ((e.event.ctrlKey || e.event.metaKey) && e.target.position) {
                              const model = editor.getModel();
                              if (!model) return;
                              
                              const position = e.target.position;
                              const lineContent = model.getLineContent(position.lineNumber);
                              const column = position.column;
                              
                              // Find link at cursor position using regex
                              const urlRegex = /(https?:\/\/[^\s)]+)|(\.?\.?\/[^\s)]+)|([\w.-]+\.md)/g;
                              let match;
                              let clickedUrl: string | null = null;
                              
                              while ((match = urlRegex.exec(lineContent)) !== null) {
                                const matchStart = match.index + 1; // Monaco columns are 1-indexed
                                const matchEnd = matchStart + match[0].length;
                                
                                if (column >= matchStart && column <= matchEnd) {
                                  clickedUrl = match[0];
                                  break;
                                }
                              }
                              
                              if (clickedUrl && prDetail && selectedFile) {
                                // Handle anchor links
                                if (clickedUrl.startsWith('#')) {
                                  const targetId = clickedUrl.substring(1);
                                  if (!scrollPreviewToAnchor(targetId)) {
                                    setPendingAnchorId(targetId);
                                  }
                                  return;
                                }
                                
                                // Handle external URLs
                                if (clickedUrl.startsWith('http://') || clickedUrl.startsWith('https://')) {
                                  void invoke('cmd_open_url', { url: clickedUrl });
                                  return;
                                }
                                
                                // Handle relative file paths
                                let resolvedPath = clickedUrl;
                                let anchorId: string | null = null;
                                
                                // Remove anchor/hash from path
                                const hashIndex = resolvedPath.indexOf('#');
                                if (hashIndex !== -1) {
                                  anchorId = resolvedPath.substring(hashIndex + 1);
                                  resolvedPath = resolvedPath.substring(0, hashIndex);
                                }
                                
                                // Decode URL-encoded characters (e.g., %20 for spaces)
                                try {
                                  resolvedPath = decodeURIComponent(resolvedPath);
                                } catch (e) {
                                  // If decoding fails, use the original path
                                  console.warn('Failed to decode URL path:', resolvedPath, e);
                                }
                                
                                if (resolvedPath.startsWith('./') || resolvedPath.startsWith('../') || !resolvedPath.startsWith('/')) {
                                  // Relative path - resolve based on current file location
                                  const filePath = selectedFile.path || '';
                                  const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
                                  const parts = fileDir.split('/').filter(Boolean);
                                  
                                  const pathParts = resolvedPath.split('/');
                                  for (const part of pathParts) {
                                    if (part === '..') {
                                      parts.pop();
                                    } else if (part !== '.' && part !== '') {
                                      parts.push(part);
                                    }
                                  }
                                  
                                  resolvedPath = parts.join('/');
                                } else {
                                  // Absolute path - remove leading slash
                                  resolvedPath = resolvedPath.substring(1);
                                }
                                
                                // Check if this file exists in the PR
                                const targetFile = prDetail.files.find((f: PullRequestFile) => f.path === resolvedPath);
                                if (targetFile) {
                                  const currentPath = selectedFile.path || '';
                                  if (anchorId) {
                                    if (targetFile.path === currentPath) {
                                      if (!scrollPreviewToAnchor(anchorId)) {
                                        setPendingAnchorId(anchorId);
                                      }
                                    } else {
                                      skipNextSourceScrollRestoreRef.current = true;
                                      skipSourceRestoreForRef.current = resolvedPath;
                                      setPendingAnchorId(anchorId);
                                      setSelectedFilePath(resolvedPath);
                                    }
                                  } else {
                                    skipNextSourceScrollRestoreRef.current = false;
                                    skipSourceRestoreForRef.current = null;
                                    setPendingAnchorId(null);
                                    setSelectedFilePath(resolvedPath);
                                  }
                                }
                              }
                            }
                          });
                        }}
                      />
                    )
                  ) : (
                    <div className="empty-state">
                      {prDetail ? "Pick a file to see its diff." : pullDetailQuery.isFetching ? "Loading..." : "Choose a pull request to begin."}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {maximizedPane || isImageFile(selectedFile) ? null : (
              <div
                className={`workspace__divider${isResizing ? " workspace__divider--active" : ""}`}
                onMouseDown={handleResizeStart}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize diff and preview panes"
              />
            )}

            <div className={`pane pane--preview ${maximizedPane === 'preview' || isImageFile(selectedFile) ? 'pane--maximized' : (maximizedPane === 'source' || maximizedPane === 'media') ? 'pane--hidden' : ''}`}>
              <div className="pane__header">
                <div className="pane__title-group">
                  <span>
                    {fileNavigationHistory.length > 1 && (
                      <>
                        <button
                          type="button"
                          className="pane__nav-button"
                          onClick={navigateBack}
                          disabled={!canNavigateBack}
                          aria-label="Navigate back"
                          title="Navigate back"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          className="pane__nav-button"
                          onClick={navigateForward}
                          disabled={!canNavigateForward}
                          aria-label="Navigate forward"
                          title="Navigate forward"
                        >
                          →
                        </button>
                      </>
                    )}
                    Preview
                  </span>
                </div>
                <div className="pane__actions">
                  {!isImageFile(selectedFile) && (
                    <button
                      type="button"
                      className="panel__title-button panel__title-button--maximize"
                      onClick={() => {
                        if (maximizedPane === 'preview') {
                          // Restore
                          if (savedSplitRatio && workspaceBodyRef.current) {
                            workspaceBodyRef.current.style.setProperty('--split-ratio', savedSplitRatio);
                          }
                          setMaximizedPane(null);
                          setSavedSplitRatio(null);
                        } else {
                          // Maximize
                          if (workspaceBodyRef.current) {
                            const currentRatio = workspaceBodyRef.current.style.getPropertyValue('--split-ratio') || '50%';
                            setSavedSplitRatio(currentRatio);
                          }
                          setMaximizedPane('preview');
                        }
                      }}
                      aria-label={maximizedPane === 'preview' ? 'Restore pane size' : 'Maximize pane'}
                      title={maximizedPane === 'preview' ? 'Restore pane size' : 'Maximize pane'}
                    >
                      {maximizedPane === 'preview' ? '⊟' : '⊡'}
                    </button>
                  )}
                </div>
              </div>
              <div className="pane__content">
                <div
                  className="pane__viewer pane__viewer--preview"
                  onMouseEnter={() => {
                    hoveredPaneRef.current = 'preview';
                  }}
                  onMouseLeave={() => {
                    if (hoveredPaneRef.current === 'preview') {
                      hoveredPaneRef.current = null;
                    }
                  }}
                >
                  {selectedFile ? (
                    selectedFile.language === "image" ? (
                      <div className="image-preview">
                        {selectedFile.head_content ? (
                          <img 
                            src={`data:image/${selectedFile.path.split('.').pop()};base64,${selectedFile.head_content}`}
                            alt={selectedFile.path}
                          />
                        ) : (
                          <div className="empty-state">Loading image...</div>
                        )}
                      </div>
                    ) : isMarkdownFile(selectedFile) ? (
                      <div 
                        className="markdown-preview" 
                        ref={previewViewerRef as React.RefObject<HTMLDivElement>}
                        onScroll={(e) => {
                          // Use anchor-based sync for markdown files
                          syncPreviewToSource(e.currentTarget.scrollTop);
                          schedulePreviewScrollEndSync(e.currentTarget.scrollTop);
                        }}
                      >
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm, [remarkFrontmatter, { type: 'yaml', marker: '-' }]]}
                          rehypePlugins={[rehypeRaw, rehypeSanitize]}
                          components={{
                            ...markdownComponents,
                            a: ({href, children, ...props}) => {
                              // Handle link clicks
                              const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
                                if (!href) return;
                                
                                // Handle anchor links (within-page navigation)
                                if (href.startsWith('#')) {
                                  e.preventDefault();
                                  const targetId = href.substring(1);
                                  if (!scrollPreviewToAnchor(targetId)) {
                                    setPendingAnchorId(targetId);
                                  }
                                  return;
                                }
                                
                                e.preventDefault();
                                
                                // Check if it's an external URL
                                if (href.startsWith('http://') || href.startsWith('https://')) {
                                  // Open external links in browser
                                  void invoke('cmd_open_url', { url: href });
                                } else if (prDetail && selectedFile) {
                                  // Handle relative file paths within the PR
                                  let resolvedPath = href;
                                  let anchorId: string | null = null;
                                  
                                  // Remove anchor/hash from path
                                  const hashIndex = resolvedPath.indexOf('#');
                                  if (hashIndex !== -1) {
                                    anchorId = resolvedPath.substring(hashIndex + 1);
                                    resolvedPath = resolvedPath.substring(0, hashIndex);
                                  }
                                  
                                  // Decode URL-encoded characters (e.g., %20 for spaces)
                                  try {
                                    resolvedPath = decodeURIComponent(resolvedPath);
                                  } catch (e) {
                                    // If decoding fails, use the original path
                                    console.warn('Failed to decode URL path:', resolvedPath, e);
                                  }
                                  
                                  if (resolvedPath.startsWith('./') || resolvedPath.startsWith('../') || !resolvedPath.startsWith('/')) {
                                    // Relative path - resolve based on current file location
                                    const filePath = selectedFile.path || '';
                                    const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
                                    const parts = fileDir.split('/').filter(Boolean);
                                    
                                    const pathParts = resolvedPath.split('/');
                                    for (const part of pathParts) {
                                      if (part === '..') {
                                        parts.pop();
                                      } else if (part !== '.' && part !== '') {
                                        parts.push(part);
                                      }
                                    }
                                    
                                    resolvedPath = parts.join('/');
                                  } else {
                                    // Absolute path - remove leading slash
                                    resolvedPath = resolvedPath.substring(1);
                                  }
                                  
                                  // Check if this file exists in the PR
                                  const targetFile = prDetail.files.find((f: PullRequestFile) => f.path === resolvedPath);
                                  if (targetFile) {
                                    const currentPath = selectedFile.path || '';
                                    if (anchorId) {
                                      if (targetFile.path === currentPath) {
                                        if (!scrollPreviewToAnchor(anchorId)) {
                                          setPendingAnchorId(anchorId);
                                        }
                                      } else {
                                        setPendingAnchorId(anchorId);
                                        setSelectedFilePath(resolvedPath);
                                      }
                                    } else {
                                      setPendingAnchorId(null);
                                      setSelectedFilePath(resolvedPath);
                                    }
                                  }
                                }
                              };
                              
                              return (
                                <a 
                                  href={href} 
                                  onClick={handleClick}
                                  {...props}
                                >
                                  {children}
                                </a>
                              );
                            },
                            img: ({src, alt, ...props}) => {
                              // If src is already a full URL, use it directly
                              if (!src || src.startsWith('http://') || src.startsWith('https://')) {
                                return (
                                  <img 
                                    src={src} 
                                    alt={alt} 
                                    className="clickable-image"
                                    onClick={() => {
                                      if (src) {
                                        setMediaViewerContent({ type: 'image', content: src });
                                        setMaximizedPane('media');
                                      }
                                    }}
                                    {...props} 
                                  />
                                );
                              }
                              
                              if (!repoRef || !prDetail || !selectedFile) {
                                return <img src={src} alt={alt} {...props} />;
                              }
                              
                              // Resolve relative path based on current file location
                              let resolvedPath = src;
                              if (src.startsWith('./') || src.startsWith('../') || !src.startsWith('/')) {
                                const filePath = selectedFile.path || '';
                                const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
                                const parts = fileDir.split('/').filter(Boolean);
                                
                                // Process each part of the source path
                                const srcParts = src.split('/');
                                for (const part of srcParts) {
                                  if (part === '..') {
                                    parts.pop();
                                  } else if (part !== '.' && part !== '') {
                                    parts.push(part);
                                  }
                                }
                                
                                resolvedPath = parts.join('/');
                              } else {
                                // Absolute path, remove leading slash
                                resolvedPath = src.substring(1);
                              }
                              
                              // Use AsyncImage component to handle the fetch
                              return <MemoizedAsyncImage 
                                owner={repoRef.owner} 
                                repo={repoRef.repo} 
                                reference={prDetail.head_sha} 
                                path={resolvedPath} 
                                alt={alt} 
                                onClick={async (_e: React.MouseEvent<HTMLImageElement>) => {
                                  try {
                                    const base64Data = await invoke<string>("cmd_fetch_file_content", {
                                      owner: repoRef.owner,
                                      repo: repoRef.repo,
                                      reference: prDetail.head_sha,
                                      path: resolvedPath
                                    });
                                    const mimeType = getImageMimeType(resolvedPath);
                                    setMediaViewerContent({ type: 'image', content: `data:${mimeType};base64,${base64Data}` });
                                    setMaximizedPane('media');
                                  } catch (err) {
                                    console.error('Failed to open image:', err);
                                  }
                                }}
                                {...props} 
                              />;
                            }
                          }}
                        >
                          {memoizedMarkdownContent}
                        </ReactMarkdown>
                        <div className="markdown-preview__eof" aria-hidden="true">
                          <br />
                        </div>
                      </div>
                    ) : (
                      <pre 
                        className="markdown-preview" 
                        ref={previewViewerRef as React.RefObject<HTMLPreElement>}
                        onScroll={(e) => {
                          if (isScrollingSyncRef.current) return;
                          isScrollingSyncRef.current = true;
                          syncPreviewToSourceNonMarkdown(e.currentTarget.scrollTop);
                          setTimeout(() => {
                            isScrollingSyncRef.current = false;
                          }, 50);
                        }}
                      >
                        <code>{(selectedFile.head_content ?? "") + "\n"}</code>
                      </pre>
                    )
                  ) : (
                    <div className="empty-state">
                      {prDetail ? "Preview appears once a file is selected." : pullDetailQuery.isFetching ? "Loading..." : "Choose a pull request to begin."}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Media Viewer Pane */}
            {maximizedPane === 'media' && mediaViewerContent && (
              <MediaViewer 
                content={mediaViewerContent}
                onClose={() => {
                  setMaximizedPane(null);
                  setMediaViewerContent(null);
                }}
              />
            )}
          </div>
        </div>
      </section>

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Comment"
          message="Are you sure you want to delete this comment?"
          confirmText="Delete"
          isDanger
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={() => {
            if (editingCommentId !== null) {
              deleteCommentMutation.mutate(editingCommentId);
            }
          }}
        />
      )}

      {showDeleteReviewConfirm && (
        <ConfirmDialog
          title="Delete Review"
          message="Are you sure you want to delete this pending review?"
          confirmText="Delete"
          isDanger
          onClose={() => setShowDeleteReviewConfirm(false)}
          onConfirm={confirmDeleteReview}
        />
      )}

      {submitReviewDialogMessage && (
        <ConfirmDialog
          title="Submit Review"
          message={submitReviewDialogMessage}
          onClose={() => setSubmitReviewDialogMessage(null)}
        />
      )}

      {/* Comment Context Menu */}
      {commentContextMenu && (
        // eslint-disable-next-line react/forbid-dom-props
        <div
          ref={commentContextMenuRef}
          className="source-menu source-menu--context"
        >
          {commentContextMenu.comment ? (
            <>
              {commentContextMenu.comment.is_mine && (
                <button
                  type="button"
                  className="source-menu__item"
                  onClick={() => {
                    const comment = commentContextMenu.comment;
                    if (comment) {
                      setEditingCommentId(comment.id);
                      setEditingComment(comment);
                      setFileCommentDraft(comment.body);
                      setFileCommentLine(comment.line?.toString() || "");
                      setFileCommentSide(comment.side || "RIGHT");
                      setFileCommentIsFileLevel(!comment.line);
                      setFileCommentError(null);
                      setFileCommentSuccess(false);
                      setIsFileCommentComposerVisible(true);
                    }
                    setCommentContextMenu(null);
                  }}
                >
                  Edit
                </button>
              )}
              {commentContextMenu.comment.is_mine && (
                <button
                  type="button"
                  className="source-menu__item"
                  onClick={() => {
                    const comment = commentContextMenu.comment;
                    if (comment) {
                      setEditingCommentId(comment.id);
                      setEditingComment(comment);
                      setShowDeleteConfirm(true);
                    }
                    setCommentContextMenu(null);
                  }}
                >
                  Delete
                </button>
              )}
              {!commentContextMenu.comment.is_draft && (
                <button
                  type="button"
                  className="source-menu__item"
                  onClick={() => {
                    const comment = commentContextMenu.comment;
                    if (comment) {
                      // Find the parent comment for replies
                      const parentComment = comment.in_reply_to_id 
                        ? reviewAwareComments.find((c: PullRequestComment) => c.id === comment.in_reply_to_id)
                        : comment;
                      
                      if (parentComment) {
                        setReplyingToCommentId(parentComment.id);
                        setReplyDraft("");
                        setReplyError(null);
                        setReplySuccess(false);
                      }
                    }
                    setCommentContextMenu(null);
                  }}
                >
                  Reply
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="source-menu__item"
              onClick={() => {
                setIsFileCommentComposerVisible(true);
                setFileCommentDraft("");
                setFileCommentLine("");
                setFileCommentError(null);
                setFileCommentSuccess(false);
                setEditingCommentId(null);
                setEditingComment(null);
                setCommentContextMenu(null);
              }}
            >
              Add Comment
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
