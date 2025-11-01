import { useCallback, useEffect, useMemo, useState } from "react";
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
};

type RepoRef = {
  owner: string;
  repo: string;
};

const AUTH_QUERY_KEY = ["auth-status"] as const;

function App() {
  const [repoRef, setRepoRef] = useState<RepoRef | null>(null);
  const [repoInput, setRepoInput] = useState("");
  const [repoError, setRepoError] = useState<string | null>(null);
  const [selectedPr, setSelectedPr] = useState<number | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
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
    queryFn: () =>
      invoke<PullRequestSummary[]>("cmd_list_pull_requests", {
        owner: repoRef?.owner,
        repo: repoRef?.repo,
      }),
    enabled: Boolean(repoRef && authQuery.data?.is_authenticated),
  });

  const pullDetailQuery = useQuery({
    queryKey: [
      "pull-request",
      repoRef?.owner,
      repoRef?.repo,
      selectedPr,
    ],
    queryFn: () =>
      invoke<PullRequestDetail>("cmd_get_pull_request", {
        owner: repoRef?.owner,
        repo: repoRef?.repo,
        number: selectedPr,
      }),
    enabled:
      Boolean(repoRef && selectedPr && authQuery.data?.is_authenticated),
  });

  const prDetail = pullDetailQuery.data;

  const selectedFile = useMemo(() => {
    if (!prDetail || !selectedFilePath) return null;
    return prDetail.files.find((file) => file.path === selectedFilePath) ?? null;
  }, [prDetail, selectedFilePath]);

  const handleRepoSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = repoInput.trim();
      const match = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed);
      if (!match) {
        setRepoError("Use the format owner/repo");
        return;
      }
      setRepoError(null);
      setRepoRef({ owner: match[1], repo: match[2] });
      setSelectedPr(null);
      setSelectedFilePath(null);
      queryClient.removeQueries({ queryKey: ["pull-request"] });
    },
    [repoInput, queryClient],
  );

  const handleLogin = useCallback(async () => {
    await loginMutation.mutateAsync();
  }, [loginMutation]);

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

  useEffect(() => {
    if (prDetail && prDetail.files.length > 0) {
      setSelectedFilePath((current) => current ?? prDetail.files[0].path);
    } else {
      setSelectedFilePath(null);
    }
  }, [prDetail]);

  const files = prDetail?.files ?? [];
  const formattedRepo = repoRef ? `${repoRef.owner}/${repoRef.repo}` : "";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__header">
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
          <button
            type="button"
            className="logout-button"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
          >
            Logout
          </button>
        </div>

        <div className="panel">
          <h2>Select Repository</h2>
          <form className="repo-form" onSubmit={handleRepoSubmit}>
            <input
              value={repoInput}
              placeholder="docs/handbook"
              onChange={(event) => setRepoInput(event.target.value)}
            />
            <button type="submit" disabled={pullsQuery.isFetching}>
              {pullsQuery.isFetching ? "Loading" : "Load"}
            </button>
          </form>
          {repoError && <span className="repo-error">{repoError}</span>}
          {formattedRepo && (
            <span className="chip-label repo-indicator">Viewing {formattedRepo}</span>
          )}
        </div>

        <div className="panel panel--stretch">
          <h2>Open Pull Requests</h2>
          <div className="pr-list">
            {pullsQuery.isLoading || pullsQuery.isFetching ? (
              <div className="empty-state empty-state--tall">
                Loading pull requests…
              </div>
            ) : pullRequests.length === 0 ? (
              <div className="empty-state empty-state--tall">
                {repoRef
                  ? "No Markdown or YAML pull requests found."
                  : "Enter a repository to begin."}
              </div>
            ) : (
              pullRequests.map((pr) => (
                <button
                  key={pr.number}
                  type="button"
                  className={`pr-item${selectedPr === pr.number ? " pr-item--active" : ""}`}
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
        </div>
      </aside>

      <section className="content-area">
        <div className="file-nav">
          <span className="file-nav__title">Files</span>
          <div className="file-list">
            {pullDetailQuery.isLoading ? (
              <div className="empty-state">Loading files…</div>
            ) : files.length ? (
              files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={`file-item${selectedFilePath === file.path ? " file-item--active" : ""}`}
                  onClick={() => setSelectedFilePath(file.path)}
                >
                  <span>{file.path}</span>
                  <span className="file-item__badge">{file.status}</span>
                </button>
              ))
            ) : (
              <div className="empty-state">Select a pull request to view files.</div>
            )}
          </div>
        </div>

        <div className="workspace">
          <header className="workspace__header">
            {prDetail ? (
              <>
                <span className="workspace__title">
                  #{prDetail.number} · {prDetail.title}
                </span>
                <span className="workspace__meta">
                  Authored by {prDetail.author}
                </span>
              </>
            ) : (
              <span className="workspace__title">Choose a pull request to begin</span>
            )}
          </header>

          <div className="workspace__body">
            <div className="pane">
              <div className="pane__header">Diff</div>
              <div className="pane__content">
                {selectedFile ? (
                  <DiffEditor
                    original={selectedFile!.base_content ?? ""}
                    modified={selectedFile!.head_content ?? ""}
                    language={selectedFile!.language === "yaml" ? "yaml" : "markdown"}
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

            <div className="pane">
              <div className="pane__header">Preview</div>
              <div className="pane__content">
                {selectedFile ? (
                  selectedFile!.language === "markdown" ? (
                    <div className="markdown-preview">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {selectedFile!.head_content ?? ""}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <pre className="markdown-preview">
                      <code>{selectedFile!.head_content ?? ""}</code>
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
