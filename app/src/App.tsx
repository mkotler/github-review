import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DiffEditor } from "@monaco-editor/react";

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
    queryKey: ["pull-requests", repoRef?.owner, repoRef?.repo],
    queryFn: async () =>
      invoke<PullRequestSummary[]>("cmd_list_pull_requests", {
        owner: repoRef?.owner,
        repo: repoRef?.repo,
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
    queryFn: () =>
      invoke<PullRequestDetail>("cmd_get_pull_request", {
        owner: repoRef?.owner,
        repo: repoRef?.repo,
        number: selectedPr,
        current_login: authQuery.data?.login ?? null,
      }),
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

  const openInlineComment = useCallback(() => {
    if (!selectedFilePath) {
      return;
    }
    setIsInlineCommentOpen(true);
    setFileCommentError(null);
    setFileCommentSuccess(false);
    const hasExistingComments = myComments.some((comment) => comment.path === selectedFilePath);
    setIsFileCommentComposerVisible(!hasExistingComments);
  }, [myComments, selectedFilePath]);

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
      return [] as PullRequestComment[];
    }
    return comments.filter((comment) => comment.path === selectedFilePath);
  }, [comments, selectedFilePath]);

  const files = prDetail?.files ?? [];
  const hasAnyFileComments = fileComments.length > 0;
  const shouldShowFileCommentComposer = isFileCommentComposerVisible || !hasAnyFileComments;
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
    if (prDetail && prDetail.files.length > 0) {
      setSelectedFilePath((current) => current ?? prDetail.files[0].path);
    } else {
      setSelectedFilePath(null);
    }
  }, [prDetail]);

  useEffect(() => {
    if (commentSuccess) {
      const timeout = window.setTimeout(() => setCommentSuccess(false), 2400);
      return () => window.clearTimeout(timeout);
    }
  }, [commentSuccess]);

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
      mode,
      subjectType,
    }: {
      body: string;
      line: number | null;
      side: "RIGHT" | "LEFT";
      mode: "single" | "review";
      subjectType: "file" | null;
    }) => {
      if (!repoRef || !prDetail || !selectedFilePath) {
        throw new Error("Select a file before commenting.");
      }

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
        },
      });
    },
    onSuccess: () => {
      setFileCommentDraft("");
      setFileCommentLine("");
      setFileCommentError(null);
      setFileCommentSuccess(true);
      setFileCommentIsFileLevel(false);
      setFileCommentMode("single");
      setFileCommentSide("RIGHT");
      setIsFileCommentComposerVisible(false);
      void refetchPullDetail();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to submit comment.";
      setFileCommentError(message);
    },
  });

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
      if (!selectedFilePath) {
        setFileCommentError("Select a file before commenting.");
        return;
      }

      const trimmed = fileCommentDraft.trim();
      if (!trimmed) {
        setFileCommentError("Add your feedback before sending.");
        return;
      }

      if (fileCommentIsFileLevel && fileCommentMode === "review") {
        setFileCommentError("Select a line to start a review, or send this as a single comment.");
        return;
      }

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
        parsedLine = numericLine;
      }

      setFileCommentError(null);
      submitFileCommentMutation.mutate({
        body: trimmed,
        line: parsedLine,
        side: fileCommentSide,
        mode: fileCommentMode,
        subjectType: fileCommentIsFileLevel ? "file" : null,
      });
    },
    [
      fileCommentDraft,
      fileCommentIsFileLevel,
      fileCommentLine,
      fileCommentMode,
      fileCommentSide,
      selectedFilePath,
      submitFileCommentMutation,
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
                    aria-label="Hide comments"
                  >
                    ×
                  </button>
                </div>
                <div className="comment-panel__body">
                  {selectedFile ? (
                    shouldShowFileCommentComposer ? (
                      <form className="comment-panel__form" onSubmit={handleFileCommentSubmit}>
                        {hasAnyFileComments && (
                          <button
                            type="button"
                            className="comment-panel__action-button comment-panel__action-button--subtle"
                            onClick={() => setIsFileCommentComposerVisible(false)}
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
                        {!fileCommentIsFileLevel && (
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
                        <div className="comment-panel__row">
                          <label>
                            Mode
                            <select
                              value={fileCommentMode}
                              onChange={(event) => {
                                setFileCommentMode(event.target.value as "single" | "review");
                                setFileCommentError(null);
                                setFileCommentSuccess(false);
                              }}
                              disabled={fileCommentIsFileLevel}
                            >
                              <option value="single">Add single comment</option>
                              <option value="review">Start a review</option>
                            </select>
                          </label>
                        </div>
                        <div className="comment-panel__footer">
                          <div className="comment-panel__status">
                            {fileCommentError && (
                              <span className="comment-status comment-status--error">{fileCommentError}</span>
                            )}
                            {!fileCommentError && fileCommentSuccess && (
                              <span className="comment-status comment-status--success">Comment saved</span>
                            )}
                          </div>
                          <button
                            type="submit"
                            className="comment-submit"
                            disabled={submitFileCommentMutation.isPending}
                          >
                            {submitFileCommentMutation.isPending
                              ? "Sending…"
                              : fileCommentMode === "review"
                                ? "Start review"
                                : "Post comment"}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="comment-panel__existing">
                        <ul className="comment-panel__list">
                          {fileComments.map((comment) => (
                            <li key={comment.id} className="comment-panel__item">
                              <div className="comment-panel__item-meta">
                                <span className="comment-panel__item-author">{comment.author}</span>
                                {comment.line && (
                                  <span className="comment-panel__item-detail">L{comment.line}</span>
                                )}
                                <span className="comment-panel__item-detail">
                                  {new Date(comment.created_at).toLocaleString()}
                                </span>
                                {comment.is_draft && (
                                  <span className="comment-panel__item-badge">Pending</span>
                                )}
                              </div>
                              <div className="comment-panel__item-body">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {comment.body}
                                </ReactMarkdown>
                              </div>
                              <a
                                className="comment-panel__item-link"
                                href={comment.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open on GitHub
                              </a>
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="comment-panel__action-button"
                          onClick={() => setIsFileCommentComposerVisible(true)}
                        >
                          Add comment
                        </button>
                      </div>
                    )
                  ) : (
                    <div className="comment-panel__empty">Select a file to leave feedback.</div>
                  )}
                </div>
              </div>
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
                      <span className="panel__title-text">Open Pull Requests</span>
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
                    </div>
                  )}
                </div>

                <div className="panel panel--files">
                  <div className="panel__header panel__header--static">
                    <span>Files</span>
                  </div>
                  <div className="panel__body panel__body--flush">
                    {pullDetailQuery.isLoading ? (
                      <div className="empty-state empty-state--subtle">Loading files…</div>
                    ) : !prDetail ? (
                      <div className="empty-state empty-state--subtle">Select a pull request.</div>
                    ) : files.length === 0 ? (
                      <div className="empty-state empty-state--subtle">
                        No Markdown or YAML files in this pull request.
                      </div>
                    ) : (
                      <ul className="file-list file-list--compact">
                        {files.map((file) => (
                          <li key={file.path}>
                            <button
                              type="button"
                              className={`file-list__button${
                                selectedFilePath === file.path ? " file-list__button--active" : ""
                              }`}
                              onClick={() => setSelectedFilePath(file.path)}
                            >
                              <span className="file-list__name">{file.path}</span>
                              <span className="file-list__status">{file.status}</span>
                            </button>
                          </li>
                        ))}
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

          {myComments.length > 0 && (
            <div className="my-comments">
              <div className="my-comments__header">My Comments</div>
              <ul className="my-comments__list">
                {myComments.map((comment) => (
                  <li key={comment.id} className="my-comments__item">
                    <div className="my-comments__meta">
                      <span className="my-comments__type">
                        {comment.is_review_comment ? "Review" : "General"}
                      </span>
                      {comment.path && (
                        <span className="my-comments__location">
                          {comment.path}
                          {comment.line ? ` · L${comment.line}` : ""}
                        </span>
                      )}
                      <span className="my-comments__timestamp">
                        {new Date(comment.created_at).toLocaleString()}
                      </span>
                      {comment.is_draft && (
                        <span className="my-comments__badge">Pending</span>
                      )}
                    </div>
                    <div className="my-comments__body">{comment.body}</div>
                    <a
                      className="my-comments__link"
                      href={comment.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on GitHub
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
                        {isGeneralCommentOpen ? "Close overall comment" : "Overall PR comment"}
                      </button>
                      <button
                        type="button"
                        className="pane__action-button"
                        onClick={isInlineCommentOpen ? closeInlineComment : openInlineComment}
                      >
                        {isInlineCommentOpen ? "Hide Comments" : "Show Comments"}
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
    </div>
  );
}

export default App;
