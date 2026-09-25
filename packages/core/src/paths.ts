import { isAbsolute, join, resolve } from 'node:path';
import { env, envInt, REPO_ROOT } from './env.js';

/**
 * Where NecroReview writes everything it fetches or derives.
 *
 * Layout:
 *   <data>/
 *     raw/        review-comments.json, commits.json, pr-<n>.json, pr-<n>.diff
 *     personas/   ghost-<login>.json + manifest.json
 *     index/      fix-index.json
 *     fixtures/   bundled offline diff + PR metadata
 *     hall-of-fame.json
 */
export interface DataPaths {
  root: string;
  raw: string;
  personas: string;
  index: string;
  fixtures: string;
  hallOfFame: string;
  reviewComments: string;
  issueComments: string;
  commits: string;
  prMeta: string;
  personaManifest: string;
  fixIndex: string;
}

function resolveRoot(): string {
  const configured = env('NRR_DATA_DIR', './data');
  return isAbsolute(configured) ? configured : resolve(REPO_ROOT, configured);
}

/** Resolves every path the pipeline uses. Accepts an override for tests. */
export function dataPaths(rootOverride?: string): DataPaths {
  const root = rootOverride ?? resolveRoot();
  const raw = join(root, 'raw');
  const personas = join(root, 'personas');
  const index = join(root, 'index');
  const fixtures = join(root, 'fixtures');
  return {
    root,
    raw,
    personas,
    index,
    fixtures,
    hallOfFame: join(root, 'hall-of-fame.json'),
    reviewComments: join(raw, 'review-comments.json'),
    issueComments: join(raw, 'issue-comments.json'),
    commits: join(raw, 'commits.json'),
    prMeta: join(raw, 'pr-meta.json'),
    personaManifest: join(personas, 'manifest.json'),
    fixIndex: join(index, 'fix-index.json'),
  };
}

/** `owner/repo` under review, as configured. */
export function sourceRepo(): { owner: string; repo: string } {
  return {
    owner: env('NRR_OWNER', 'storybookjs'),
    repo: env('NRR_REPO', 'storybook'),
  };
}

/** How many top reviewers become ghosts. */
export function ghostCount(): number {
  return envInt('NRR_GHOST_COUNT', 4);
}

/** Pages of 100 review comments to pull, newest first. */
export function commentPages(): number {
  return envInt('NRR_COMMENT_PAGES', 25);
}

/** Pages of 100 commits to scan for fix patterns. */
export function commitPages(): number {
  return envInt('NRR_COMMIT_PAGES', 10);
}

/** Bridge port — the "stage". */
export function bridgePort(): number {
  return envInt('NRR_BRIDGE_PORT', 4001);
}

/** GitBot HQ base URL — the "backstage". */
export function gitbotUrl(): string {
  return env('GITBOT_URL', 'http://localhost:3000').replace(/\/+$/, '');
}

/** Agent harness live ghosts run on. */
export function agentHarness(): string {
  return env('NRR_AGENT', 'claude-code');
}

/** Working copy handed to live agents, or '' when none is configured. */
export function repoPath(): string {
  const configured = env('NRR_REPO_PATH', '');
  if (!configured) return '';
  return isAbsolute(configured) ? configured : resolve(REPO_ROOT, configured);
}

/** The PR the demo reviews. 0 means "use the bundled fixture diff". */
export function demoPr(): number {
  return envInt('NRR_DEMO_PR', 36417);
}

/** Avatar helper: DiceBear seeds produce a stable ghost per login. */
export function avatarUrl(seed: string): string {
  const base = env('NRR_AVATAR_BASE', 'https://api.dicebear.com/7.x/bottts/svg');
  return `${base}?seed=${encodeURIComponent(seed)}&backgroundColor=1a1a2e,16213e,0f3460`;
}
