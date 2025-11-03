import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DiffEditor } from "@monaco-editor/react";
import { parse as parseYaml } from "yaml";

type AuthStatus = {
  is_authenticated: boolean;
  login?: string | null;
  avatar_url?: string | null;
};

type PullRequestSummary = {
  number: number;
  title: string;
  author: string;
  updated_at: string;
  head_ref: string;
};

type FileLanguage = "markdown" | "yaml";

type PullRequestFile = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string | null;
  head_content?: string | null;
  base_content?: string | null;
  language: FileLanguage;
};

type PullRequestDetail = {
  number: number;
  title: string;
  body?: string | null;
  author: string;
  head_sha: string;
  base_sha: string;
  files: PullRequestFile[];
  comments: PullRequestComment[];
  my_comments: PullRequestComment[];
  reviews: PullRequestReview[];
};

type RepoRef = {
  owner: string;
  repo: string;
};

type PullRequestComment = {
  id: number;
  body: string;
  author: string;
  created_at: string;
  url: string;
  path?: string | null;
  line?: number | null;
  side?: "RIGHT" | "LEFT" | null;
  is_review_comment: boolean;
  is_draft: boolean;
  state?: string | null;
  is_mine: boolean;
  review_id?: number | null;
};

type PullRequestReview = {
  id: number;
  state: string;
  author: string;
  submitted_at?: string | null;
  body?: string | null;
  html_url?: string | null;
  commit_id?: string | null;
  is_mine: boolean;
};

const AUTH_QUERY_KEY = ["auth-status"] as const;

const openDevtoolsWindow = () => {
  void invoke("cmd_open_devtools").catch((error) => {
    console.warn("Failed to open devtools", error);
  });
};

const MIN_SIDEBAR_WIDTH = 320;
const MIN_CONTENT_WIDTH = 480;

