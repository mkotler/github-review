import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { Editor, DiffEditor } from "@monaco-editor/react";
import { parse as parseYaml } from "yaml";
import mermaid from "mermaid";

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
  has_pending_review: boolean;
  file_count: number;
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
  previous_filename?: string | null;
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

type PrUnderReview = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  has_local_review: boolean;
  has_pending_review: boolean;
  viewed_count: number;
  total_count: number;
};

const AUTH_QUERY_KEY = ["auth-status"] as const;

const openDevtoolsWindow = () => {
  void invoke("cmd_open_devtools").catch((error) => {
    console.warn("Failed to open devtools", error);
  });
};

const MIN_SIDEBAR_WIDTH = 340;
const MIN_CONTENT_WIDTH = 480;

// Component to handle async image loading
function AsyncImage({ owner, repo, reference, path, alt, onClick, ...props }: { 
  owner: string; 
  repo: string; 
  reference: string; 
  path: string; 
  alt?: string;
  onClick?: () => void;
  [key: string]: any;
}) {
  const [imageData, setImageData] = useState<string | null>(null);
  const [error, setError] = useState<boolean>(false);
  
  useEffect(() => {
    let cancelled = false;
    
    const fetchImage = async () => {
      try {
        const base64Data = await invoke<string>("cmd_fetch_file_content", {
          owner,
          repo,
          reference,
          path
        });
        
        if (!cancelled) {
          // Determine MIME type from extension
          const ext = path.split('.').pop()?.toLowerCase();
          const mimeTypes: Record<string, string> = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'svg': 'image/svg+xml',
            'webp': 'image/webp'
          };
          const mimeType = mimeTypes[ext || ''] || 'image/png';
          
          setImageData(`data:${mimeType};base64,${base64Data}`);
        }
      } catch (err) {
        console.error('Failed to fetch image:', { path, error: err });
        if (!cancelled) {
          setError(true);
        }
      }
    };
    
    fetchImage();
    
    return () => {
      cancelled = true;
    };
  }, [owner, repo, reference, path]);
  
  if (error) {
    // Image doesn't exist in the repository - just show alt text or a note
    return <span className="image-error" title={`Image not found in repository: ${path}`}>
      {alt ? `[${alt}]` : `[Image: ${path.split('/').pop()}]`}
    </span>;
  }
  
  if (!imageData) {
    return null; // Don't show anything while loading to avoid flicker
  }
  
  return (
    <img 
      src={imageData} 
      alt={alt} 
      onClick={onClick}
      className={onClick ? 'clickable-image' : ''}
      {...props} 
    />
  );
}

// Initialize Mermaid
mermaid.initialize({
  startOnLoad: true,
  theme: 'default',
  securityLevel: 'loose',
});

// Custom component for rendering Mermaid diagrams
const MermaidCode = ({ children }: { children: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ref.current && typeof children === 'string') {
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      mermaid.render(id, children)
        .then(({ svg }) => {
          if (ref.current) {
            ref.current.innerHTML = svg;
          }
        })
        .catch((err) => {
          console.error('Mermaid render error:', err);
          setError(err.message || 'Failed to render diagram');
        });
    }
  }, [children]);

  if (error) {
    return <pre style={{ color: 'red' }}>Mermaid Error: {error}</pre>;
  }

  return <div ref={ref} className="mermaid-diagram" />;
};

