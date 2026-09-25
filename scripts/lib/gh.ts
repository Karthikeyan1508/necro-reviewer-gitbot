import { execFileSync } from 'node:child_process';

/**
 * A thin wrapper over the `gh` CLI.
 *
 * We shell out to `gh` rather than holding a token ourselves: the developer is
 * already logged in, the credentials stay in the OS keyring, and there is no
 * secret to leak into a config file. Every call here is read-only.
 */

export interface GhError extends Error {
  status?: number;
}

/** Runs `gh` and returns stdout as text. */
export function ghText(args: string[]): string {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/** Runs `gh api <path>` and parses the JSON response. */
export function ghJson<T>(path: string, params: Record<string, string | number> = {}): T {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
  const url = query ? `${path}?${query}` : path;
  const raw = ghText(['api', url]);
  return JSON.parse(raw) as T;
}

/** True when a `gh` binary is on PATH. */
export function ghAvailable(): boolean {
  try {
    ghText(['--version']);
    return true;
  } catch {
    return false;
  }
}

export interface GhAuth {
  authenticated: boolean;
  login: string | null;
  scopes: string[];
}

/** Who `gh` is signed in as, and with which scopes. */
export function ghAuth(): GhAuth {
  try {
    const raw = ghText(['auth', 'status', '--json', 'hosts']).trim();
    const parsed = JSON.parse(raw) as {
      hosts?: Record<string, Array<{ login?: string; scopes?: string; state?: string }>>;
    };
    const host = parsed.hosts?.['github.com']?.[0];
    return {
      authenticated: host?.state === 'success' || Boolean(host?.login),
      login: host?.login ?? null,
      scopes: (host?.scopes ?? '').split(',').map((scope) => scope.trim()).filter(Boolean),
    };
  } catch {
    return { authenticated: false, login: null, scopes: [] };
  }
}

export interface RateLimit {
  remaining: number;
  limit: number;
  resetAt: string;
}

/** Remaining REST quota, so a long fetch can stop before it hits the wall. */
export function ghRateLimit(): RateLimit | null {
  try {
    const parsed = ghJson<{ resources: { core: { remaining: number; limit: number; reset: number } } }>(
      'rate_limit',
    );
    const core = parsed.resources.core;
    return {
      remaining: core.remaining,
      limit: core.limit,
      resetAt: new Date(core.reset * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

/** Fetches a page of results, tolerating the last (possibly empty) page. */
export function ghPage<T>(path: string, params: Record<string, string | number>): T[] {
  const result = ghJson<T[]>(path, params);
  return Array.isArray(result) ? result : [];
}

/** A short, human line for the console. */
export function log(scope: string, message: string): void {
  console.log(`[${scope}] ${message}`);
}

export function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}