function App() {
  const [repoRef, setRepoRef] = useState<RepoRef | null>(null);
  const [repoInput, setRepoInput] = useState("");
  const [repoError, setRepoError] = useState<string | null>(null);
  const [selectedPr, setSelectedPr] = useState<number | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [showClosedPRs, setShowClosedPRs] = useState(false);
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRepoPanelCollapsed, setIsRepoPanelCollapsed] = useState(false);
  const [isPrPanelCollapsed, setIsPrPanelCollapsed] = useState(false);
  const [isInlineCommentOpen, setIsInlineCommentOpen] = useState(false);
  const [isGeneralCommentOpen, setIsGeneralCommentOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(MIN_SIDEBAR_WIDTH);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [isFileCommentComposerVisible, setIsFileCommentComposerVisible] = useState(false);
  const [, setReviewSummaryDraft] = useState("");
  const [, setReviewSummaryError] = useState<string | null>(null);
  const [pendingReviewOverride, setPendingReviewOverride] = useState<PullRequestReview | null>(null);
  const [localComments, setLocalComments] = useState<PullRequestComment[]>([]);
  const [isLoadingPendingComments, setIsLoadingPendingComments] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingComment, setEditingComment] = useState<PullRequestComment | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const previousBodyCursorRef = useRef<string | null>(null);
  const previousBodyUserSelectRef = useRef<string | null>(null);
  const queryClient = useQueryClient();

  const authQuery = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => invoke<AuthStatus>("cmd_check_auth_status"),
  });

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
      });
      queryClient.removeQueries({ queryKey: ["pull-requests"] });
      queryClient.removeQueries({ queryKey: ["pull-request"] });
      setRepoRef(null);
      setSelectedPr(null);
      setSelectedFilePath(null);
    },
  });

  const pullsQuery = useQuery({
    queryKey: ["pull-requests", repoRef?.owner, repoRef?.repo, showClosedPRs],
    queryFn: async () =>
      invoke<PullRequestSummary[]>("cmd_list_pull_requests", {
        owner: repoRef?.owner,
        repo: repoRef?.repo,
        state: showClosedPRs ? "all" : "open",
      }),
    enabled: Boolean(repoRef && authQuery.data?.is_authenticated),
    retry: false,
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
    ],
    queryFn: () => {
      console.log("Fetching PR details with current_login:", authQuery.data?.login, "full authQuery.data:", authQuery.data);
      const payload = {
        owner: repoRef?.owner,
        repo: repoRef?.repo,
        number: selectedPr,
        currentLogin: authQuery.data?.login ?? null,
      };
      console.log("Full payload:", payload);
      return invoke<PullRequestDetail>("cmd_get_pull_request", payload);
    },
    enabled:
      Boolean(repoRef && selectedPr && authQuery.data?.is_authenticated),
  });

  const { refetch: refetchPullDetail } = pullDetailQuery;
  const prDetail = pullDetailQuery.data;

  const handleToggleRepoPanel = useCallback(() => {
    if (!repoRef) {
      setIsRepoPanelCollapsed(false);
      return;
    }
    setIsRepoPanelCollapsed((prev) => !prev);
  }, [repoRef]);

  const handleTogglePrPanel = useCallback(() => {
    if (!selectedPr) {
      setIsPrPanelCollapsed(false);
      return;
    }
    setIsPrPanelCollapsed((prev) => !prev);
  }, [selectedPr]);

  const handleRefreshPulls = useCallback(() => {
    void refetchPulls();
    void refetchPullDetail();
  }, [refetchPullDetail, refetchPulls]);

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

  const comments = useMemo(() => prDetail?.comments ?? [], [prDetail]);
  const myComments = useMemo(() => {
    if (comments.length > 0) {
      return comments.filter((comment) => comment.is_mine);
    }
    return prDetail?.my_comments ?? [];
  }, [comments, prDetail]);

  const reviews = prDetail?.reviews ?? [];
  const pendingReviewFromServer = useMemo(() => {
    console.log("Checking for pending review, reviews:", reviews);
    const review = reviews.find(
      (item) => {
        console.log("Review:", item, "is_mine:", item.is_mine, "state:", item.state);
        return item.is_mine && item.state.toUpperCase() === "PENDING";
      }
    );
    console.log("Pending review from server:", review);
    return review ?? null;
  }, [reviews]);

  const pendingReview = useMemo(() => {
    console.log("Computing pendingReview:", {
      pendingReviewOverride,
      pendingReviewFromServer,
      result: pendingReviewOverride
    });
    // Only use pendingReviewOverride - user must explicitly click "Show Review" to load GitHub review
    return pendingReviewOverride;
  }, [pendingReviewOverride]);

  useEffect(() => {
    if (!pendingReviewOverride) {
      return;
    }
    // Skip validation for local reviews (negative IDs or missing from GitHub reviews list)
    // Local reviews won't be in the reviews array until they're submitted to GitHub
    const isLocalReview = pendingReviewOverride.id < 0 || !reviews.some(r => r.id === pendingReviewOverride.id);
    if (isLocalReview) {
      console.log("Skipping validation for local review");
      return;
    }
    const matchingReview = reviews.find((item) => item.id === pendingReviewOverride.id);
    if (!matchingReview || matchingReview.state.toUpperCase() !== "PENDING") {
      console.log("Clearing pendingReviewOverride: no matching review found");
      setPendingReviewOverride(null);
    }
  }, [pendingReviewOverride, reviews]);

  useEffect(() => {
    console.log("PR number changed, clearing pendingReviewOverride");
    setPendingReviewOverride(null);
  }, [prDetail?.number]);

  // Clear local review override if a GitHub pending review is detected
  // BUT only if the override is a LOCAL review (not the same as the server review)
  useEffect(() => {
    const isOverrideFromServer = pendingReviewOverride?.id === pendingReviewFromServer?.id;
    console.log("Checking if should clear local review:", {
      pendingReviewFromServer,
      pendingReviewOverride,
      isOverrideFromServer,
      shouldClear: pendingReviewFromServer && pendingReviewOverride && !isOverrideFromServer
    });
    // Only clear if we have both reviews AND they are different (override is local)
    if (pendingReviewFromServer && pendingReviewOverride && !isOverrideFromServer) {
      console.log("GitHub pending review detected, clearing local review override");
      setPendingReviewOverride(null);
      setLocalComments([]);
    }
  }, [pendingReviewFromServer, pendingReviewOverride]);

  // Load local comments when we have a pending review
  const loadLocalComments = useCallback(async (reviewId?: number) => {
    // Use passed reviewId or fall back to pendingReview from state
    const effectiveReviewId = reviewId ?? pendingReview?.id;
    console.log("loadLocalComments called, repoRef:", repoRef, "prDetail:", prDetail?.number, "reviewId:", effectiveReviewId);
    
    if (!repoRef || !prDetail || !effectiveReviewId) {
      console.log("Clearing local comments - missing requirements");
      setLocalComments([]);
      return;
    }

    try {
      type LocalComment = {
        id: number;
        owner: string;
        repo: string;
        pr_number: number;
        file_path: string;
        line_number: number | null;
        side: "RIGHT" | "LEFT";
        body: string;
        commit_id: string;
        created_at: string;
        updated_at: string;
      };

      console.log("Fetching local comments from storage");
      const localCommentData = await invoke<LocalComment[]>("cmd_local_get_comments", {
        owner: repoRef.owner,
        repo: repoRef.repo,
        prNumber: prDetail.number,
      });

      console.log("Received local comments:", localCommentData);

      // Convert to PullRequestComment format
      const converted: PullRequestComment[] = localCommentData.map((lc) => ({
        id: lc.id,
        body: lc.body,
        author: authQuery.data?.login ?? "You",
        created_at: lc.created_at,
        url: "#", // Local comments don't have URLs yet
        path: lc.file_path,
        line: lc.line_number,
        side: lc.side,
        is_review_comment: true,
        is_draft: true, // Local comments are drafts
        state: null,
        is_mine: true,
        review_id: effectiveReviewId,
      }));

      console.log("Setting local comments to:", converted);
      setLocalComments(converted);
    } catch (error) {
      console.error("Failed to load local comments:", error);
      setLocalComments([]);
    }
  }, [repoRef, prDetail, pendingReview, authQuery.data?.login]);

  // Debug effect to track localComments changes
  useEffect(() => {
    console.log("localComments state changed:", localComments);
  }, [localComments]);

  // Load local comments only when we have a pendingReviewOverride (not from server)
  useEffect(() => {
    if (pendingReviewOverride && !pendingReviewFromServer) {
      // Only load local comments for locally-created reviews
      void loadLocalComments(pendingReviewOverride.id);
    } else if (!pendingReviewOverride) {
      setLocalComments([]);
    }
  }, [pendingReviewOverride?.id, pendingReviewFromServer]); // Only depend on the ID, not the whole callback

  const reviewAwareComments = useMemo(() => {
    console.log("reviewAwareComments COMPUTING with:", {
      pendingReviewId: pendingReview?.id,
      commentsLength: comments.length,
      localCommentsLength: localComments.length,
      localCommentsData: localComments
    });
    if (pendingReview) {
      // Merge GitHub comments with local comments
      const githubComments = comments.filter((comment) => comment.review_id === pendingReview.id);
      const merged = [...githubComments, ...localComments];
      console.log("reviewAwareComments RESULT:", merged);
      return merged;
    }
    return comments;
  }, [comments, pendingReview, localComments]);

  const effectiveFileCommentMode: "single" | "review" = fileCommentIsFileLevel
    ? "single"
    : pendingReview
      ? "review"
      : fileCommentMode;

  const formatFileLabel = useCallback((path: string) => {
    const segments = path.split("/").filter(Boolean);
    if (segments.length >= 2) {
      const folder = segments[segments.length - 2];
      const fileName = segments[segments.length - 1];
      return `${folder}/${fileName}`;
    }
    return path;
  }, []);

  const formatFileTooltip = useCallback((file: PullRequestFile) => {
    const status = file.status ? file.status.toUpperCase() : "";
    return status ? `${file.path} - ${status}` : file.path;
  }, []);

  const files = prDetail?.files ?? [];

  const sortedFiles = useMemo(() => {
    if (files.length === 0) {
      return [] as PullRequestFile[];
    }

    const originalOrder = [...files];
    const tocFile = originalOrder.find((file) => file.path.toLowerCase().endsWith("toc.yml"));
    const orderedPaths: string[] = [];

    if (tocFile) {
      const content = tocFile.head_content ?? tocFile.base_content ?? "";
      if (content.trim()) {
        const baseSegments = tocFile.path.split("/").slice(0, -1);
        const resolveHref = (href: string) => {
          const sanitized = href.split("#")[0].split("?")[0];
          const segments = sanitized.split("/");
          const resolved = [...baseSegments];
          for (const segment of segments) {
            if (!segment || segment === ".") {
              continue;
            }
            if (segment === "..") {
              resolved.pop();
            } else {
              resolved.push(segment);
            }
          }
          return resolved.join("/");
        };

        const collectMarkdownPaths = (node: unknown) => {
          if (Array.isArray(node)) {
            for (const item of node) {
              collectMarkdownPaths(item);
            }
            return;
          }

          if (!node || typeof node !== "object") {
            return;
          }

          const entry = node as Record<string, unknown>;
          const href = entry.href;
          if (typeof href === "string") {
            const resolvedPath = resolveHref(href);
            if (resolvedPath.toLowerCase().endsWith(".md")) {
              orderedPaths.push(resolvedPath);
            }
          }

          if (entry.items) {
            collectMarkdownPaths(entry.items);
          }
        };

        try {
          const parsed = parseYaml(content);
          collectMarkdownPaths(parsed);
        } catch (error) {
          console.warn("Failed to parse toc.yml", error);
        }
      }
    }

    const seen = new Set<string>();
    const ordered: PullRequestFile[] = [];

    if (tocFile) {
      ordered.push(tocFile);
      seen.add(tocFile.path);
    }

    for (const path of orderedPaths) {
      const matchingFile = originalOrder.find((file) => file.path === path);
      if (matchingFile && !seen.has(matchingFile.path)) {
        ordered.push(matchingFile);
        seen.add(matchingFile.path);
      }
    }

    for (const file of originalOrder) {
      if (!seen.has(file.path)) {
        ordered.push(file);
        seen.add(file.path);
      }
    }

    return ordered;
  }, [files]);

  const openInlineComment = useCallback(async () => {
    if (!selectedFilePath) {
      return;
    }
    setIsInlineCommentOpen(true);
    setFileCommentError(null);
    setFileCommentSuccess(false);
    setIsFileCommentComposerVisible(false);
    
    // Load local comments if they exist
    if (repoRef && prDetail) {
      try {
        type LocalComment = {
          id: number;
          owner: string;
          repo: string;
          pr_number: number;
          file_path: string;
          line_number: number | null;
          side: "RIGHT" | "LEFT";
          body: string;
          commit_id: string;
          created_at: string;
          updated_at: string;
        };

        const localCommentData = await invoke<LocalComment[]>("cmd_local_get_comments", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          prNumber: prDetail.number,
        });

        if (localCommentData.length > 0 && !pendingReview) {
          // Convert to PullRequestComment format
          const converted: PullRequestComment[] = localCommentData.map((lc) => ({
            id: lc.id,
            body: lc.body,
            author: authQuery.data?.login ?? "You",
            created_at: lc.created_at,
            url: "#",
            path: lc.file_path,
            line: lc.line_number,
            side: lc.side,
            is_review_comment: true,
            is_draft: true,
            state: null,
            is_mine: true,
            review_id: null,
          }));
          setLocalComments(converted);
        }
      } catch (error) {
        console.error("Failed to load local comments:", error);
      }
    }
  }, [selectedFilePath, repoRef, prDetail, pendingReview, authQuery.data?.login]);

  const closeInlineComment = useCallback(() => {
    setIsInlineCommentOpen(false);
    setFileCommentError(null);
    setFileCommentSuccess(false);
    setIsFileCommentComposerVisible(false);
  }, []);

  const toggleGeneralCommentComposer = useCallback(() => {
    setIsGeneralCommentOpen((previous) => {
      const next = !previous;
      if (next) {
        setCommentError(null);
        setCommentSuccess(false);
        setIsInlineCommentOpen(false);
      }
      return next;
    });
  }, []);

  const toggleUserMenu = useCallback(() => {
    setIsUserMenuOpen((previous) => !previous);
  }, []);

  const closeUserMenu = useCallback(() => {
    setIsUserMenuOpen(false);
  }, []);

  const handleOpenDevtools = useCallback(() => {
    closeUserMenu();
    openDevtoolsWindow();
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

  const selectedFile = useMemo(() => {
    if (!prDetail || !selectedFilePath) return null;
    return prDetail.files.find((file) => file.path === selectedFilePath) ?? null;
  }, [prDetail, selectedFilePath]);

  const fileComments = useMemo(() => {
    if (!selectedFilePath) {
      return reviewAwareComments;
    }
    return reviewAwareComments.filter((comment) => comment.path === selectedFilePath);
  }, [reviewAwareComments, selectedFilePath]);

  const hasAnyFileComments = fileComments.length > 0;
  const shouldShowFileCommentComposer = isFileCommentComposerVisible;
  const formattedRepo = repoRef ? `${repoRef.owner}/${repoRef.repo}` : "";

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

  useEffect(() => {
    if (sortedFiles.length > 0) {
      setSelectedFilePath((current) => {
        if (current && sortedFiles.some((file) => file.path === current)) {
          return current;
        }
        return sortedFiles[0].path;
      });
    } else {
      setSelectedFilePath(null);
    }
  }, [sortedFiles]);

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
    setIsInlineCommentOpen(false);
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
        setRepoError("Use the format owner/repo");
        return;
      }
      const owner = match[1];
      const repository = match[2];
      if (repoRef && repoRef.owner === owner && repoRef.repo === repository) {
        setRepoError(null);
        void refetchPulls();
        return;
      }
      setRepoError(null);
      setRepoRef({ owner, repo: repository });
      setSelectedPr(null);
      setSelectedFilePath(null);
      queryClient.removeQueries({ queryKey: ["pull-request"] });
    },
    [repoInput, repoRef, queryClient, refetchPulls],
  );

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
    onSuccess: () => {
      setCommentDraft("");
      setCommentError(null);
      setCommentSuccess(true);
      setIsGeneralCommentOpen(false);
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
    onSuccess: () => {
      setFileCommentDraft("");
      setFileCommentLine("");
      setFileCommentError(null);
      setFileCommentSuccess(true);
      setFileCommentIsFileLevel(false);
      setFileCommentMode(pendingReview ? "review" : "single");
      setFileCommentSide("RIGHT");
      setIsFileCommentComposerVisible(false);
      void refetchPullDetail();
      void loadLocalComments(); // Reload local comments
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
      console.log("Starting review mutation...");
      if (!repoRef || !prDetail) {
        throw new Error("Select a pull request before starting a review.");
      }

      console.log("Calling cmd_local_start_review with:", {
        owner: repoRef.owner,
        repo: repoRef.repo,
        prNumber: prDetail.number,
        commitId: prDetail.head_sha,
      });

      // Use local storage instead of GitHub API
      await invoke("cmd_local_start_review", {
        owner: repoRef.owner,
        repo: repoRef.repo,
        prNumber: prDetail.number,
        commitId: prDetail.head_sha,
        body: null,
      });

      console.log("Review started successfully");

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
    onSuccess: (review) => {
      console.log("Review mutation success, review:", review);
      console.log("Setting pending review override");
      setPendingReviewOverride(review);
      console.log("Loading local comments with review ID:", review.id);
      void loadLocalComments(review.id); // Pass review ID directly to avoid race condition
      console.log("Opening inline comment panel");
      setIsInlineCommentOpen(true); // Show comments panel
      setIsFileCommentComposerVisible(false); // Show list, not composer
      setFileCommentError(null);
      setFileCommentSuccess(false);
      // Don't refetch pull detail - we're using local storage, not GitHub API
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

      await invoke("cmd_submit_local_review", {
        owner: repoRef.owner,
        repo: repoRef.repo,
        prNumber: prDetail.number,
        body: null,
        event: "COMMENT",
      });
    },
    onSuccess: () => {
      setPendingReviewOverride(null);
      setLocalComments([]);
      setFileCommentError(null);
      setFileCommentSuccess(true);
      void refetchPullDetail();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to submit review.";
      setFileCommentError(message);
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
    onSuccess: () => {
      setPendingReviewOverride(null);
      setLocalComments([]);
      setFileCommentError(null);
      void refetchPullDetail();
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
    onSuccess: () => {
      console.log("Update comment success");
      setFileCommentDraft("");
      setFileCommentError(null);
      setFileCommentSuccess(true);
      setEditingCommentId(null);
      setEditingComment(null);
      setIsFileCommentComposerVisible(false);
      
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
    onSuccess: () => {
      console.log("Delete comment success");
      setFileCommentDraft("");
      setFileCommentError(null);
      setEditingCommentId(null);
      setEditingComment(null);
      setIsFileCommentComposerVisible(false);
      
      // Reload appropriate data based on comment type
      if (editingComment?.url === "#" || !editingComment?.url) {
        void loadLocalComments();
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

  const handleAddCommentClick = useCallback(() => {
    setEditingCommentId(null);
    setEditingComment(null);
    openFileCommentComposer(pendingReview ? "review" : "single");
  }, [openFileCommentComposer, pendingReview]);

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
        type ReviewMetadata = {
          owner: string;
          repo: string;
          pr_number: number;
          commit_id: string;
          body: string | null;
          created_at: string;
          log_file_index: number;
        };

        const metadata = await invoke<ReviewMetadata | null>("cmd_local_get_review_metadata", {
          owner: repoRef.owner,
          repo: repoRef.repo,
          prNumber: prDetail.number,
        });

        if (metadata) {
          console.log("Review metadata found, creating pending review");
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

  const handleShowReviewClick = useCallback(async () => {
    console.log("Show review button clicked, pendingReviewFromServer:", pendingReviewFromServer);
    if (pendingReviewFromServer && repoRef && prDetail) {
      console.log("Setting pendingReviewOverride to:", pendingReviewFromServer);
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
        console.log("Comment details:", pendingComments.map(c => ({ id: c.id, path: c.path, line: c.line, body: c.body.substring(0, 50) })));
        setLocalComments(pendingComments);
      } catch (error) {
        console.error("Failed to fetch pending review comments:", error);
        setLocalComments([]);
      } finally {
        setIsLoadingPendingComments(false);
      }
      
      setIsInlineCommentOpen(true);
      setIsFileCommentComposerVisible(false);
      console.log("Panel state updated: isInlineCommentOpen=true");
    } else {
      console.log("No pendingReviewFromServer available");
    }
  }, [pendingReviewFromServer, repoRef, prDetail, authQuery.data?.login]);

  const handleDeleteReviewClick = useCallback(async () => {
    if (!pendingReview || !repoRef || !prDetail) return;
    
    if (!window.confirm("Are you sure you want to delete this pending review?")) return;
    
    // Check if this is a GitHub review (has html_url) or local review (no html_url)
    if (pendingReview.html_url) {
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
        setIsInlineCommentOpen(false);
      } catch (error) {
        console.error("Failed to delete local review:", error);
        const message = error instanceof Error ? error.message : "Failed to delete local review.";
        setFileCommentError(message);
      }
    }
  }, [pendingReview, repoRef, prDetail, deleteReviewMutation]);

  const handleCloseReviewClick = useCallback(() => {
    // Clear the review override to go back to viewing published comments, but keep panel open
    setPendingReviewOverride(null);
    setLocalComments([]);
    // Keep isInlineCommentOpen=true so the panel stays open showing published comments
  }, []);

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
    (event: React.FormEvent) => {
      event.preventDefault();
      
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

      const commentMode: "single" | "review" = effectiveFileCommentMode;

      let parsedLine: number | null = null;
      if (!fileCommentIsFileLevel) {
        if (!fileCommentLine) {
          setFileCommentError("Provide a line number or mark the comment as file-level.");
          return;
        }
        const numericLine = Number(fileCommentLine);
        if (!Number.isInteger(numericLine) || numericLine <= 0) {
          setFileCommentError("Line numbers must be positive integers.");
          return;
        }
        
        // Validate line number against file content
        if (selectedFile) {
          const content = fileCommentSide === "RIGHT" ? selectedFile.head_content : selectedFile.base_content;
          if (content) {
            const lineCount = content.split("\n").length;
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
        subjectType: fileCommentIsFileLevel ? "file" : null,
        pendingReviewId: pendingReview ? pendingReview.id : null,
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

  const pullRequests = pullsQuery.data ?? [];
  const selectedPrSummary = selectedPr
    ? pullRequests.find((pr) => pr.number === selectedPr) ?? null
    : null;
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
                  {import.meta.env.DEV && (
                    <button
                      type="button"
                      className="user-menu__item"
                      onClick={handleOpenDevtools}
                      role="menuitem"
                    >
                      Devtools
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
                      <span className="panel__title-button panel__title-button--inline" style={{ cursor: 'default' }}>
                        <span className="panel__title-text">PR</span>
                        <span className="panel__summary panel__summary--inline" title={`#${prDetail.number} · ${prDetail.title}`}>
                          #{prDetail.number} · {prDetail.title}
                        </span>
                      </span>
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
                {prDetail && <div style={{ height: '8px' }} />}
              <div className="comment-panel">
                <div className="comment-panel__header">
                  <div className="comment-panel__title-group">
                    <span className="comment-panel__title">File comments</span>
                    {selectedFilePath && (
                      <span className="comment-panel__subtitle" title={selectedFilePath}>
                        {selectedFilePath}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="comment-panel__close"
                    onClick={closeInlineComment}
                    aria-label="Hide file comments"
                  >
                    ×
                  </button>
                </div>
                <div className="comment-panel__body">
                  {selectedFile ? (
                    shouldShowFileCommentComposer ? (
                      <form className="comment-panel__form" onSubmit={handleFileCommentSubmit}>
                        {(hasAnyFileComments || editingCommentId !== null) && (
                          <button
                            type="button"
                            className="comment-panel__action-button comment-panel__action-button--subtle"
                            onClick={() => {
                              setIsFileCommentComposerVisible(false);
                              setEditingCommentId(null);
                              setEditingComment(null);
                              setFileCommentDraft("");
                              setFileCommentError(null);
                            }}
                          >
                            ← Back to comments
                          </button>
                        )}
                        <textarea
                          value={fileCommentDraft}
                          placeholder="Leave feedback on the selected file…"
                          onChange={(event) => {
                            setFileCommentDraft(event.target.value);
                            setFileCommentError(null);
                            setFileCommentSuccess(false);
                          }}
                          rows={6}
                        />
                        {editingCommentId === null && (
                          <label className="comment-panel__checkbox">
                            <input
                              type="checkbox"
                              checked={fileCommentIsFileLevel}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setFileCommentIsFileLevel(checked);
                                setFileCommentSuccess(false);
                                setFileCommentError(null);
                                if (checked) {
                                  setFileCommentLine("");
                                  setFileCommentMode("single");
                                }
                              }}
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
                                value={fileCommentLine}
                                onChange={(event) => {
                                  setFileCommentLine(event.target.value);
                                  setFileCommentError(null);
                                  setFileCommentSuccess(false);
                                }}
                              />
                            </label>
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
                          {editingCommentId !== null ? (
                            <div className="comment-panel__edit-actions">
                              <button
                                type="submit"
                                className="comment-submit"
                                disabled={updateCommentMutation.isPending}
                              >
                                {updateCommentMutation.isPending ? "Updating…" : "Update Comment"}
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
                            <button
                              type="submit"
                              className="comment-submit"
                              disabled={submitFileCommentMutation.isPending}
                            >
                              {submitFileCommentMutation.isPending
                                ? "Sending…"
                                : effectiveFileCommentMode === "review"
                                  ? pendingReview
                                    ? (pendingReview.html_url ? "Add comment" : "Add to review")
                                    : (localComments.length > 0 ? "Show review" : "Start review")
                                  : "Post comment"}
                            </button>
                          )}
                        </div>
                      </form>
                    ) : (
                      <div className="comment-panel__existing">
                        {pendingReview && (
                          <div className="comment-panel__review-type">
                            {pendingReview.html_url 
                              ? "Pending review on GitHub: " 
                              : "Comments saved locally: "}
                          </div>
                        )}
                        {fileComments.length === 0 && !pendingReview && (
                          <div className="comment-panel__empty-state">
                            <p>There are no published comments.</p>
                          </div>
                        )}
                        {fileComments.length === 0 && pendingReview && !isLoadingPendingComments && (
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
                        <ul className="comment-panel__list">
                          {fileComments.map((comment) => {
                            const formattedTimestamp = new Date(comment.created_at).toLocaleString();
                            // Check if this is a pending GitHub review comment
                            const isPendingGitHubReviewComment = comment.review_id === pendingReview?.id && pendingReview?.html_url;
                            // Show edit button for local comments OR submitted GitHub comments (not pending GitHub review comments)
                            const showEditButton = !isPendingGitHubReviewComment && 
                              ((comment.is_draft && !pendingReview?.html_url) || (comment.is_mine && !comment.is_draft));
                            console.log('Comment icon logic:', {
                              commentId: comment.id,
                              is_draft: comment.is_draft,
                              is_mine: comment.is_mine,
                              review_id: comment.review_id,
                              pendingReviewId: pendingReview?.id,
                              pendingReviewHtmlUrl: pendingReview?.html_url,
                              isPendingGitHubReviewComment,
                              showEditButton
                            });
                            return (
                              <li key={comment.id} className="comment-panel__item">
                                <div className="comment-panel__item-header" title={formattedTimestamp}>
                                  <div className="comment-panel__item-header-info">
                                    <span className="comment-panel__item-author">{comment.author}</span>
                                    {comment.is_draft && (
                                      <span className="comment-panel__item-badge">Pending</span>
                                    )}
                                  </div>
                                  <div className="comment-panel__item-actions">
                                    {/* Show edit button for local comments OR submitted GitHub comments (not pending GitHub review) */}
                                    {showEditButton && (
                                      <button
                                        type="button"
                                        className="comment-panel__item-edit"
                                        onClick={() => {
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
                                      >
                                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="16" height="16">
                                          <path
                                            d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
                                            fill="currentColor"
                                          />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <div className="comment-panel__item-body">
                                  {comment.line && (
                                    <span className="comment-panel__item-line">#{comment.line}.</span>
                                  )}
                                  <div className="comment-panel__item-content">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                      {comment.body}
                                    </ReactMarkdown>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                        <div className="comment-panel__actions">
                          {/* Only show 'Add to review' for local reviews (no html_url) or 'Add comment' when no review */}
                          {(!pendingReview || !pendingReview.html_url) && (
                            <button
                              type="button"
                              className="comment-panel__action-button"
                              onClick={handleAddCommentClick}
                              disabled={startReviewMutation.isPending}
                            >
                              {pendingReview ? "Add to review" : "Add comment"}
                            </button>
                          )}
                          {pendingReview ? (
                            <>
                              <button
                                type="button"
                                className="comment-panel__action-button comment-panel__action-button--primary"
                                onClick={handleSubmitReviewClick}
                                disabled={submitReviewMutation.isPending || localComments.length === 0}
                              >
                                {submitReviewMutation.isPending ? "Submitting…" : "Submit review"}
                              </button>
                              <button
                                type="button"
                                className="comment-panel__action-button comment-panel__action-button--danger"
                                onClick={handleDeleteReviewClick}
                                disabled={deleteReviewMutation.isPending}
                              >
                                {deleteReviewMutation.isPending ? "Deleting…" : "Delete review"}
                              </button>
                              <button
                                type="button"
                                className="comment-panel__action-button"
                                onClick={handleCloseReviewClick}
                              >
                                Close Review
                              </button>
                            </>
                          ) : pendingReviewFromServer ? (
                            <button
                              type="button"
                              className="comment-panel__action-button comment-panel__action-button--secondary"
                              onClick={handleShowReviewClick}
                            >
                              Show Review
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="comment-panel__action-button comment-panel__action-button--secondary"
                              onClick={handleStartReviewClick}
                              disabled={startReviewMutation.isPending}
                            >
                              {startReviewMutation.isPending ? "Starting…" : (localComments.length > 0 ? "Show review" : "Start review")}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="comment-panel__empty">Select a file to leave feedback.</div>
                  )}
                </div>
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
                        <span className="panel__summary panel__summary--inline" title={formattedRepo}>
                          {formattedRepo}
                        </span>
                      )}
                    </button>
                    {repoRef && (
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
                        <input
                          value={repoInput}
                          placeholder="docs/handbook"
                          onChange={(event) => setRepoInput(event.target.value)}
                        />
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
                        <span className="chip-label repo-indicator">Viewing {formattedRepo}</span>
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
                      disabled={!pullRequests.length}
                      {...prPanelAriaProps}
                    >
                      <span className="panel__expando-icon" aria-hidden="true">
                        {isPrPanelCollapsed && selectedPr ? ">" : "v"}
                      </span>
                      <span className="panel__title-text">{isPrPanelCollapsed && selectedPr ? "PR" : "PRs"}</span>
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
                    <div className="panel__body panel__body--scroll">
                      {pullsQuery.isError ? (
                        <div className="empty-state empty-state--subtle">
                          Unable to load pull requests.
                          <br />
                          {pullsErrorMessage}
                        </div>
                      ) : pullsQuery.isLoading || pullsQuery.isFetching ? (
                        <div className="empty-state empty-state--subtle">Loading pull requests…</div>
                      ) : pullRequests.length === 0 ? (
                        <div className="empty-state empty-state--subtle">
                          {repoRef
                            ? "No Markdown or YAML pull requests found."
                            : "Enter a repository to begin."}
                        </div>
                      ) : (
                        pullRequests.map((pr) => (
                          <button
                            key={pr.number}
                            type="button"
                            className={`pr-item pr-item--compact${selectedPr === pr.number ? " pr-item--active" : ""}`}
                            onClick={() => {
                              setSelectedPr(pr.number);
                              setSelectedFilePath(null);
                            }}
                          >
                            <span className="pr-item__title">#{pr.number} · {pr.title}</span>
                            <span className="pr-item__meta">
                              <span>{pr.author}</span>
                              <span>{new Date(pr.updated_at).toLocaleString()}</span>
                              <span>{pr.head_ref}</span>
                            </span>
                          </button>
                        ))
                      )}
                      <div className="panel__footer">
                        <button
                          type="button"
                          className="comment-panel__action-button comment-panel__action-button--secondary"
                          onClick={() => setShowClosedPRs(!showClosedPRs)}
                        >
                          {showClosedPRs ? "Hide Closed PRs" : "Show Closed PRs"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="panel panel--files" style={{ marginTop: isInlineCommentOpen && prDetail ? '8px' : undefined }}>
                  <div className="panel__header panel__header--static">
                    <span>Files</span>
                  </div>
                  <div className="panel__body panel__body--flush">
                    {pullDetailQuery.isLoading ? (
                      <div className="empty-state empty-state--subtle">Loading files…</div>
                    ) : !prDetail ? (
                      <div className="empty-state empty-state--subtle">Select a pull request.</div>
                    ) : sortedFiles.length === 0 ? (
                      <div className="empty-state empty-state--subtle">
                        No Markdown or YAML files in this pull request.
                      </div>
                    ) : (
                      <ul className="file-list file-list--compact">
                        {sortedFiles.map((file) => {
                          const displayName = formatFileLabel(file.path);
                          const tooltip = formatFileTooltip(file);
                          return (
                            <li key={file.path}>
                              <button
                                type="button"
                                className={`file-list__button${
                                  selectedFilePath === file.path ? " file-list__button--active" : ""
                                }`}
                                onClick={() => setSelectedFilePath(file.path)}
                                title={tooltip}
                              >
                                <span className="file-list__name">{displayName}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
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
            <div className="pane pane--diff">
              <div className="pane__header">
                <div className="pane__title-group">
                  <span>Diff</span>
                  {selectedFilePath && <span className="pane__subtitle">{selectedFilePath}</span>}
                </div>
                <div className="pane__actions">
                  {commentSuccess && !isGeneralCommentOpen && (
                    <span className="pane__status comment-status comment-status--success">
                      Comment published
                    </span>
                  )}
                  {selectedFile && (
                    <>
                      <button
                        type="button"
                        className="pane__action-button"
                        onClick={toggleGeneralCommentComposer}
                      >
                        {isGeneralCommentOpen ? "Close overall comment" : "Add PR Comment"}
                      </button>
                      <button
                        type="button"
                        className="pane__action-button"
                        onClick={isInlineCommentOpen ? closeInlineComment : openInlineComment}
                      >
                        {isInlineCommentOpen ? "Hide File Comments" : "Show File Comments"}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="pane__content">
                {isGeneralCommentOpen && prDetail && (
                  <form className="comment-composer comment-composer--inline" onSubmit={handleCommentSubmit}>
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
                    />
                    <div className="comment-composer__actions">
                      <div className="comment-composer__status">
                        {commentError && (
                          <span className="comment-status comment-status--error">{commentError}</span>
                        )}
                      </div>
                      <button
                        type="submit"
                        className="comment-submit"
                        disabled={submitCommentMutation.isPending}
                      >
                        {submitCommentMutation.isPending ? "Sending…" : "Post comment"}
                      </button>
                    </div>
                  </form>
                )}
                <div className="pane__viewer">
                  {selectedFile ? (
                    <DiffEditor
                      original={selectedFile.base_content ?? ""}
                      modified={selectedFile.head_content ?? ""}
                      language={selectedFile.language === "yaml" ? "yaml" : "markdown"}
                      options={{
                        readOnly: true,
                        renderSideBySide: false,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                      }}
                    />
                  ) : (
                    <div className="empty-state">
                      {prDetail ? "Pick a file to see its diff." : "Choose a pull request to begin."}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div
              className={`workspace__divider${isResizing ? " workspace__divider--active" : ""}`}
              onMouseDown={handleResizeStart}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize diff and preview panes"
            />

            <div className="pane pane--preview">
              <div className="pane__header">
                <div className="pane__title-group">
                  <span>Preview</span>
                  {selectedFilePath && <span className="pane__subtitle">{selectedFilePath}</span>}
                </div>
              </div>
              <div className="pane__content">
                <div className="pane__viewer">
                  {selectedFile ? (
                    selectedFile.language === "markdown" ? (
                      <div className="markdown-preview">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {selectedFile.head_content ?? ""}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <pre className="markdown-preview">
                        <code>{selectedFile.head_content ?? ""}</code>
                      </pre>
                    )
                  ) : (
                    <div className="empty-state">
                      {prDetail ? "Preview appears once a file is selected." : "Choose a pull request to begin."}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete Comment</h3>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete this comment?</p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="modal-button modal-button--secondary"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-button modal-button--danger"
                onClick={() => {
                  if (editingCommentId !== null) {
                    deleteCommentMutation.mutate(editingCommentId);
                  }
                  setShowDeleteConfirm(false);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