function App() {
  const [repoRef, setRepoRef] = useState<RepoRef | null>(null);
  const [repoInput, setRepoInput] = useState("");
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoMRU, setRepoMRU] = useState<string[]>(() => {
    const stored = localStorage.getItem('repo-mru');
    return stored ? JSON.parse(stored) : [];
  });
  const [showRepoMRU, setShowRepoMRU] = useState(false);
  const [viewedFiles, setViewedFiles] = useState<Record<string, string[]>>(() => {
    const stored = localStorage.getItem('viewed-files');
    return stored ? JSON.parse(stored) : {};
  });
  const [selectedPr, setSelectedPr] = useState<number | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRepoPanelCollapsed, setIsRepoPanelCollapsed] = useState(false);
  const [isPrPanelCollapsed, setIsPrPanelCollapsed] = useState(false);
  const [isInlineCommentOpen, setIsInlineCommentOpen] = useState(false);
  const [hasManuallyClosedCommentPanel, setHasManuallyClosedCommentPanel] = useState(false);
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
  const [, setReviewSummaryDraft] = useState("");
  const [, setReviewSummaryError] = useState<string | null>(null);
  const [pendingReviewOverride, setPendingReviewOverride] = useState<PullRequestReview | null>(null);
  const [localComments, setLocalComments] = useState<PullRequestComment[]>([]);
  const [isLoadingPendingComments, setIsLoadingPendingComments] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingComment, setEditingComment] = useState<PullRequestComment | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteReviewConfirm, setShowDeleteReviewConfirm] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [maximizedPane, setMaximizedPane] = useState<'source' | 'preview' | 'media' | null>(null);
  const [savedSplitRatio, setSavedSplitRatio] = useState<string | null>(null);
  const [mediaViewerContent, setMediaViewerContent] = useState<{ type: 'image' | 'mermaid', content: string } | null>(null);
  const [showFilesMenu, setShowFilesMenu] = useState(false);
  const [isPrCommentsView, setIsPrCommentsView] = useState(false);
  const [isPrCommentComposerOpen, setIsPrCommentComposerOpen] = useState(false);
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const prFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const sourceMenuRef = useRef<HTMLDivElement | null>(null);
  const filesMenuRef = useRef<HTMLDivElement | null>(null);
  const previewViewerRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<any>(null);
  const isScrollingSyncRef = useRef(false);
  const previousBodyCursorRef = useRef<string | null>(null);
  const previousBodyUserSelectRef = useRef<string | null>(null);
  const hoveredLineRef = useRef<number | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const fileCommentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const queryClient = useQueryClient();

  // Auto-focus textarea when comment composer opens
  useEffect(() => {
    if (isFileCommentComposerVisible && fileCommentTextareaRef.current) {
      fileCommentTextareaRef.current.focus();
    }
  }, [isFileCommentComposerVisible]);

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

  const prsUnderReviewQuery = useQuery({
    queryKey: ["prs-under-review", authQuery.data?.login],
    queryFn: async () => {
      console.log("Fetching PRs under review...");
      const prs = await invoke<PrUnderReview[]>("cmd_get_prs_under_review");
      console.log("PRs under review from backend:", prs);
      return prs;
    },
    enabled: authQuery.data?.is_authenticated === true,
    retry: false,
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
            }));
          
          if (prsWithPendingReviews.length > 0) {
            console.log(`✓ Found ${prsWithPendingReviews.length} PR(s) with pending review in ${owner}/${repo} (open)`);
          }
          
          return prsWithPendingReviews;
        },
        enabled: authQuery.data?.is_authenticated === true && !!currentLogin,
        retry: false,
        staleTime: 60 * 60 * 1000, // 1 hour
        gcTime: 60 * 60 * 1000, // Keep in cache for 1 hour
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
            }));
          
          if (prsWithPendingReviews.length > 0) {
            console.log(`✓ Found ${prsWithPendingReviews.length} PR(s) with pending review in ${owner}/${repo} (closed)`);
          }
          
          return prsWithPendingReviews;
        },
        enabled: authQuery.data?.is_authenticated === true && !!currentLogin && allOpenQueriesFinished,
        retry: false,
        staleTime: 60 * 60 * 1000, // 1 hour
        gcTime: 60 * 60 * 1000, // Keep in cache for 1 hour
      };
    }),
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
      const currentLogin = authQuery.data?.login ?? null;
      return invoke<PullRequestDetail>("cmd_get_pull_request", {
        owner: repoRef?.owner,
        repo: repoRef?.repo,
        number: selectedPr,
        currentLogin,
      });
    },
    enabled:
      Boolean(repoRef && selectedPr && authQuery.data?.is_authenticated && authQuery.data?.login),
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
  // const myComments = useMemo(() => {
  //   if (comments.length > 0) {
  //     return comments.filter((comment) => comment.is_mine);
  //   }
  //   return prDetail?.my_comments ?? [];
  // }, [comments, prDetail]);

  // Filter to get only PR-level (issue) comments, not file review comments
  const prLevelComments = useMemo(() => comments.filter(c => !c.is_review_comment), [comments]);

  const reviews = useMemo(() => prDetail?.reviews ?? [], [prDetail?.reviews]);
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

  // Only use pendingReviewOverride - user must explicitly click "Show Review" to load GitHub review
  const pendingReview = pendingReviewOverride;

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

  // Reset manual close flag when PR changes to allow auto-open for new PR
  useEffect(() => {
    setHasManuallyClosedCommentPanel(false);
  }, [selectedPr]);

  // Check for existing local review when PR loads
  useEffect(() => {
    const checkForLocalReview = async () => {
      if (!repoRef || !prDetail || pendingReviewOverride || pendingReviewFromServer) {
        return;
      }

      try {
        console.log("Checking for existing local review...");
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

        if (localCommentData.length > 0) {
          console.log("Found existing local review with", localCommentData.length, "comments");
          // Create a pending review object for the local review
          const localReview: PullRequestReview = {
            id: prDetail.number,
            state: "PENDING",
            author: authQuery.data?.login ?? "You",
            submitted_at: null,
            body: null,
            html_url: null,
            commit_id: prDetail.head_sha,
            is_mine: true,
          };
          setPendingReviewOverride(localReview);

          // Convert and set local comments
          const converted: PullRequestComment[] = localCommentData.map((lc) => {
            console.log('Converting local comment:', { id: lc.id, line_number: lc.line_number, type: typeof lc.line_number });
            return {
              id: lc.id,
              body: lc.body,
              author: authQuery.data?.login ?? "You",
              created_at: lc.created_at,
              url: "#",
              path: lc.file_path,
              line: lc.line_number === 0 ? null : lc.line_number,
              side: lc.side,
              is_review_comment: true,
              is_draft: true,
              state: null,
              is_mine: true,
              review_id: prDetail.number,
            };
          });
          console.log('Converted local comments:', converted);
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
        line: lc.line_number === 0 ? null : lc.line_number,
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
    console.log("reviewAwareComments COMPUTING with:", {
      pendingReviewId: pendingReview?.id,
      commentsLength: comments.length,
      localCommentsLength: localComments.length,
      localCommentsData: localComments
    });
    if (pendingReview) {
      // Include ALL published comments + pending review comments (GitHub or local)
      // Published comments don't have review_id matching pending review
      const publishedComments = comments.filter((comment) => !comment.is_draft);
      const pendingGitHubComments = comments.filter((comment) => comment.review_id === pendingReview.id && comment.is_draft);
      const merged = [...publishedComments, ...pendingGitHubComments, ...localComments];
      console.log("reviewAwareComments RESULT:", merged);
      return merged;
    }
    return comments;
  }, [comments, pendingReview, localComments]);

  const effectiveFileCommentMode: "single" | "review" = fileCommentIsFileLevel
    ? "single"
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

  const formatFilePathWithLeadingEllipsis = useCallback((path: string, maxLength: number = 200) => {
    if (path.length <= maxLength) {
      return path;
    }
    return `...${path.slice(-(maxLength - 3))}`;
  }, []);

  const files = prDetail?.files ?? [];

  // Find toc.yml file if it exists
  const tocFileMetadata = useMemo(() => {
    return files.find((file) => file.path.toLowerCase().endsWith("toc.yml"));
  }, [files]);

  // Load toc.yml content if it exists
  const tocContentQuery = useQuery({
    queryKey: ["toc-content", repoRef?.owner, repoRef?.repo, tocFileMetadata?.path, prDetail?.base_sha, prDetail?.head_sha],
    queryFn: async () => {
      if (!tocFileMetadata || !prDetail || !repoRef) return null;
      const [headContent, baseContent] = await invoke<[string | null, string | null]>("cmd_get_file_contents", {
        owner: repoRef.owner,
        repo: repoRef.repo,
        filePath: tocFileMetadata.path,
        baseSha: prDetail.base_sha,
        headSha: prDetail.head_sha,
        status: tocFileMetadata.status,
      });
      return headContent ?? baseContent ?? "";
    },
    enabled: Boolean(tocFileMetadata && prDetail && repoRef),
    staleTime: Infinity,
  });

  const sortedFiles = useMemo(() => {
    if (files.length === 0) {
      return [] as PullRequestFile[];
    }

    const originalOrder = [...files];
    const tocFile = tocFileMetadata;
    const orderedPaths: string[] = [];

    if (tocFile) {
      const content = tocContentQuery.data ?? "";
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
      let matchingFile = originalOrder.find((file) => file.path === path);
      
      // If not found with resolved path, try without the toc directory prefix
      if (!matchingFile && tocFile) {
        const baseSegments = tocFile.path.split("/").slice(0, -1);
        const relativePrefix = baseSegments.join("/") + "/";
        if (path.startsWith(relativePrefix)) {
          const withoutPrefix = path.substring(relativePrefix.length);
          matchingFile = originalOrder.find((file) => file.path === withoutPrefix);
        }
      }
      
      // If still not found, try matching by suffix (handles different directory structures)
      if (!matchingFile) {
        matchingFile = originalOrder.find((file) => 
          file.path.endsWith(path) || path.endsWith(file.path)
        );
      }
      
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
  }, [files, tocFileMetadata, tocContentQuery.data]);

  const visibleFiles = useMemo(() => {
    return sortedFiles.slice(0, visibleFileCount);
  }, [sortedFiles, visibleFileCount]);

  // Reset visible file count when PR changes
  useEffect(() => {
    setVisibleFileCount(50);
  }, [selectedPr]);

  // Auto-select first file when sorted files load
  useEffect(() => {
    if (sortedFiles.length > 0 && !selectedFilePath) {
      setSelectedFilePath(sortedFiles[0].path);
    }
  }, [sortedFiles, selectedFilePath]);

  // Progressively load more file metadata in the background
  useEffect(() => {
    if (visibleFileCount >= sortedFiles.length) {
      return;
    }

    const timer = setTimeout(() => {
      setVisibleFileCount(prev => Math.min(prev + 50, sortedFiles.length));
    }, 100);

    return () => clearTimeout(timer);
  }, [visibleFileCount, sortedFiles.length]);

  // Preload file contents in the background (one at a time, in order)
  useEffect(() => {
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
          });
          // Small delay between fetches to avoid overwhelming the backend
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    };

    preloadNextFile();
  }, [visibleFiles, prDetail, repoRef, queryClient]);

  const openInlineComment = useCallback(async () => {
    if (!selectedFilePath) {
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

        if (localCommentData.length > 0) {
          // Create or find a local review object
          let localReview = reviews.find(r => r.id === prDetail.number);
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
          const converted: PullRequestComment[] = localCommentData.map((lc) => ({
            id: lc.id,
            body: lc.body,
            author: authQuery.data?.login ?? "You",
            created_at: lc.created_at,
            url: "#",
            path: lc.file_path,
            line: lc.line_number === 0 ? null : lc.line_number,
            side: lc.side,
            is_review_comment: true,
            is_draft: true,
            state: null,
            is_mine: true,
            review_id: localReview.id,
          }));
          setLocalComments(converted);
          setPendingReviewOverride(localReview);
        }
      } catch (error) {
        console.error("Failed to load local comments:", error);
      }
    }
  }, [selectedFilePath, repoRef, prDetail, pendingReview, authQuery.data?.login]);

  const closeInlineComment = useCallback(() => {
    setIsInlineCommentOpen(false);
    setHasManuallyClosedCommentPanel(true);
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

  const selectedFileMetadata = useMemo(() => {
    if (!prDetail || !selectedFilePath) return null;
    return prDetail.files.find((file) => file.path === selectedFilePath) ?? null;
  }, [prDetail, selectedFilePath]);

  // Fetch file contents on demand when a file is selected
  const fileContentsQuery = useQuery({
    queryKey: ["file-contents", repoRef?.owner, repoRef?.repo, selectedFilePath, prDetail?.base_sha, prDetail?.head_sha],
    queryFn: async () => {
      if (!selectedFileMetadata || !prDetail) return null;
      const [headContent, baseContent] = await invoke<[string | null, string | null]>("cmd_get_file_contents", {
        owner: repoRef?.owner,
        repo: repoRef?.repo,
        filePath: selectedFilePath,
        baseSha: prDetail.base_sha,
        headSha: prDetail.head_sha,
        status: selectedFileMetadata.status,
        previousFilename: selectedFileMetadata.previous_filename ?? null,
      });
      return { headContent, baseContent };
    },
    enabled: Boolean(selectedFileMetadata && prDetail && repoRef),
    staleTime: Infinity, // File contents don't change for a given SHA
  });

  const selectedFile = useMemo(() => {
    if (!selectedFileMetadata) return null;
    if (!fileContentsQuery.data) return selectedFileMetadata;
    return {
      ...selectedFileMetadata,
      head_content: fileContentsQuery.data.headContent,
      base_content: fileContentsQuery.data.baseContent,
    };
  }, [selectedFileMetadata, fileContentsQuery.data]);

  const fileComments = useMemo(() => {
    let filtered = !selectedFilePath 
      ? reviewAwareComments 
      : reviewAwareComments.filter((comment) => comment.path === selectedFilePath);
    
    // Sort by line number (comments without line numbers go to the end)
    return filtered.sort((a, b) => {
      if (a.line === null && b.line === null) return 0;
      if (a.line === null) return 1;
      if (b.line === null) return -1;
      return (a.line ?? 0) - (b.line ?? 0);
    });
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
      setPrSearchFilter("");
      queryClient.removeQueries({ queryKey: ["pull-request"] });
    },
    [repoInput, repoRef, queryClient, refetchPulls],
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
      if (query.data) {
        query.data.forEach(pr => {
          const key = `${pr.owner}/${pr.repo}#${pr.number}`;
          if (!prMap.has(key)) {
            prMap.set(key, pr);
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
          let title = "";
          let totalCount = 0;
          
          if (cachedPrDetail) {
            title = cachedPrDetail.title;
            totalCount = cachedPrDetail.files.length;
          } else {
            // Check pulls query cache for this repo
            const cachedPulls = queryClient.getQueryData<PullRequestSummary[]>([
              "pull-requests",
              owner,
              repo,
              false, // showClosedPRs
            ]);
            const prSummary = cachedPulls?.find(p => p.number === number);
            if (prSummary) {
              title = prSummary.title;
            }
          }
          
          // Only add if we have a title (otherwise we can't show it properly)
          if (title) {
            prMap.set(prKey, {
              owner,
              repo,
              number,
              title,
              has_local_review: false,
              has_pending_review: false,
              viewed_count: 0,
              total_count: totalCount,
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
      // Start with values from pr (which may already have data from mruPrsQueries)
      let totalCount = pr.total_count;
      let title = pr.title;
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
        totalCount = cachedPrDetail.files.length;
        title = cachedPrDetail.title;
        // Check for pending reviews
        const myPendingReview = cachedPrDetail.reviews.find(
          r => r.is_mine && r.state === "PENDING"
        );
        hasPendingReview = !!myPendingReview;
      }
      
      const viewedCount = viewed.length;
      
      // Only show if it meets the criteria
      const showPr = 
        pr.has_local_review || 
        hasPendingReview || 
        (viewedCount > 0 && totalCount > 0 && viewedCount < totalCount);
      
      return showPr ? {
        ...pr,
        title,
        viewed_count: viewedCount,
        total_count: totalCount,
        has_pending_review: hasPendingReview,
      } : null;
    }).filter((pr): pr is PrUnderReview => pr !== null);
  }, [prsUnderReviewQuery.data, viewedFiles, queryClient, authQuery.data?.login, repoMRU, mruOpenPrsQueries, mruClosedPrsQueries]);

  // Prefetch PR details for PRs under review that don't have titles
  useEffect(() => {
    if (!authQuery.data?.login) return;
    
    enhancedPrsUnderReview.forEach(pr => {
      if (!pr.title || pr.title === "") {
        // Prefetch the PR detail to get the title
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
      setRepoMRU(prev => {
        const filtered = prev.filter(r => r !== repoString);
        const updated = [repoString, ...filtered].slice(0, 10);
        localStorage.setItem('repo-mru', JSON.stringify(updated));
        return updated;
      });
    }
  }, [pullsQuery.isSuccess, pullsQuery.isError, repoRef]);

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

  // Auto-navigate to pending review if no published comments
  useEffect(() => {
    if (pendingReview && !isInlineCommentOpen && !hasManuallyClosedCommentPanel) {
      // Check if there are any comments in the pending review (including local and GitHub pending)
      const pendingComments = reviewAwareComments.filter(c => c.review_id === pendingReview.id);
      const publishedComments = comments.filter(c => !c.is_draft && c.review_id !== pendingReview.id);
      
      if (pendingComments.length > 0 && publishedComments.length === 0) {
        setIsInlineCommentOpen(true);
      }
    }
  }, [pendingReview, reviewAwareComments, comments, isInlineCommentOpen, hasManuallyClosedCommentPanel]);

  // Persist viewed files state
  useEffect(() => {
    localStorage.setItem('viewed-files', JSON.stringify(viewedFiles));
  }, [viewedFiles]);

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
    // Set the repo
    const repoString = `${pr.owner}/${pr.repo}`;
    setRepoInput(repoString);
    setRepoRef({ owner: pr.owner, repo: pr.repo });
    
    // Select the PR
    setSelectedPr(pr.number);
    setSelectedFilePath(null);
    setIsPrCommentsView(false);
    setIsPrCommentComposerOpen(false);
    
    // Switch to repo mode to show file list
    setPrMode("repo");
  }, []);

  const toggleFileViewed = useCallback((filePath: string) => {
    if (!repoRef || !selectedPr) return;
    const prKey = `${repoRef.owner}/${repoRef.repo}#${selectedPr}`;
    setViewedFiles(prev => {
      const prViewed = prev[prKey] || [];
      const updated = prViewed.includes(filePath)
        ? prViewed.filter(f => f !== filePath)
        : [...prViewed, filePath];
      return { ...prev, [prKey]: updated };
    });
  }, [repoRef, selectedPr]);

  const isFileViewed = useCallback((filePath: string): boolean => {
    if (!repoRef || !selectedPr) return false;
    const prKey = `${repoRef.owner}/${repoRef.repo}#${selectedPr}`;
    return (viewedFiles[prKey] || []).includes(filePath);
  }, [repoRef, selectedPr, viewedFiles]);

  // Get comment count for a file
  const getFileCommentCount = useCallback((filePath: string): number => {
    return reviewAwareComments.filter(c => c.path === filePath).length;
  }, [reviewAwareComments]);

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
      if (isPrCommentComposerOpen) {
        setIsPrCommentComposerOpen(false);
      }
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

      // Check if there's a pending review from GitHub (not a local draft)
      // GitHub reviews will be in the reviews array from the server with PENDING state
      // Local reviews use PR number as ID and won't be in the server reviews array
      const isGithubPendingReview = pendingReview && 
        reviews.some(r => r.id === pendingReview.id && r.state === "PENDING" && r.is_mine);
      
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
    onSuccess: async () => {
      console.log("Delete comment success");
      setFileCommentDraft("");
      setFileCommentError(null);
      setEditingCommentId(null);
      setEditingComment(null);
      setIsFileCommentComposerVisible(false);
      
      // Reload appropriate data based on comment type
      if (editingComment?.url === "#" || !editingComment?.url) {
        // This was a local comment - reload local comments
        await loadLocalComments();
        
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

  const handleAddCommentClick = useCallback(() => {
    setEditingCommentId(null);
    setEditingComment(null);
    setIsSidebarCollapsed(false);
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

  const handleStartReviewWithComment = useCallback(async () => {
    // This is called when user has typed a comment and clicks "Start review"
    // We need to save the comment first, then start the review
    
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
      });

      console.log("Comment added successfully");

      // Clear the form
      setFileCommentDraft("");
      setFileCommentLine("");
      setFileCommentIsFileLevel(false);
      setFileCommentSide("RIGHT");

      // Reload local comments and show the review panel
      await loadLocalComments();
      
      // Show the review panel with the newly added comment
      setIsInlineCommentOpen(true);
      setIsFileCommentComposerVisible(false);
      
      // Create a local review object if needed
      if (prDetail) {
        const localReview: PullRequestReview = {
          id: prDetail.number,
          state: "PENDING",
          author: authQuery.data?.login ?? "You",
          submitted_at: null,
          body: null,
          html_url: null,
          commit_id: prDetail.head_sha,
          is_mine: true,
        };
        setPendingReviewOverride(localReview);
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
    console.log("Show review button clicked, pendingReviewFromServer:", pendingReviewFromServer, "localComments:", localComments.length);
    
    if (!repoRef || !prDetail) return;
    
    // Handle GitHub pending review
    if (pendingReviewFromServer) {
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
      let localReview = reviews.find(r => r.id === prDetail.number);
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
    }
    
    setIsInlineCommentOpen(true);
    setIsFileCommentComposerVisible(false);
    console.log("Panel state updated: isInlineCommentOpen=true");
  }, [pendingReviewFromServer, repoRef, prDetail, authQuery.data?.login, localComments, reviews]);

  const handleDeleteReviewClick = useCallback(() => {
    setShowDeleteReviewConfirm(true);
  }, []);

  const confirmDeleteReview = useCallback(async () => {
    if (!pendingReview || !repoRef || !prDetail) return;
    
    setShowDeleteReviewConfirm(false);
    
    // Check if this is a GitHub review (exists in server reviews array) or local review
    // Use same logic as submitReviewMutation for consistency
    const isGithubReview = reviews.some(r => r.id === pendingReview.id && r.state === "PENDING" && r.is_mine);
    
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
                          ref={fileCommentTextareaRef}
                          value={fileCommentDraft}
                          placeholder="Leave feedback on the selected file…"
                          onChange={(event) => {
                            setFileCommentDraft(event.target.value);
                            setFileCommentError(null);
                            setFileCommentSuccess(false);
                          }}
                          rows={6}
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
                            <div className="comment-panel__submit-actions">
                              {pendingReview?.html_url && (
                                <div className="comment-panel__info-note">
                                  Submit or delete the pending GitHub review to be able to add a comment to a new review.
                                </div>
                              )}
                              <button
                                type="submit"
                                className="comment-submit"
                                disabled={submitFileCommentMutation.isPending}
                                onClick={() => {
                                  setFileCommentMode("single");
                                }}
                              >
                                {submitFileCommentMutation.isPending ? "Sending…" : "Post comment"}
                              </button>
                              {effectiveFileCommentMode === "review" ? (
                                pendingReview ? (
                                  pendingReview.html_url ? null : (
                                    <button
                                      type="submit"
                                      className="comment-submit comment-submit--secondary"
                                      disabled={submitFileCommentMutation.isPending}
                                      onClick={() => {
                                        setFileCommentMode("review");
                                      }}
                                    >
                                      Add to review
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
                                      if (localComments.length > 0) {
                                        handleShowReviewClick();
                                      } else {
                                        handleStartReviewWithComment();
                                      }
                                    }}
                                  >
                                    {startReviewMutation.isPending ? "Starting…" : (localComments.length > 0 ? "Show review" : "Start review")}
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
                                    if (localComments.length > 0) {
                                      handleShowReviewClick();
                                    } else {
                                      handleStartReviewWithComment();
                                    }
                                  }}
                                >
                                  {startReviewMutation.isPending ? "Starting…" : (localComments.length > 0 ? "Show review" : "Start review")}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </form>
                    ) : (
                      <div className="comment-panel__existing">
                        {pendingReview && pendingReview.html_url && (
                          <button
                            type="button"
                            className="comment-panel__action-button comment-panel__action-button--subtle"
                            onClick={() => {
                              setIsInlineCommentOpen(false);
                            }}
                            style={{ marginBottom: '12px' }}
                          >
                            ← Back to comments
                          </button>
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
                            const isCollapsed = collapsedComments.has(comment.id);
                            const toggleCollapse = () => {
                              setCollapsedComments(prev => {
                                const next = new Set(prev);
                                if (next.has(comment.id)) {
                                  next.delete(comment.id);
                                } else {
                                  next.add(comment.id);
                                }
                                return next;
                              });
                            };
                            
                            return (
                              <li key={comment.id} className="comment-panel__item">
                                <div className="comment-panel__item-header" title={formattedTimestamp}>
                                  <div className="comment-panel__item-header-info">
                                    <span className="comment-panel__item-author">{comment.author}</span>
                                    {(comment.is_draft || isPendingGitHubReviewComment) && (
                                      <span className="comment-panel__item-badge">Pending</span>
                                    )}
                                  </div>
                                  <div className="comment-panel__item-actions">
                                    <button
                                      type="button"
                                      className="comment-panel__item-collapse"
                                      onClick={toggleCollapse}
                                      aria-label={isCollapsed ? "Expand comment" : "Collapse comment"}
                                      title={isCollapsed ? "Expand" : "Collapse"}
                                    >
                                      {isCollapsed ? "▼" : "▲"}
                                    </button>
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
                                  {comment.line && comment.line > 0 && (
                                    <span 
                                      className="comment-panel__item-line comment-panel__item-line--clickable"
                                      onClick={() => {
                                        if (editorRef.current && comment.line) {
                                          const editor = editorRef.current;
                                          const lineNumber = comment.line;
                                          
                                          // Reveal the line with some context
                                          editor.revealLineInCenter(lineNumber);
                                          
                                          // Set cursor position at the line
                                          editor.setPosition({ lineNumber, column: 1 });
                                          editor.focus();
                                        }
                                      }}
                                      title="Click to jump to line in editor"
                                    >
                                      #{comment.line}.
                                    </span>
                                  )}
                                  <div className={`comment-panel__item-content${isCollapsed ? " comment-panel__item-content--collapsed" : ""}`}>
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
                                      {comment.body}
                                    </ReactMarkdown>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                        <div className="comment-panel__actions">
                          {pendingReview?.html_url ? (
                            <div className="comment-panel__info-note">
                              Submit or delete the pending GitHub review to be able to add a new comment.
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="comment-panel__action-button"
                                onClick={handleAddCommentClick}
                                disabled={startReviewMutation.isPending}
                              >
                                Add comment
                              </button>
                              {!pendingReview && (pendingReviewFromServer || localComments.length > 0) && (
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
                  ) : pullDetailQuery.isLoading || (tocFileMetadata && tocContentQuery.isLoading) ? (
                    <div className="comment-panel__empty">Loading files…</div>
                  ) : (
                    <div className="comment-panel__empty">Select a file to leave feedback.</div>
                  )}
                </div>
                {pendingReview && (
                  <div className="pr-comments-view__footer">
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
                        <div className="repo-form__input-group">
                          <input
                            value={repoInput}
                            placeholder="docs/handbook"
                            onChange={(event) => setRepoInput(event.target.value)}
                          />
                          {repoMRU.filter(r => r !== formattedRepo).length > 0 && (
                            <div className="repo-form__dropdown-wrapper">
                              <button
                                type="button"
                                className={`repo-form__dropdown${showRepoMRU ? " repo-form__dropdown--open" : ""}`}
                                onClick={() => setShowRepoMRU(!showRepoMRU)}
                                aria-label="Recent repositories"
                              >
                                v
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
                      disabled={prMode === "under-review" ? !enhancedPrsUnderReview.length : !pullRequests.length}
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
                            enhancedPrsUnderReview.map((pr) => (
                              <button
                                key={`${pr.owner}/${pr.repo}/${pr.number}`}
                                type="button"
                                className={`pr-item pr-item--compact${
                                  selectedPr === pr.number && repoRef?.owner === pr.owner && repoRef?.repo === pr.repo
                                    ? " pr-item--active"
                                    : ""
                                }`}
                                onClick={() => handleSelectPrUnderReview(pr)}
                              >
                                <div className="pr-item__header">
                                  <span className="pr-item__title">#{pr.number} · {pr.title || "Loading..."}</span>
                                  <span 
                                    className="pr-item__file-count" 
                                    title={`${pr.viewed_count} files have been reviewed`}
                                  >
                                    {pr.viewed_count} / {pr.total_count || "?"}
                                  </span>
                                </div>
                                <span className="pr-item__repo">{pr.owner}/{pr.repo}</span>
                              </button>
                            ))
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
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="panel__body panel__body--flush">
                      {isPrCommentsView ? (
                        <div className="pr-comments-view">
                          {isPrCommentComposerOpen ? (
                            <div className="pr-comment-composer">
                              {prLevelComments.length > 0 && (
                                <div className="pr-comment-composer__header">
                                  <button
                                    type="button"
                                    className="comment-panel__action-button comment-panel__action-button--subtle"
                                    onClick={() => setIsPrCommentComposerOpen(false)}
                                  >
                                    ← Back to comments
                                  </button>
                                </div>
                              )}
                              <form className="comment-composer comment-composer--pr-pane" onSubmit={handleCommentSubmit}>
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
                                    {submitCommentMutation.isPending ? "Posting…" : "Post comment"}
                                  </button>
                                </div>
                              </form>
                            </div>
                          ) : (
                            <>
                              {prLevelComments.length === 0 ? (
                                <div className="empty-state empty-state--subtle">
                                  No PR comments yet.
                                </div>
                              ) : (
                                <div className="pr-comments-list">
                                  {prLevelComments.map((comment) => (
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
                                >
                                  Add PR Comment
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <>
                          {pullDetailQuery.isLoading || (tocFileMetadata && tocContentQuery.isLoading) ? (
                            <div className="empty-state empty-state--subtle">Loading files…</div>
                          ) : !prDetail ? (
                            <div className="empty-state empty-state--subtle">Select a pull request.</div>
                          ) : sortedFiles.length === 0 ? (
                            <div className="empty-state empty-state--subtle">
                              No Markdown or YAML files in this pull request.
                            </div>
                          ) : (
                          <>
                            <ul className="file-list file-list--compact">
                          {visibleFiles.map((file) => {
                            const displayName = formatFileLabel(file.path);
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
                                  {commentCount > 0 && (
                                    <span 
                                      className="file-list__badge"
                                      title={`${commentCount} comment${commentCount !== 1 ? 's' : ''}`}
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
                                  )}
                                </button>
                              </li>
                            );
                          })}
                            </ul>
                            {pendingReview && (
                              <div className="pr-comments-view__footer">
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
                              </div>
                            )}
                          </>
                          )}
                        </>
                      )}
                    </div>
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
            <div className={`pane pane--diff ${maximizedPane === 'source' ? 'pane--maximized' : (maximizedPane === 'preview' || maximizedPane === 'media') ? 'pane--hidden' : ''}`}>
              <div className="pane__header">
                <div className="pane__title-group">
                  <span>Source</span>
                  {selectedFilePath && (
                    <span className="pane__subtitle" title={selectedFilePath}>
                      {formatFilePathWithLeadingEllipsis(selectedFilePath)}
                    </span>
                  )}
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
                        }}
                        onMount={(editor) => {
                          editorRef.current = editor;
                          
                          // Scroll synchronization
                          editor.onDidScrollChange(() => {
                            if (isScrollingSyncRef.current) return;
                            if (!previewViewerRef.current) return;
                            
                            const visibleRange = editor.getVisibleRanges()[0];
                            if (!visibleRange) return;
                            const model = editor.getModel();
                            if (!model) return;
                            
                            const totalLines = model.getLineCount();
                            const topLine = visibleRange.startLineNumber;
                            const bottomLine = visibleRange.endLineNumber;
                            
                            // Calculate scroll percentage
                            let scrollPercentage = topLine / totalLines;
                            
                            // If editor is at bottom, ensure preview scrolls to bottom too
                            if (bottomLine >= totalLines) {
                              scrollPercentage = 1;
                            }
                            
                            const previewMaxScroll = previewViewerRef.current.scrollHeight - previewViewerRef.current.clientHeight;
                            const targetScroll = Math.min(scrollPercentage * previewMaxScroll, previewMaxScroll);
                            
                            isScrollingSyncRef.current = true;
                            previewViewerRef.current.scrollTop = targetScroll;
                            setTimeout(() => {
                              isScrollingSyncRef.current = false;
                            }, 50);
                          });

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
                            
                            if (lineNumber && isGlyphMargin) {
                              // Set the line and open directly to composer
                              setIsSidebarCollapsed(false);
                              setFileCommentLine(lineNumber.toString());
                              setFileCommentSide("RIGHT");
                              setFileCommentIsFileLevel(false);
                              setFileCommentDraft("");
                              setFileCommentError(null);
                              setFileCommentSuccess(false);
                              setIsFileCommentComposerVisible(true);
                              setIsInlineCommentOpen(true);
                            }
                          });
                        }}
                      />
                    )
                  ) : (
                    <div className="empty-state">
                      {prDetail ? "Pick a file to see its diff." : "Choose a pull request to begin."}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {!maximizedPane || maximizedPane === 'media' ? null : (
              <div
                className={`workspace__divider${isResizing ? " workspace__divider--active" : ""}`}
                onMouseDown={handleResizeStart}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize diff and preview panes"
              />
            )}

            <div className={`pane pane--preview ${maximizedPane === 'preview' ? 'pane--maximized' : (maximizedPane === 'source' || maximizedPane === 'media') ? 'pane--hidden' : ''}`}>
              <div className="pane__header">
                <div className="pane__title-group">
                  <span>Preview</span>
                </div>
                <div className="pane__actions">
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
                </div>
              </div>
              <div className="pane__content">
                <div className="pane__viewer">
                  {selectedFile ? (
                    selectedFile.language === "markdown" ? (
                      <div 
                        className="markdown-preview" 
                        ref={previewViewerRef as React.RefObject<HTMLDivElement>}
                        onScroll={(e) => {
                          if (isScrollingSyncRef.current) return;
                          if (!editorRef.current) return;
                          
                          const target = e.currentTarget;
                          const maxScroll = target.scrollHeight - target.clientHeight;
                          const scrollPercentage = maxScroll > 0 ? target.scrollTop / maxScroll : 0;
                          
                          const model = editorRef.current.getModel();
                          if (!model) return;
                          
                          const totalLines = model.getLineCount();
                          let targetLine = Math.floor(scrollPercentage * totalLines);
                          
                          // If preview is at bottom, scroll editor to bottom
                          if (target.scrollTop >= maxScroll - 1) {
                            targetLine = totalLines;
                          }
                          
                          targetLine = Math.max(1, Math.min(targetLine, totalLines));
                          
                          isScrollingSyncRef.current = true;
                          editorRef.current.revealLineInCenter(targetLine);
                          setTimeout(() => {
                            isScrollingSyncRef.current = false;
                          }, 50);
                        }}
                      >
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm, [remarkFrontmatter, { type: 'yaml', marker: '-' }]]}
                          rehypePlugins={[rehypeRaw, rehypeSanitize]}
                          components={{
                            code: ({ className, children, ...props }) => {
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
                                    style={{ cursor: 'pointer' }}
                                    title="Click to view fullscreen"
                                  >
                                    <MermaidCode>{mermaidContent}</MermaidCode>
                                  </div>
                                );
                              }
                              
                              return <code className={className} {...props}>{children}</code>;
                            },
                            a: ({href, children, ...props}) => {
                              // Handle link clicks
                              const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
                                e.preventDefault();
                                if (!href) return;
                                
                                // Check if it's an external URL
                                if (href.startsWith('http://') || href.startsWith('https://')) {
                                  // Open external links in browser
                                  void invoke('cmd_open_url', { url: href });
                                } else if (prDetail && selectedFile) {
                                  // Handle relative file paths within the PR
                                  let resolvedPath = href;
                                  
                                  // Remove anchor/hash from path
                                  const hashIndex = resolvedPath.indexOf('#');
                                  if (hashIndex !== -1) {
                                    resolvedPath = resolvedPath.substring(0, hashIndex);
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
                                  const targetFile = prDetail.files.find(f => f.path === resolvedPath);
                                  if (targetFile) {
                                    setSelectedFilePath(resolvedPath);
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
                              return <AsyncImage 
                                owner={repoRef.owner} 
                                repo={repoRef.repo} 
                                reference={prDetail.head_sha} 
                                path={resolvedPath} 
                                alt={alt} 
                                onClick={async () => {
                                  try {
                                    const base64Data = await invoke<string>("cmd_fetch_file_content", {
                                      owner: repoRef.owner,
                                      repo: repoRef.repo,
                                      reference: prDetail.head_sha,
                                      path: resolvedPath
                                    });
                                    const ext = resolvedPath.split('.').pop()?.toLowerCase();
                                    const mimeTypes: Record<string, string> = {
                                      'png': 'image/png',
                                      'jpg': 'image/jpeg',
                                      'jpeg': 'image/jpeg',
                                      'gif': 'image/gif',
                                      'svg': 'image/svg+xml',
                                      'webp': 'image/webp'
                                    };
                                    const mimeType = mimeTypes[ext || ''] || 'image/png';
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
                          {selectedFile.head_content ?? ""}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <pre 
                        className="markdown-preview" 
                        ref={previewViewerRef as React.RefObject<HTMLPreElement>}
                        onScroll={(e) => {
                          if (isScrollingSyncRef.current) return;
                          if (!editorRef.current) return;
                          
                          const target = e.currentTarget;
                          const maxScroll = target.scrollHeight - target.clientHeight;
                          const scrollPercentage = maxScroll > 0 ? target.scrollTop / maxScroll : 0;
                          
                          const model = editorRef.current.getModel();
                          if (!model) return;
                          
                          const totalLines = model.getLineCount();
                          let targetLine = Math.floor(scrollPercentage * totalLines);
                          
                          // If preview is at bottom, scroll editor to bottom
                          if (target.scrollTop >= maxScroll - 1) {
                            targetLine = totalLines;
                          }
                          
                          targetLine = Math.max(1, Math.min(targetLine, totalLines));
                          
                          isScrollingSyncRef.current = true;
                          editorRef.current.revealLineInCenter(targetLine);
                          setTimeout(() => {
                            isScrollingSyncRef.current = false;
                          }, 50);
                        }}
                      >
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

            {/* Media Viewer Pane */}
            {maximizedPane === 'media' && mediaViewerContent && (
              <div className="pane pane--media pane--maximized">
                <div className="pane__header">
                  <div className="pane__title-group">
                    <span>Media</span>
                  </div>
                  <div className="pane__actions">
                    <button
                      type="button"
                      className="panel__title-button"
                      onClick={() => {
                        setMaximizedPane(null);
                        setMediaViewerContent(null);
                      }}
                      aria-label="Close media viewer"
                      title="Close media viewer (ESC)"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="pane__content">
                  <div className="media-viewer">
                    {mediaViewerContent.type === 'image' ? (
                      <img 
                        src={mediaViewerContent.content} 
                        alt="Media content" 
                        className="media-viewer__image"
                      />
                    ) : (
                      <div className="media-viewer__mermaid-container">
                        <MermaidCode>{mediaViewerContent.content}</MermaidCode>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
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

      {showDeleteReviewConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteReviewConfirm(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete Review</h3>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete this pending review?</p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="modal-button modal-button--secondary"
                onClick={() => setShowDeleteReviewConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-button modal-button--danger"
                onClick={confirmDeleteReview}
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
