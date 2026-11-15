import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = process.cwd();

interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
}

interface GitHubSession {
  accessToken: string;
  user: GitHubUser;
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
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.aistudio',
]);

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
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[COOKIE_NAME];
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  return { sid, session };
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
    if (baseName === '.DS_Store' || baseName.endsWith('.log')) return true;
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

async function githubFetch(token: string, apiPath: string, init: RequestInit = {}) {
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
  return { ok: res.ok, status: res.status, data: json as Record<string, unknown> };
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // 1. GitHub OAuth status & configuration info
  app.get('/api/github/status', (_req: Request, res: Response) => {
    const auth = getSessionFromReq(_req);
    const baseUrl = getAppBaseUrl();
    res.json({
      oauthConfigured: isGitHubOAuthConfigured(),
      connected: Boolean(auth),
      user: auth?.session.user || null,
      callbackUrl: `${baseUrl}/auth/callback`,
    });
  });

  // 2. Build GitHub OAuth authorization URL (popup opens GitHub directly)
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
      scope: 'repo',
      state,
    });

    res.json({
      url: `https://github.com/login/oauth/authorize?${params.toString()}`,
      callbackUrl: redirectUri,
    });
  });

  // 3. GitHub OAuth callback route (works in popup and posts OAUTH_AUTH_SUCCESS to opener)
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

      const sid = crypto.randomBytes(24).toString('hex');
      sessions.set(sid, {
        accessToken: tokenJson.access_token,
        user: {
          login: String(userRes.data.login || ''),
          name: typeof userRes.data.name === 'string' ? userRes.data.name : null,
          avatar_url: String(userRes.data.avatar_url || ''),
          html_url: String(userRes.data.html_url || ''),
        },
        createdAt: Date.now(),
      });

      res.cookie(COOKIE_NAME, sid, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

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
        window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
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
      res.status(401).json({ error: 'Not connected to GitHub.' });
      return;
    }

    const r = await githubFetch(
      auth.session.accessToken,
      '/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator'
    );
    if (!r.ok) {
      res.status(r.status).json({ error: (r.data as { message?: string })?.message || 'Failed to load repositories.' });
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
        error: (created.data as { message?: string })?.message || 'Failed to create repository.',
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

  // 8. Push all workspace files as a clean commit via GitHub Git Data API
  app.post('/api/github/push', async (req: Request, res: Response) => {
    const auth = getSessionFromReq(req);
    if (!auth) {
      res.status(401).json({ error: 'Not connected to GitHub.' });
      return;
    }

    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
    const branch = (typeof req.body?.branch === 'string' ? req.body.branch.trim() : '') || 'main';
    const commitMessage =
      (typeof req.body?.message === 'string' ? req.body.message.trim() : '') ||
      'Push all project files from FaceMorph Studio';

    const parts = fullName.split('/');
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

      // Check existing branch ref (or handle empty repo bootstrap)
      let parentCommitSha: string | null = null;
      let refExists = false;

      const refCheck = await githubFetch(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
      if (refCheck.ok) {
        refExists = true;
        parentCommitSha = String((refCheck.data.object as { sha?: string })?.sha || '');
      } else if (refCheck.status === 409 || refCheck.status === 404) {
        // Check if repo itself is empty vs branch just doesn't exist yet
        const repoInfo = await githubFetch(token, `/repos/${owner}/${repo}`);
        if (!repoInfo.ok) {
          res.status(repoInfo.status).json({
            error: (repoInfo.data as { message?: string })?.message || 'Repository not found or access denied.',
          });
          return;
        }
        const defaultBranch = String(repoInfo.data.default_branch || 'main');
        const defaultRef = await githubFetch(
          token,
          `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`
        );

        if (defaultRef.ok) {
          parentCommitSha = String((defaultRef.data.object as { sha?: string })?.sha || '');
        } else {
          // Completely empty repo: seed initial commit cleanly using README.md via Contents API
          const readmeEntry = files.find((f) => f.relPath.toLowerCase() === 'readme.md') || files[0];
          const readmeBytes = await fs.readFile(readmeEntry.absPath);
          const seedRes = await githubFetch(
            token,
            `/repos/${owner}/${repo}/contents/${readmeEntry.relPath.split('/').map(encodeURIComponent).join('/')}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: 'Initialize repository',
                content: readmeBytes.toString('base64'),
                branch,
              }),
            }
          );
          if (!seedRes.ok) {
            res.status(seedRes.status).json({
              error: (seedRes.data as { message?: string })?.message || 'Failed to initialize empty repository.',
            });
            return;
          }
          parentCommitSha = String((seedRes.data.commit as { sha?: string })?.sha || '');
          refExists = true;
        }
      } else {
        res.status(refCheck.status).json({
          error: (refCheck.data as { message?: string })?.message || 'Failed to inspect target branch.',
        });
        return;
      }

      // Create Git blobs for all workspace files in parallel batches
      const treeEntries = await runInBatches(files, 8, async (file) => {
        const contentBuf = await fs.readFile(file.absPath);
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
            `Blob upload failed for ${file.relPath}: ${(blobRes.data as { message?: string })?.message || blobRes.status}`
          );
        }
        return {
          path: file.relPath,
          mode: file.mode,
          type: 'blob' as const,
          sha: String(blobRes.data.sha),
        };
      });

      // Create full repository tree
      const treeRes = await githubFetch(token, `/repos/${owner}/${repo}/git/trees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tree: treeEntries }),
      });
      if (!treeRes.ok || !treeRes.data.sha) {
        res.status(treeRes.status).json({
          error: (treeRes.data as { message?: string })?.message || 'Failed to create Git tree.',
        });
        return;
      }

      // Create commit
      const commitRes = await githubFetch(token, `/repos/${owner}/${repo}/git/commits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commitMessage,
          tree: String(treeRes.data.sha),
          parents: parentCommitSha ? [parentCommitSha] : [],
        }),
      });
      if (!commitRes.ok || !commitRes.data.sha) {
        res.status(commitRes.status).json({
          error: (commitRes.data as { message?: string })?.message || 'Failed to create Git commit.',
        });
        return;
      }
      const newCommitSha = String(commitRes.data.sha);

      // Update or create target branch ref
      const refUpdateRes = refExists
        ? await githubFetch(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
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
          error: (refUpdateRes.data as { message?: string })?.message || 'Failed to update branch reference.',
        });
        return;
      }

      res.json({
        ok: true,
        fileCount: files.length,
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
