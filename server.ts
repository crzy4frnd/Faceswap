import 'dotenv/config';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import type { Request, Response } from 'express';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = process.cwd();
const SESSIONS_FILE = '/tmp/facemorph_gh_sessions.json';

interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
}

interface GitHubSession {
  accessToken: string;
  user: GitHubUser;
  scopes: string[];
  hasScopeHeader: boolean;
  authType: 'oauth' | 'pat';
  createdAt: number;
}

interface WorkspaceFileEntry {
  relPath: string;
  absPath: string;
  size: number;
  mode: '100644' | '100755';
}

const sessions = new Map<string, GitHubSession>();
const pendingOAuthStates = new Map<string, { redirectUri: string; createdAt: number }>();

const COOKIE_NAME = 'fm_gh_sid';
const MAX_FILE_SIZE_BYTES = 18 * 1024 * 1024;
const IGNORED_DIRS = new Set([
  '.git',
  '.gradle',
  '.idea',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.aistudio',
]);

function loadPersistedSessions() {
  try {
    if (!fsSync.existsSync(SESSIONS_FILE)) return;
    const raw = fsSync.readFileSync(SESSIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, GitHubSession>;
    const now = Date.now();
    for (const [sid, sess] of Object.entries(parsed)) {
      if (sess?.accessToken && now - (sess.createdAt || 0) < 7 * 24 * 60 * 60 * 1000) {
        sessions.set(sid, sess);
      }
    }
  } catch {
    // ignore corrupt cache file
  }
}

function persistSessions() {
  try {
    const obj: Record<string, GitHubSession> = {};
    for (const [k, v] of sessions.entries()) {
      obj[k] = v;
    }
    fsSync.writeFileSync(SESSIONS_FILE, JSON.stringify(obj), { mode: 0o600 });
  } catch {
    // non-fatal
  }
}

loadPersistedSessions();

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function getSessionFromReq(req: Request): { sid: string; session: GitHubSession } | null {
  const headerSid =
    typeof req.headers['x-github-session'] === 'string'
      ? req.headers['x-github-session'].trim()
      : '';
  if (headerSid) {
    const sess = sessions.get(headerSid);
    if (sess) return { sid: headerSid, session: sess };
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookieSid = cookies[COOKIE_NAME];
  if (cookieSid) {
    const sess = sessions.get(cookieSid);
    if (sess) return { sid: cookieSid, session: sess };
  }

  return null;
}

function getAppBaseUrl(): string {
  const envUrl = (process.env.APP_URL || '').trim();
  if (envUrl && envUrl !== 'MY_APP_URL') {
    return envUrl.replace(/\/+$/, '');
  }
  return `http://localhost:${PORT}`;
}

function isGitHubOAuthConfigured(): boolean {
  const id = (process.env.GITHUB_CLIENT_ID || '').trim();
  const secret = (process.env.GITHUB_CLIENT_SECRET || '').trim();
  return Boolean(
    id &&
      secret &&
      id !== 'MY_GITHUB_CLIENT_ID' &&
      secret !== 'MY_GITHUB_CLIENT_SECRET'
  );
}

function shouldIgnoreRelPath(relPath: string, isDir: boolean): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const baseName = segments[segments.length - 1];

  if (segments.some((seg) => IGNORED_DIRS.has(seg))) return true;
  if (normalized === 'public/assets/aistudio' || normalized.startsWith('public/assets/aistudio/')) {
    return true;
  }
  if (!isDir) {
    if (baseName === '.DS_Store' || baseName.endsWith('.log') || baseName === 'local.properties') {
      return true;
    }
    if (baseName.startsWith('.env') && baseName !== '.env.example') return true;
  }
  return false;
}

async function collectWorkspaceFiles(dir = ROOT_DIR, prefix = ''): Promise<WorkspaceFileEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: WorkspaceFileEntry[] = [];

  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absPath = path.join(dir, entry.name);
    const isDir = entry.isDirectory();

    if (shouldIgnoreRelPath(relPath, isDir)) continue;

    if (isDir) {
      const nested = await collectWorkspaceFiles(absPath, relPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      const st = await fs.stat(absPath);
      if (st.size > MAX_FILE_SIZE_BYTES) continue;
      const isExec = Boolean(st.mode & 0o111) && (relPath.endsWith('gradlew') || relPath.endsWith('.sh'));
      results.push({
        relPath,
        absPath,
        size: st.size,
        mode: isExec ? '100755' : '100644',
      });
    }
  }

  results.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return results;
}

