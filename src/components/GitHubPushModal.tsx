import React, { useEffect, useState, useCallback } from 'react';
import {
  X,
  GitBranch,
  UploadCloud,
  Check,
  Plus,
  ExternalLink,
  RefreshCw,
  LogOut,
  AlertCircle,
  Copy,
  FolderGit2,
  Lock,
  Globe,
} from 'lucide-react';
import { useFaceStudio } from '../context/FaceStudioContext';

interface GitHubUserInfo {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
}

interface GitHubRepoInfo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  owner: string;
}

interface PushResultInfo {
  fileCount: number;
  branch: string;
  commitSha: string;
  commitUrl: string;
  repoUrl: string;
}

export const GitHubPushModal: React.FC = () => {
  const { showGitHubModal, setShowGitHubModal } = useFaceStudio();

  const [loadingStatus, setLoadingStatus] = useState(false);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [user, setUser] = useState<GitHubUserInfo | null>(null);
  const [callbackUrl, setCallbackUrl] = useState('');

  const [repos, setRepos] = useState<GitHubRepoInfo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selectedRepoFullName, setSelectedRepoFullName] = useState('');
  const [branch, setBranch] = useState('main');
  const [commitMessage, setCommitMessage] = useState('Push all project files from FaceMorph Studio');

  const [fileSummary, setFileSummary] = useState<{ fileCount: number; totalBytes: number } | null>(null);

  const [showCreateRepo, setShowCreateRepo] = useState(false);
  const [newRepoName, setNewRepoName] = useState('facemorph-studio');
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [creatingRepo, setCreatingRepo] = useState(false);

  const [isPushing, setIsPushing] = useState(false);
  const [pushResult, setPushResult] = useState<PushResultInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCallback, setCopiedCallback] = useState(false);

  const loadRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const res = await fetch('/api/github/repos', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { repos: GitHubRepoInfo[] };
      setRepos(data.repos || []);
      if (data.repos?.length && !selectedRepoFullName) {
        setSelectedRepoFullName(data.repos[0].full_name);
        setBranch(data.repos[0].default_branch || 'main');
      }
    } catch {
      // handled in UI if user clicks refresh
    } finally {
      setLoadingRepos(false);
    }
  }, [selectedRepoFullName]);

  const loadStatusAndFiles = useCallback(async () => {
    setLoadingStatus(true);
    setErrorMsg(null);
    try {
      const [statusRes, filesRes] = await Promise.all([
        fetch('/api/github/status', { credentials: 'include' }),
        fetch('/api/github/workspace-files'),
      ]);

      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as {
          oauthConfigured: boolean;
          connected: boolean;
          user: GitHubUserInfo | null;
          callbackUrl: string;
        };
        setOauthConfigured(statusData.oauthConfigured);
        setConnected(statusData.connected);
        setUser(statusData.user);
        setCallbackUrl(statusData.callbackUrl || `${window.location.origin}/auth/callback`);
        if (statusData.connected) {
          await loadRepos();
        }
      }

      if (filesRes.ok) {
        const filesData = (await filesRes.json()) as { fileCount: number; totalBytes: number };
        setFileSummary({ fileCount: filesData.fileCount, totalBytes: filesData.totalBytes });
      }
    } catch {
      setErrorMsg('Unable to reach local workspace server.');
    } finally {
      setLoadingStatus(false);
    }
  }, [loadRepos]);

  useEffect(() => {
    if (!showGitHubModal) return;
    loadStatusAndFiles();
  }, [showGitHubModal, loadStatusAndFiles]);

  // Listen for OAuth popup completion
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setPushResult(null);
        setErrorMsg(null);
        loadStatusAndFiles();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [loadStatusAndFiles]);

  if (!showGitHubModal) return null;

  const handleConnectGitHub = async () => {
    setErrorMsg(null);
    try {
      const res = await fetch('/api/github/auth/url', { credentials: 'include' });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setErrorMsg(data.error || 'GitHub OAuth is not configured yet.');
        return;
      }

      const authWindow = window.open(
        data.url,
        'github_oauth_popup',
        'width=620,height=740,noopener=false'
      );
      if (!authWindow) {
        setErrorMsg('Popup was blocked by your browser. Please allow popups and try again.');
      }
    } catch {
      setErrorMsg('Failed to start GitHub OAuth flow.');
    }
  };

  const handleDisconnect = async () => {
    await fetch('/api/github/logout', { method: 'POST', credentials: 'include' });
    setConnected(false);
    setUser(null);
    setRepos([]);
    setSelectedRepoFullName('');
    setPushResult(null);
  };

  const handleCreateRepo = async () => {
    if (!newRepoName.trim()) return;
    setCreatingRepo(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/github/repos', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRepoName.trim(), private: newRepoPrivate }),
      });
      const data = (await res.json()) as { repo?: GitHubRepoInfo; error?: string };
      if (!res.ok || !data.repo) {
        setErrorMsg(data.error || 'Failed to create repository.');
        return;
      }
      setRepos((prev) => [data.repo!, ...prev]);
      setSelectedRepoFullName(data.repo.full_name);
      setBranch(data.repo.default_branch || 'main');
      setShowCreateRepo(false);
    } catch {
      setErrorMsg('Network error creating repository.');
    } finally {
      setCreatingRepo(false);
    }
  };

  const handlePushAllFiles = async () => {
    if (!selectedRepoFullName) {
      setErrorMsg('Select or create a GitHub repository first.');
      return;
    }
    setIsPushing(true);
    setErrorMsg(null);
    setPushResult(null);

    try {
      const res = await fetch('/api/github/push', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: selectedRepoFullName,
          branch: branch.trim() || 'main',
          message: commitMessage.trim() || 'Push all project files from FaceMorph Studio',
        }),
      });
      const data = (await res.json()) as PushResultInfo & { error?: string };
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to push files to GitHub.');
        return;
      }
      setPushResult(data);
    } catch {
      setErrorMsg('Network error while pushing workspace files to GitHub.');
    } finally {
      setIsPushing(false);
    }
  };

  const handleCopyCallback = () => {
    const val = callbackUrl || `${window.location.origin}/auth/callback`;
    navigator.clipboard?.writeText(val).then(() => {
      setCopiedCallback(true);
      setTimeout(() => setCopiedCallback(false), 1800);
    });
  };

  const formattedSizeMb = fileSummary
    ? `${(fileSummary.totalBytes / (1024 * 1024)).toFixed(2)} MB`
    : '--';

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-slate-900 dark:bg-slate-800 border border-slate-700 flex items-center justify-center text-white">
              <FolderGit2 className="w-4.5 h-4.5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Push All Files to GitHub
              </h3>
              <span className="text-[11px] text-slate-500">
                {fileSummary
                  ? `${fileSummary.fileCount} source files (${formattedSizeMb}) ready`
                  : 'Scanning workspace files...'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowGitHubModal(false)}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Success Result */}
        {pushResult && (
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-300 text-xs font-bold">
              <Check className="w-4 h-4" />
              <span>
                Pushed {pushResult.fileCount} files to {selectedRepoFullName} ({pushResult.branch})
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href={pushResult.commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold"
              >
                <span>View Commit ({pushResult.commitSha.slice(0, 7)})</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <a
                href={pushResult.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold hover:bg-emerald-500/10"
              >
                <span>Open Repository</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}

        {/* Loading */}
        {loadingStatus ? (
          <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-400">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Checking GitHub connection...</span>
          </div>
        ) : !connected ? (
          <div className="space-y-3">
            {oauthConfigured ? (
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 text-center space-y-3">
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Connect your GitHub account via OAuth to select or create a repository and push all project files in one click.
                </p>
                <button
                  type="button"
                  onClick={handleConnectGitHub}
                  className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md transition-colors"
                >
                  <GitBranch className="w-4 h-4" />
                  <span>Sign in with GitHub</span>
                </button>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-2.5 text-xs">
                <p className="font-semibold text-amber-700 dark:text-amber-300">
                  GitHub OAuth Setup Required
                </p>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  Add <code className="font-mono px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-800">GITHUB_CLIENT_ID</code> and{' '}
                  <code className="font-mono px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-800">GITHUB_CLIENT_SECRET</code> in AI Studio Secrets, using this callback URL in your GitHub OAuth App:
                </p>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value={callbackUrl || `${window.location.origin}/auth/callback`}
                    className="flex-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300"
                  />
                  <button
                    type="button"
                    onClick={handleCopyCallback}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-medium flex items-center gap-1 shrink-0"
                  >
                    {copiedCallback ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCallback ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Connected User Bar */}
            {user && (
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={user.avatar_url}
                    alt={user.login}
                    className="w-7 h-7 rounded-full border border-slate-300 dark:border-slate-700"
                  />
                  <div className="min-w-0">
                    <span className="block text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                      {user.name || user.login}
                    </span>
                    <span className="block text-[10px] text-emerald-500 font-mono">
                      @{user.login} · Connected
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="px-2 py-1 rounded-lg text-[11px] text-slate-500 hover:text-rose-500 flex items-center gap-1"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}

            {/* Repository Selection */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span>Target Repository</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={loadRepos}
                    disabled={loadingRepos}
                    className="text-[11px] text-slate-500 hover:text-indigo-400 flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingRepos ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreateRepo((p) => !p)}
                    className="text-[11px] text-indigo-500 hover:text-indigo-400 flex items-center gap-0.5 font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Repo</span>
                  </button>
                </div>
              </div>

              {showCreateRepo ? (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                  <input
                    type="text"
                    value={newRepoName}
                    onChange={(e) => setNewRepoName(e.target.value)}
                    placeholder="Repository name (e.g. facemorph-studio)"
                    className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setNewRepoPrivate(true)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 border ${
                          newRepoPrivate
                            ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500'
                            : 'border-slate-300 dark:border-slate-700 text-slate-500'
                        }`}
                      >
                        <Lock className="w-3 h-3" />
                        <span>Private</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewRepoPrivate(false)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 border ${
                          !newRepoPrivate
                            ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500'
                            : 'border-slate-300 dark:border-slate-700 text-slate-500'
                        }`}
                      >
                        <Globe className="w-3 h-3" />
                        <span>Public</span>
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleCreateRepo}
                      disabled={creatingRepo || !newRepoName.trim()}
                      className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-semibold"
                    >
                      {creatingRepo ? 'Creating...' : 'Create'}
                    </button>
                  </div>
                </div>
              ) : (
                <select
                  value={selectedRepoFullName}
                  onChange={(e) => {
                    const full = e.target.value;
                    setSelectedRepoFullName(full);
                    const found = repos.find((r) => r.full_name === full);
                    if (found?.default_branch) setBranch(found.default_branch);
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100"
                >
                  {repos.length === 0 ? (
                    <option value="">No repositories found — click + New Repo</option>
                  ) : (
                    repos.map((r) => (
                      <option key={r.id} value={r.full_name}>
                        {r.full_name} {r.private ? '(Private)' : '(Public)'}
                      </option>
                    ))
                  )}
                </select>
              )}
            </div>

            {/* Branch & Commit Message */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Branch
                </label>
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Commit Message
                </label>
                <input
                  type="text"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <p className="text-[10px] text-slate-400">
              Includes all app source files, Android Gradle wrapper, and GitHub APK workflow (automatically ignores <code className="font-mono">node_modules/</code>, <code className="font-mono">dist/</code>, and <code className="font-mono">.env</code>).
            </p>

            {/* Primary Push CTA */}
            <button
              type="button"
              onClick={handlePushAllFiles}
              disabled={isPushing || !selectedRepoFullName}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md transition-colors"
            >
              {isPushing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Uploading {fileSummary?.fileCount || ''} files to GitHub...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>Push All Files to GitHub</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
