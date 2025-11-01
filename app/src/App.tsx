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
};

const AUTH_QUERY_KEY = ["auth-status"] as const;

const openDevtoolsWindow = () => {
  void invoke("cmd_open_devtools").catch((error) => {
    console.warn("Failed to open devtools", error);
  });
};

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
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isResizing, setIsResizing] = useState(false);
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();

  const authQuery = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => invoke<AuthStatus>("cmd_check_auth_status"),
  });

  useEffect(() => {
    void invoke("cmd_log_frontend", {
      message: `auth-status:${authQuery.status}`,
    });
  }, [authQuery.status]);

  useEffect(() => {
    void invoke("cmd_log_frontend", { message: "App mounted" });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const html = document.body.innerHTML;
      void invoke("cmd_log_frontend", {
        message: `body-after:${html.slice(0, 200)}`,
      });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      void invoke("cmd_log_frontend", {
        message: `error:${event.message}`,
      });
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reasonMessage = event.reason instanceof Error ? event.reason.message : String(event.reason);
      void invoke("cmd_log_frontend", {
        message: `unhandledrejection:${reasonMessage}`,
      });
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  useEffect(() => {
    window.setTimeout(() => {
      const root = document.getElementById("root");
      const text = root?.textContent ?? "";
      const html = root?.innerHTML ?? "";
      void invoke("cmd_log_frontend", {
        message: `root-text:${text.slice(0, 160)}|root-html:${html.slice(0, 160)}`,
      });
    }, 400);
  }, [authQuery.status]);

  console.log("App render", {
    status: authQuery.status,
    hasData: Boolean(authQuery.data),
    isLoading: authQuery.isLoading,
    isError: authQuery.isError,
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

  const openInlineComment = useCallback(() => {
    if (!selectedFilePath) {
      return;
    }
    setIsInlineCommentOpen(true);
    setFileCommentError(null);
    setFileCommentSuccess(false);
  }, [selectedFilePath]);

  const closeInlineComment = useCallback(() => {
    setIsInlineCommentOpen(false);
    setFileCommentError(null);
    setFileCommentSuccess(false);
  }, []);

  const prDetail = pullDetailQuery.data;
  const pullsErrorMessage = pullsQuery.isError
    ? pullsQuery.error instanceof Error
      ? pullsQuery.error.message
      : "Failed to load pull requests."
    : null;

  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

  const selectedFile = useMemo(() => {
    if (!prDetail || !selectedFilePath) return null;
    return prDetail.files.find((file) => file.path === selectedFilePath) ?? null;
  }, [prDetail, selectedFilePath]);

  const files = prDetail?.files ?? [];
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
  }, [prDetail?.number]);

  useEffect(() => {
    setFileCommentLine("");
    setFileCommentError(null);
    setFileCommentSuccess(false);
    setFileCommentIsFileLevel(false);
    setFileCommentMode("single");
    setFileCommentSide("RIGHT");
    setIsInlineCommentOpen(false);
  }, [selectedFilePath]);

  useEffect(() => {
    if (!fileCommentSuccess) {
      return;
    }
    const closeTimer = window.setTimeout(() => {
      setIsInlineCommentOpen(false);
    }, 1500);
    const resetTimer = window.setTimeout(() => {
      setFileCommentSuccess(false);
    }, 2400);
    return () => {
      window.clearTimeout(closeTimer);
      window.clearTimeout(resetTimer);
    };
  }, [fileCommentSuccess]);

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
    if (!isResizing) {
      return;
    }
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing]);

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

  return (
    <div className={`app-shell${isSidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}`}>
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
            <div className="user-chip">
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
            </div>
          )}
        </div>
        {!isSidebarCollapsed && (
          <div className="sidebar__content">
            <div
              className={`panel panel--collapsible${
                isRepoPanelCollapsed && repoRef ? " panel--collapsed" : ""
              }`}
            >
              <div className="panel__header">
                <button
                  type="button"
                  className="panel__title-button"
                  onClick={handleToggleRepoPanel}
                  aria-expanded={repoPanelExpanded}
                >
                  <span>Repository</span>
                  {repoRef && (
                    <span className="panel__toggle-icon">
                      {isRepoPanelCollapsed ? ">" : "v"}
                    </span>
                  )}
                </button>
                {repoRef && (
                  <button
                    type="button"
                    className="panel__icon-button"
                    onClick={handleRefreshPulls}
                    title="Refresh pull requests"
                  >
                      Refresh
                  </button>
                )}
              </div>
              {(!isRepoPanelCollapsed || !repoRef) && (
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
              {isRepoPanelCollapsed && repoRef && (
                <div className="panel__collapsed-body">
                  <span className="panel__summary">{formattedRepo}</span>
                </div>
              )}
            </div>

            <div
              className={`panel panel--collapsible panel--pulls${
                isPrPanelCollapsed && selectedPr ? " panel--collapsed" : ""
              }`}
            >
              <div className="panel__header">
                <button
                  type="button"
                  className="panel__title-button"
                  onClick={handleTogglePrPanel}
                  disabled={!pullRequests.length}
                  aria-expanded={prPanelExpanded}
                >
                  <span>Open Pull Requests</span>
                  {selectedPr && (
                    <span className="panel__toggle-icon">
                      {isPrPanelCollapsed ? ">" : "v"}
                    </span>
                  )}
                </button>
              </div>
              {(!isPrPanelCollapsed || !selectedPr) && (
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
              {isPrPanelCollapsed && selectedPr && (
                <div className="panel__collapsed-body">
                  {selectedPrSummary ? (
                    <span className="panel__summary">
                      #{selectedPrSummary.number} · {selectedPrSummary.title}
                    </span>
                  ) : (
                    <span className="panel__summary">Pull request #{selectedPr}</span>
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
          </div>
        )}
        <div className="sidebar__footer">
          {import.meta.env.DEV && (
            <button
              type="button"
              className="sidebar__button"
              onClick={openDevtoolsWindow}
              title="Open developer tools"
            >
              <span className="sidebar__button-icon">D</span>
              <span className="sidebar__button-label">Devtools</span>
            </button>
          )}
          <button
            type="button"
            className="sidebar__button"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            title="Sign out of GitHub"
          >
            <span className="sidebar__button-icon">L</span>
            <span className="sidebar__button-label">
              {logoutMutation.isPending ? "Signing out..." : "Logout"}
            </span>
          </button>
        </div>
      </aside>

      <section className="content-area">
        <div className="workspace">
          <header className="workspace__header">
            {prDetail ? (
              <>
                <span className="workspace__title">
                  #{prDetail.number} · {prDetail.title}
                </span>
                <span className="workspace__meta">Authored by {prDetail.author}</span>
              </>
            ) : (
              <span className="workspace__title">Choose a pull request to begin</span>
            )}
          </header>

          {prDetail && (
            <form className="comment-composer" onSubmit={handleCommentSubmit}>
              <label className="comment-composer__label" htmlFor="comment-draft">
                General feedback
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
                  {!commentError && commentSuccess && (
                    <span className="comment-status comment-status--success">Comment published</span>
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

          {prDetail && prDetail.my_comments.length > 0 && (
            <div className="my-comments">
              <div className="my-comments__header">My Comments</div>
              <ul className="my-comments__list">
                {prDetail.my_comments.map((comment) => (
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
                  {selectedFile && (
                    <button
                      type="button"
                      className="pane__action-button"
                      onClick={isInlineCommentOpen ? closeInlineComment : openInlineComment}
                    >
                      {isInlineCommentOpen ? "Close comment" : "Add comment"}
                    </button>
                  )}
                </div>
              </div>
              <div className="pane__content">
                {isInlineCommentOpen && selectedFile && (
                  <div className="inline-comment-overlay">
                    <div className="inline-comment-overlay__header">
                      <span>Leave feedback</span>
                      <button
                        type="button"
                        className="inline-comment-overlay__close"
                        onClick={closeInlineComment}
                        aria-label="Close inline comment composer"
                      >
                        X
                      </button>
                    </div>
                    <form className="inline-comment-overlay__form" onSubmit={handleFileCommentSubmit}>
                      <textarea
                        value={fileCommentDraft}
                        placeholder="Leave feedback on the selected file…"
                        onChange={(event) => {
                          setFileCommentDraft(event.target.value);
                          setFileCommentError(null);
                          setFileCommentSuccess(false);
                        }}
                        rows={4}
                      />
                      <label className="inline-comment-overlay__checkbox">
                        <input
                          type="checkbox"
                          checked={fileCommentIsFileLevel}
                          onChange={(event) => {
                            setFileCommentIsFileLevel(event.target.checked);
                            if (event.target.checked) {
                              setFileCommentLine("");
                              setFileCommentMode("single");
                            }
                            setFileCommentError(null);
                            setFileCommentSuccess(false);
                          }}
                        />
                        Comment on entire file
                      </label>
                      {!fileCommentIsFileLevel && (
                        <div className="inline-comment-overlay__row">
                          <label>
                            Line
                            <input
                              type="number"
                              min={1}
                              value={fileCommentLine}
                              onChange={(event) => {
                                setFileCommentLine(event.target.value);
                                setFileCommentError(null);
                                setFileCommentSuccess(false);
                              }}
                            />
                          </label>
                          <label>
                            Side
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
                      <div className="inline-comment-overlay__row">
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
                      <div className="inline-comment-overlay__footer">
                        <div className="inline-comment-overlay__status">
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
                  </div>
                )}
                {selectedFile ? (
                  <DiffEditor
                    original={selectedFile.base_content ?? ""}
                    modified={selectedFile.head_content ?? ""}
                    language={selectedFile.language === "yaml" ? "yaml" : "markdown"}
                    options={{
                      readOnly: true,
                      renderSideBySide: true,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                    }}
                  />
                ) : (
                  <div className="empty-state">Pick a file to see its diff.</div>
                )}
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
                  <div className="empty-state">Preview appears once a file is selected.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default App;