function computeGitBlobSha(buf: Buffer): string {
  const header = Buffer.from(`blob ${buf.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(header).update(buf).digest('hex');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeBranchPath(branch: string): string {
  return branch
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

function formatGitHubError(data: Record<string, unknown> | null, fallback: string): string {
  if (!data) return fallback;
  const msg = typeof data.message === 'string' && data.message ? data.message : fallback;
  const errors = Array.isArray(data.errors)
    ? data.errors
        .map((e) => {
          if (typeof e === 'string') return e;
          if (e && typeof e === 'object') {
            const obj = e as { message?: string; field?: string; code?: string };
            return obj.message || [obj.field, obj.code].filter(Boolean).join(': ');
          }
          return '';
        })
        .filter(Boolean)
    : [];
  const combined = errors.length > 0 ? `${msg} (${errors.join('; ')})` : msg;
  if (combined.toLowerCase().includes('workflow')) {
    return `${combined} — Token lacks 'workflow' permission required for .github/workflows/build-apk.yml. Click Sign Out, then sign in again (or use a PAT with repo + workflow scopes).`;
  }
  return combined;
}

async function githubFetch(
  token: string,
  apiPath: string,
  init: RequestInit = {},
  retries = 2
) {
  let attempt = 0;
  while (true) {
    const res = await fetch(`https://api.github.com${apiPath}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'FaceMorph-Studio-App',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.headers || {}),
      },
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { message: text };
    }

    const scopeHeader = res.headers.get('x-oauth-scopes');
    const isRetryable =
      res.status === 429 ||
      res.status === 502 ||
      res.status === 503 ||
      (res.status === 403 && text.toLowerCase().includes('secondary rate limit'));

    if (isRetryable && attempt < retries) {
      attempt++;
      const retryAfterSec = Number(res.headers.get('retry-after') || '0');
      const delayMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 1200 * attempt;
      await sleep(Math.min(delayMs, 8000));
      continue;
    }

    return {
      ok: res.ok,
      status: res.status,
      data: json as Record<string, unknown>,
      scopeHeader,
    };
  }
}

async function runInBatches<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;

  const runNext = async () => {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await worker(items[idx]);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

function parseScopes(scopeHeader: string | null): { scopes: string[]; hasScopeHeader: boolean } {
  if (scopeHeader === null) return { scopes: [], hasScopeHeader: false };
  const scopes = scopeHeader
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { scopes, hasScopeHeader: true };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // 1. GitHub OAuth & Session status
  app.get('/api/github/status', async (req: Request, res: Response) => {
    const auth = getSessionFromReq(req);
    const baseUrl = getAppBaseUrl();

    if (auth) {
      // Refresh scope check lazily if needed
      const missingWorkflowScope =
        auth.session.hasScopeHeader &&
        !auth.session.scopes.includes('workflow');

      res.json({
        oauthConfigured: isGitHubOAuthConfigured(),
        connected: true,
        sid: auth.sid,
        authType: auth.session.authType,
        missingWorkflowScope,
        user: auth.session.user,
        callbackUrl: `${baseUrl}/auth/callback`,
      });
      return;
    }

    res.json({
      oauthConfigured: isGitHubOAuthConfigured(),
      connected: false,
      sid: null,
      authType: null,
      missingWorkflowScope: false,
      user: null,
      callbackUrl: `${baseUrl}/auth/callback`,
    });
  });

  // 2. Build GitHub OAuth authorization URL (includes repo + workflow scopes for APK workflow)
  app.get('/api/github/auth/url', (_req: Request, res: Response) => {
    if (!isGitHubOAuthConfigured()) {
      res.status(400).json({
        error: 'GitHub OAuth credentials (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET) are not configured yet.',
      });
      return;
    }

    const now = Date.now();
    for (const [k, v] of pendingOAuthStates.entries()) {
      if (now - v.createdAt > 15 * 60 * 1000) pendingOAuthStates.delete(k);
    }

    const baseUrl = getAppBaseUrl();
    const redirectUri = `${baseUrl}/auth/callback`;
    const state = crypto.randomBytes(24).toString('hex');
    pendingOAuthStates.set(state, { redirectUri, createdAt: now });

    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID!.trim(),
      redirect_uri: redirectUri,
      scope: 'repo workflow',
      state,
    });

    res.json({
      url: `https://github.com/login/oauth/authorize?${params.toString()}`,
      callbackUrl: redirectUri,
    });
  });

  // 2b. Connect directly using a GitHub Personal Access Token (PAT fallback/alternative)
  app.post('/api/github/token', async (req: Request, res: Response) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      res.status(400).json({ error: 'GitHub token is required.' });
      return;
    }

    try {
      const userRes = await githubFetch(token, '/user');
      if (!userRes.ok) {
        res.status(401).json({
          error: formatGitHubError(userRes.data, 'Invalid or expired GitHub token.'),
        });
        return;
      }

      const { scopes, hasScopeHeader } = parseScopes(userRes.scopeHeader);
      const missingWorkflowScope = hasScopeHeader && !scopes.includes('workflow');

      const sid = crypto.randomBytes(24).toString('hex');
      const user: GitHubUser = {
        login: String(userRes.data.login || ''),
        name: typeof userRes.data.name === 'string' ? userRes.data.name : null,
        avatar_url: String(userRes.data.avatar_url || ''),
        html_url: String(userRes.data.html_url || ''),
      };

      sessions.set(sid, {
        accessToken: token,
        user,
        scopes,
        hasScopeHeader,
        authType: 'pat',
        createdAt: Date.now(),
      });
      persistSessions();

      res.cookie(COOKIE_NAME, sid, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.json({
        connected: true,
        sid,
        user,
        authType: 'pat',
        missingWorkflowScope,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to validate GitHub token.',
      });
    }
  });

  // 3. GitHub OAuth callback route (works in popup and posts OAUTH_AUTH_SUCCESS + sid to opener)
  const handleOAuthCallback = async (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const oauthErr = typeof req.query.error_description === 'string' ? req.query.error_description : '';

    if (oauthErr) {
      res.status(400).send(`<p>GitHub authorization declined: ${oauthErr}</p>`);
      return;
    }

    const stateRecord = pendingOAuthStates.get(state);
    if (!code || !state || !stateRecord) {
      res.status(400).send('<p>Invalid or expired OAuth state. Please close this window and try again.</p>');
      return;
    }
    pendingOAuthStates.delete(state);

    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID!.trim(),
          client_secret: process.env.GITHUB_CLIENT_SECRET!.trim(),
          code,
          redirect_uri: stateRecord.redirectUri,
        }),
      });

      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        scope?: string;
        error_description?: string;
        error?: string;
      };

      if (!tokenRes.ok || !tokenJson.access_token) {
        res
          .status(400)
          .send(`<p>GitHub token exchange failed: ${tokenJson.error_description || tokenJson.error || 'Unknown error'}</p>`);
        return;
      }

      const userRes = await githubFetch(tokenJson.access_token, '/user');
      if (!userRes.ok) {
        res.status(400).send('<p>Failed to fetch GitHub user profile.</p>');
        return;
      }

      const parsedHeader = parseScopes(userRes.scopeHeader ?? tokenJson.scope ?? null);
      const sid = crypto.randomBytes(24).toString('hex');
      sessions.set(sid, {
        accessToken: tokenJson.access_token,
        user: {
          login: String(userRes.data.login || ''),
          name: typeof userRes.data.name === 'string' ? userRes.data.name : null,
          avatar_url: String(userRes.data.avatar_url || ''),
          html_url: String(userRes.data.html_url || ''),
        },
        scopes: parsedHeader.scopes,
        hasScopeHeader: parsedHeader.hasScopeHeader,
        authType: 'oauth',
        createdAt: Date.now(),
      });
      persistSessions();

      res.cookie(COOKIE_NAME, sid, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      const payloadJson = JSON.stringify({ type: 'OAUTH_AUTH_SUCCESS', sid });

      res.send(`<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><title>GitHub Connected</title></head>
  <body style="font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
    <div style="text-align:center;padding:24px">
      <p style="font-size:16px;font-weight:600">GitHub connected successfully.</p>
      <p style="font-size:13px;color:#94a3b8">Returning to FaceMorph Studio...</p>
    </div>
    <script>
      if (window.opener) {
        window.opener.postMessage(${payloadJson}, '*');
        window.close();
      } else {
        window.location.href = '/';
      }
    </script>
  </body>
</html>`);
    } catch (err) {
      console.error('OAuth callback error:', err);
      res.status(500).send('<p>Unexpected server error during GitHub OAuth.</p>');
    }
  };

  app.get('/auth/callback', handleOAuthCallback);
  app.get('/auth/callback/', handleOAuthCallback);

  // 4. Logout GitHub session
  app.post('/api/github/logout', (req: Request, res: Response) => {
    const auth = getSessionFromReq(req);
    if (auth) {
      sessions.delete(auth.sid);
      persistSessions();
    }
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });
    res.json({ ok: true });
  });

  // 5. List user repositories
  app.get('/api/github/repos', async (req: Request, res: Response) => {
    const auth = getSessionFromReq(req);
    if (!auth) {
      res.status(401).json({ error: 'Not connected to GitHub. Please sign in or paste a token.' });
      return;
    }

    const r = await githubFetch(
      auth.session.accessToken,
      '/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator'
    );
    if (!r.ok) {
      res.status(r.status).json({ error: formatGitHubError(r.data, 'Failed to load repositories.') });
      return;
    }

    const repos = Array.isArray(r.data)
      ? r.data.map((repo: Record<string, unknown>) => ({
          id: repo.id,
          name: repo.name,
          full_name: repo.full_name,
          private: repo.private,
          default_branch: repo.default_branch || 'main',
          html_url: repo.html_url,
          owner: (repo.owner as { login?: string })?.login || auth.session.user.login,
        }))
      : [];

    res.json({ repos });
  });

  // 6. Create a new GitHub repository
  app.post('/api/github/repos', async (req: Request, res: Response) => {
    const auth = getSessionFromReq(req);
    if (!auth) {
      res.status(401).json({ error: 'Not connected to GitHub.' });
      return;
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const isPrivate = Boolean(req.body?.private);
    if (!name) {
      res.status(400).json({ error: 'Repository name is required.' });
      return;
    }

    const created = await githubFetch(auth.session.accessToken, '/user/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        private: isPrivate,
        auto_init: false,
      }),
    });

    if (!created.ok) {
      res.status(created.status).json({
        error: formatGitHubError(created.data, 'Failed to create repository.'),
      });
      return;
    }

    res.json({
      repo: {
        id: created.data.id,
        name: created.data.name,
        full_name: created.data.full_name,
        private: created.data.private,
        default_branch: created.data.default_branch || 'main',
        html_url: created.data.html_url,
        owner: (created.data.owner as { login?: string })?.login || auth.session.user.login,
      },
    });
  });

  // 7. Inspect workspace source files that will be pushed
  app.get('/api/github/workspace-files', async (_req: Request, res: Response) => {
    try {
      const files = await collectWorkspaceFiles();
      const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
      res.json({
        fileCount: files.length,
        totalBytes,
        files: files.map((f) => ({ path: f.relPath, size: f.size })),
      });
    } catch (err) {
      console.error('Failed to list workspace files:', err);
      res.status(500).json({ error: 'Failed to scan workspace files.' });
    }
  });

  async function pushViaGitCli(params: {
    token: string;
    user: GitHubUser;
    owner: string;
    repo: string;
    branch: string;
    commitMessage: string;
    files: WorkspaceFileEntry[];
  }): Promise<{ commitSha: string; fileCount: number }> {
    const { token, user, owner, repo, branch, commitMessage, files } = params;
    const tmpDir = path.join('/tmp', `fm_git_${crypto.randomBytes(8).toString('hex')}`);
    const remoteUrl = `https://github.com/${owner}/${repo}.git`;
    const basicAuth = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');

    const gitEnv: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basicAuth}`,
    };

    const runGit = async (args: string[], cwd = tmpDir) => {
      try {
        return await execFileAsync('git', args, {
          cwd,
          env: gitEnv,
          maxBuffer: 16 * 1024 * 1024,
        });
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        const raw = (e.stderr || e.message || 'git command failed').replaceAll(basicAuth, '[REDACTED]').replaceAll(token, '[REDACTED]');
        throw new Error(raw);
      }
    };

    try {
      await fs.mkdir(tmpDir, { recursive: true });

      let cloned = false;
      try {
        await runGit(['clone', '--depth', '1', '--branch', branch, '--single-branch', remoteUrl, '.']);
        cloned = true;
      } catch {
        try {
          await fs.rm(tmpDir, { recursive: true, force: true });
          await fs.mkdir(tmpDir, { recursive: true });
          await runGit(['clone', '--depth', '1', remoteUrl, '.']);
          await runGit(['checkout', '-B', branch]);
          cloned = true;
        } catch {
          cloned = false;
        }
      }

      if (!cloned) {
        await fs.rm(tmpDir, { recursive: true, force: true });
        await fs.mkdir(tmpDir, { recursive: true });
        await runGit(['init']);
        await runGit(['checkout', '-B', branch]);
        await runGit(['remote', 'add', 'origin', remoteUrl]);
      } else {
        // Clear existing tracked files before copying clean workspace snapshot
        const existingEntries = await fs.readdir(tmpDir);
        for (const entry of existingEntries) {
          if (entry === '.git') continue;
          await fs.rm(path.join(tmpDir, entry), { recursive: true, force: true });
        }
      }

      for (const file of files) {
        const dest = path.join(tmpDir, file.relPath);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(file.absPath, dest);
        if (file.mode === '100755') {
          await fs.chmod(dest, 0o755);
        }
      }

      await runGit(['config', 'user.name', user.name || user.login]);
      await runGit(['config', 'user.email', `${user.login}@users.noreply.github.com`]);
      await runGit(['add', '-A']);
      await runGit(['commit', '--allow-empty', '-m', commitMessage]);
      await runGit(['push', '-u', 'origin', `HEAD:refs/heads/${branch}`]);

      const { stdout } = await runGit(['rev-parse', 'HEAD']);
      return { commitSha: stdout.trim(), fileCount: files.length };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // 8. Push all workspace files cleanly via incremental Git Data API (with git CLI fallback)
  app.post('/api/github/push', async (req: Request, res: Response) => {
    const auth = getSessionFromReq(req);
    if (!auth) {
      res.status(401).json({ error: 'Not connected to GitHub. Please sign in or paste a token first.' });
      return;
    }

    const rawRepoInput = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
    const cleanedRepo = rawRepoInput
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');

    const branch = (typeof req.body?.branch === 'string' ? req.body.branch.trim() : '') || 'main';
    const commitMessage =
      (typeof req.body?.message === 'string' ? req.body.message.trim() : '') ||
      'Push all project files from FaceMorph Studio';

    const parts = cleanedRepo.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      res.status(400).json({ error: 'Valid repository (owner/repo) is required.' });
      return;
    }
    const [owner, repo] = parts;
    const token = auth.session.accessToken;

    try {
      const files = await collectWorkspaceFiles();
      if (files.length === 0) {
        res.status(400).json({ error: 'No workspace files found to push.' });
        return;
      }

      const hasWorkflowFile = files.some((f) => f.relPath.startsWith('.github/workflows/'));
      if (
        hasWorkflowFile &&
        auth.session.hasScopeHeader &&
        !auth.session.scopes.includes('workflow')
      ) {
        res.status(403).json({
          code: 'MISSING_WORKFLOW_SCOPE',
          error:
            "Your GitHub token is missing the 'workflow' permission needed to push .github/workflows/build-apk.yml. Click 'Re-authorize GitHub' or use a PAT with repo + workflow scopes.",
        });
        return;
      }

      const encodedBranch = encodeBranchPath(branch);

      // Check existing branch ref (or handle empty repo bootstrap)
      let parentCommitSha: string | null = null;
      let refExists = false;

      const refCheck = await githubFetch(token, `/repos/${owner}/${repo}/git/ref/heads/${encodedBranch}`);
      if (refCheck.ok) {
        refExists = true;
        parentCommitSha = String((refCheck.data.object as { sha?: string })?.sha || '');
      } else if (refCheck.status === 409 || refCheck.status === 404) {
        const repoInfo = await githubFetch(token, `/repos/${owner}/${repo}`);
        if (!repoInfo.ok) {
          res.status(repoInfo.status).json({
            error: formatGitHubError(repoInfo.data, 'Repository not found or access denied.'),
          });
          return;
        }
        const defaultBranch = String(repoInfo.data.default_branch || 'main');
        const defaultRef = await githubFetch(
          token,
          `/repos/${owner}/${repo}/git/ref/heads/${encodeBranchPath(defaultBranch)}`
        );

        if (defaultRef.ok) {
          parentCommitSha = String((defaultRef.data.object as { sha?: string })?.sha || '');
        } else {
          // Completely empty repo: seed initial commit cleanly using a non-workflow file
          const seedEntry =
            files.find((f) => f.relPath.toLowerCase() === 'readme.md') ||
            files.find((f) => !f.relPath.startsWith('.github/workflows/')) ||
            files[0];
          const seedBytes = await fs.readFile(seedEntry.absPath);
          const seedRes = await githubFetch(
            token,
            `/repos/${owner}/${repo}/contents/${seedEntry.relPath.split('/').map(encodeURIComponent).join('/')}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: 'Initialize repository',
                content: seedBytes.toString('base64'),
                branch,
              }),
            }
          );
          if (!seedRes.ok) {
            res.status(seedRes.status).json({
              error: formatGitHubError(seedRes.data, 'Failed to initialize empty repository.'),
            });
            return;
          }
          parentCommitSha = String((seedRes.data.commit as { sha?: string })?.sha || '');
          refExists = true;
        }
      } else {
        res.status(refCheck.status).json({
          error: formatGitHubError(refCheck.data, 'Failed to inspect target branch.'),
        });
        return;
      }

      // Inspect existing remote tree so we only upload & patch deltas
      let baseTreeSha: string | null = null;
      let remoteTruncated = true;
      const existingBlobShas = new Set<string>();
      const remoteFilesByPath = new Map<string, { sha: string; mode: string }>();

      if (parentCommitSha) {
        const parentCommitRes = await githubFetch(
          token,
          `/repos/${owner}/${repo}/git/commits/${parentCommitSha}`
        );
        const treeSha = (parentCommitRes.data?.tree as { sha?: string } | undefined)?.sha;
        if (parentCommitRes.ok && treeSha) {
          baseTreeSha = treeSha;
          const remoteTreeRes = await githubFetch(
            token,
            `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`
          );
          if (remoteTreeRes.ok) {
            remoteTruncated = Boolean(remoteTreeRes.data?.truncated);
            const remoteItems = Array.isArray(remoteTreeRes.data?.tree)
              ? (remoteTreeRes.data.tree as Array<{ path?: string; mode?: string; type?: string; sha?: string }>)
              : [];
            for (const item of remoteItems) {
              if (item.type === 'blob' && item.sha) {
                existingBlobShas.add(item.sha);
                if (item.path) {
                  remoteFilesByPath.set(item.path, {
                    sha: item.sha,
                    mode: item.mode || '100644',
                  });
                }
              }
            }
          }
        }
      }

      let uploadedCount = 0;
      let reusedCount = 0;

      // Compute SHAs locally and upload only missing blobs
      const preparedFiles = await runInBatches(files, 3, async (file) => {
        const contentBuf = await fs.readFile(file.absPath);
        const localSha = computeGitBlobSha(contentBuf);
        const remoteMatch = remoteFilesByPath.get(file.relPath);
        const isUnchangedAtPath =
          Boolean(remoteMatch) &&
          remoteMatch!.sha === localSha &&
          remoteMatch!.mode === file.mode;

        if (isUnchangedAtPath || existingBlobShas.has(localSha)) {
          reusedCount++;
          return {
            path: file.relPath,
            mode: file.mode,
            sha: localSha,
            unchangedAtPath: isUnchangedAtPath,
          };
        }

        const blobRes = await githubFetch(token, `/repos/${owner}/${repo}/git/blobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: contentBuf.toString('base64'),
            encoding: 'base64',
          }),
        });
        if (!blobRes.ok || !blobRes.data.sha) {
          throw new Error(
            `Blob upload failed for ${file.relPath}: ${formatGitHubError(blobRes.data, String(blobRes.status))}`
          );
        }
        uploadedCount++;
        return {
          path: file.relPath,
          mode: file.mode,
          sha: String(blobRes.data.sha),
          unchangedAtPath: false,
        };
      });

      type GitTreeEntryInput = {
        path: string;
        mode: '100644' | '100755';
        type: 'blob';
        sha: string | null;
      };

      const canUseDeltaTree = Boolean(baseTreeSha) && !remoteTruncated;
      const localPathSet = new Set(files.map((f) => f.relPath));

      let treeEntriesToApply: GitTreeEntryInput[] = [];
      let currentTreeSha: string | null = canUseDeltaTree ? baseTreeSha : null;

      if (canUseDeltaTree) {
        for (const item of preparedFiles) {
          if (!item.unchangedAtPath) {
            treeEntriesToApply.push({
              path: item.path,
              mode: item.mode,
              type: 'blob',
              sha: item.sha,
            });
          }
        }
        for (const remotePath of remoteFilesByPath.keys()) {
          if (!localPathSet.has(remotePath)) {
            treeEntriesToApply.push({
              path: remotePath,
              mode: '100644',
              type: 'blob',
              sha: null,
            });
          }
        }
      } else {
        treeEntriesToApply = preparedFiles.map((item) => ({
          path: item.path,
          mode: item.mode,
          type: 'blob' as const,
          sha: item.sha,
        }));
      }

      // Build tree incrementally in small chunks (20 items) so GitHub never times out
      const TREE_CHUNK_SIZE = 20;
      let usedGitCliFallback = false;

      if (treeEntriesToApply.length > 0) {
        for (let i = 0; i < treeEntriesToApply.length; i += TREE_CHUNK_SIZE) {
          const chunk = treeEntriesToApply.slice(i, i + TREE_CHUNK_SIZE);
          const payload: { tree: GitTreeEntryInput[]; base_tree?: string } = { tree: chunk };
          if (currentTreeSha) {
            payload.base_tree = currentTreeSha;
          }

          const treeRes = await githubFetch(token, `/repos/${owner}/${repo}/git/trees`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (!treeRes.ok || !treeRes.data.sha) {
            const errMsg = formatGitHubError(treeRes.data, 'Failed to create Git tree.');
            const isTimeoutOrLarge =
              treeRes.status >= 500 ||
              treeRes.status === 422 ||
              errMsg.toLowerCase().includes('timed out') ||
              errMsg.toLowerCase().includes('too large');

            if (isTimeoutOrLarge) {
              const cliRes = await pushViaGitCli({
                token,
                user: auth.session.user,
                owner,
                repo,
                branch,
                commitMessage,
                files,
              });
              usedGitCliFallback = true;
              res.json({
                ok: true,
                fileCount: cliRes.fileCount,
                uploadedCount,
                reusedCount,
                branch,
                commitSha: cliRes.commitSha,
                commitUrl: `https://github.com/${owner}/${repo}/commit/${cliRes.commitSha}`,
                repoUrl: `https://github.com/${owner}/${repo}`,
              });
              return;
            }

            res.status(treeRes.status).json({ error: errMsg });
            return;
          }
          currentTreeSha = String(treeRes.data.sha);
        }
      }

      if (usedGitCliFallback) return;

      if (!currentTreeSha) {
        res.status(500).json({ error: 'Unable to resolve target Git tree SHA.' });
        return;
      }

      // Create commit
      const commitRes = await githubFetch(token, `/repos/${owner}/${repo}/git/commits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commitMessage,
          tree: currentTreeSha,
          parents: parentCommitSha ? [parentCommitSha] : [],
        }),
      });
      if (!commitRes.ok || !commitRes.data.sha) {
        res.status(commitRes.status).json({
          error: formatGitHubError(commitRes.data, 'Failed to create Git commit.'),
        });
        return;
      }
      const newCommitSha = String(commitRes.data.sha);

      // Update or create target branch ref
      const refUpdateRes = refExists
        ? await githubFetch(token, `/repos/${owner}/${repo}/git/refs/heads/${encodedBranch}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sha: newCommitSha, force: true }),
          })
        : await githubFetch(token, `/repos/${owner}/${repo}/git/refs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ref: `refs/heads/${branch}`,
              sha: newCommitSha,
            }),
          });

      if (!refUpdateRes.ok) {
        res.status(refUpdateRes.status).json({
          error: formatGitHubError(refUpdateRes.data, 'Failed to update branch reference.'),
        });
        return;
      }

      res.json({
        ok: true,
        fileCount: files.length,
        uploadedCount,
        reusedCount,
        branch,
        commitSha: newCommitSha,
        commitUrl: `https://github.com/${owner}/${repo}/commit/${newCommitSha}`,
        repoUrl: `https://github.com/${owner}/${repo}`,
      });
    } catch (err) {
      console.error('GitHub push error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to push workspace files to GitHub.',
      });
    }
  });

  // 9. Mount Vite dev middlewares in development, or serve built dist/ in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
