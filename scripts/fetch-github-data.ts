/**
 * Step 1 of the pipeline: pull the review culture out of the source repo.
 *
 * Everything here goes through the `gh` CLI — the developer's own login, no
 * stored token. The fetches are bounded on purpose:
 *
 *   review comments   NRR_COMMENT_PAGES pages of 100, newest first
 *   commits           NRR_COMMIT_PAGES pages of 100, newest first
 *   fix commit files  the newest NRR_COMMIT_FILES commits that look like fixes
 *   PR metadata+diff  the demo PR only
 *   PR conversation   NRR_ISSUE_PAGES pages of 100, for the séance corpus
 *
 * Usage:
 *   npm run data
 *   npm run data -- --comments=40 --commits=20 --pr=32464
 *   npm run data -- --no-commit-files      # message-only index, much faster
 */
import { DataStore, demoPr, envInt, isFixCommit, loadEnv, sourceRepo } from '@necroreview/core';
import type { CommitRecord, PullRequestMeta, ReviewComment } from '@necroreview/core';
import { fail, ghAuth, ghAvailable, ghJson, ghPage, ghRateLimit, ghText, log } from './lib/gh.js';

loadEnv();

const OWNERLESS = sourceRepo();
const SCOPE = 'fetch';

/** The first line of an error message, for one-line progress logs. */
function firstLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split('\n')[0] ?? message;
}

interface Argv {
  commentPages: number;
  commitPages: number;
  issuePages: number;
  commitFileLimit: number;
  prNumber: number;
  fetchCommitFiles: boolean;
}

function parseArgs(): Argv {
  const args = process.argv.slice(2);
  const valueOf = (name: string): string | undefined => {
    const hit = args.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const numberOr = (name: string, fallback: number): number => {
    const raw = valueOf(name);
    if (raw === undefined) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    commentPages: numberOr('comments', envInt('NRR_COMMENT_PAGES', 25)),
    commitPages: numberOr('commits', envInt('NRR_COMMIT_PAGES', 10)),
    issuePages: numberOr('issue-pages', envInt('NRR_ISSUE_PAGES', 3)),
    commitFileLimit: numberOr('commit-files', envInt('NRR_COMMIT_FILES', 150)),
    prNumber: numberOr('pr', demoPr()),
    fetchCommitFiles: !args.includes('--no-commit-files'),
  };
}

/** Minimal shapes of the GitHub payloads we read. */
interface RawReviewComment {
  id: number;
  pull_request_url?: string;
  html_url?: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  body?: string;
  created_at?: string;
  user?: { login?: string };
}

interface RawCommit {
  sha: string;
  html_url?: string;
  commit?: { message?: string; author?: { date?: string; name?: string } };
  author?: { login?: string } | null;
}

interface RawCommitDetail {
  files?: Array<{ filename?: string }>;
}

interface RawIssueComment {
  id: number;
  html_url?: string;
  body?: string;
  created_at?: string;
  user?: { login?: string };
}

interface RawPull {
  number: number;
  title?: string;
  body?: string;
  html_url?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  user?: { login?: string };
  base?: { ref?: string };
  head?: { ref?: string };
}

/** `/repos/o/r/pulls/1234` -> 1234 */
function prNumberFromUrl(url: string | undefined): number {
  if (!url) return 0;
  const match = url.match(/\/pulls\/(\d+)/);
  return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}

/** Walks page by page until the pages run out or the budget is spent. */
function collectPages<T>(
  label: string,
  path: string,
  pages: number,
  params: Record<string, string | number> = {},
): T[] {
  const out: T[] = [];
  for (let page = 1; page <= pages; page += 1) {
    const rows = ghPage<T>(path, { per_page: 100, page, ...params });
    out.push(...rows);
    process.stdout.write(`\r   ${label}: ${out.length} rows (page ${page}/${pages})`);
    if (rows.length < 100) break;
  }
  process.stdout.write('\n');
  return out;
}

async function main(): Promise<void> {
  const argv = parseArgs();
  const store = new DataStore();
  const { owner, repo } = OWNERLESS;
  const slug = `${owner}/${repo}`;

  if (!ghAvailable()) {
    fail(
      'the GitHub CLI (`gh`) is not on PATH.\n' +
        '  Install it from https://cli.github.com and run `gh auth login`,\n' +
        '  or skip this step: the bundled personas and fixture diff let the demo run offline.',
    );
  }
  const auth = ghAuth();
  if (!auth.authenticated) {
    fail('`gh` is not authenticated. Run `gh auth login` and try again.');
  }
  log(SCOPE, `signed in as ${auth.login} (scopes: ${auth.scopes.join(', ') || 'none reported'})`);
  log(SCOPE, `source repo: ${slug}`);
  if (!auth.scopes.includes('repo')) {
    log(SCOPE, 'warning: the token has no `repo` scope; private or org data will not be readable');
  }

  const rate = ghRateLimit();
  if (rate) log(SCOPE, `rate limit: ${rate.remaining}/${rate.limit} core requests left`);
  if (rate && rate.remaining < 50) {
    fail(
      `only ${rate.remaining} requests left, resetting at ${rate.resetAt}.\n` +
        '  Wait for the reset, or lower --comments / --commits.',
    );
  }

  // --- 1. Inline review comments: the reviewer's actual voice. ---
  // Newest first: a reviewer's recent tone is the one worth resurrecting.
  const rawComments = collectPages<RawReviewComment>(
    'review comments',
    `/repos/${slug}/pulls/comments`,
    argv.commentPages,
    { sort: 'created', direction: 'desc' },
  );
  const comments: ReviewComment[] = rawComments
    .map((row) => ({
      id: row.id,
      prNumber: prNumberFromUrl(row.pull_request_url ?? row.html_url),
      prUrl: row.pull_request_url ?? '',
      path: row.path ?? '',
      line: row.line ?? row.original_line ?? null,
      user: row.user?.login ?? '',
      body: row.body ?? '',
      createdAt: row.created_at ?? '',
    }))
    .filter((row) => row.user && row.body.trim());
  store.saveRawReviewComments(comments);
  log(SCOPE, `wrote ${comments.length} review comments -> ${store.paths.reviewComments}`);

  // --- 2. Commits: the raw material for the fix index. ---
  const rawCommits = collectPages<RawCommit>('commits', `/repos/${slug}/commits`, argv.commitPages);
  const commits: CommitRecord[] = rawCommits.map((row) => {
    const message = row.commit?.message ?? '';
    const [subject, ...rest] = message.split('\n');
    return {
      sha: row.sha,
      shortSha: row.sha.slice(0, 7),
      date: row.commit?.author?.date ?? '',
      author: row.author?.login ?? row.commit?.author?.name ?? '',
      message: (subject ?? '').trim(),
      body: rest.join('\n').trim(),
      files: [],
      url: row.html_url ?? `https://github.com/${slug}/commit/${row.sha}`,
    };
  });
  log(SCOPE, `collected ${commits.length} commits`);

  // --- 3. File lists for the commits that look like fixes. ---
  // One request per commit, so this is capped: the newest N fixes only.
  if (argv.fetchCommitFiles && argv.commitFileLimit > 0) {
    const fixCandidates = commits.filter((commit) => isFixCommit(commit.message)).slice(0, argv.commitFileLimit);
    log(SCOPE, `fetching file lists for ${fixCandidates.length} fix commits…`);
    let enriched = 0;
    for (const commit of fixCandidates) {
      try {
        const detail = ghJson<RawCommitDetail>(`/repos/${slug}/commits/${commit.sha}`);
        commit.files = (detail.files ?? []).map((file) => file.filename ?? '').filter(Boolean);
        enriched += 1;
      } catch (err) {
        log(SCOPE, `could not read ${commit.shortSha} (${firstLine(err)}) — continuing`);
      }
      if (enriched > 0 && enriched % 25 === 0) {
        process.stdout.write(`\r   enriched ${enriched}/${fixCandidates.length}`);
      }
    }
    process.stdout.write(`\r   enriched ${enriched}/${fixCandidates.length} fix commits\n`);
  } else {
    log(SCOPE, 'skipping fix-commit file lists; the index will match on messages alone');
  }

  store.saveRawCommits(commits);
  log(SCOPE, `wrote ${commits.length} commits -> ${store.paths.commits}`);

  // --- 4. PR conversation: context for the séance. ---
  if (argv.issuePages > 0) {
    const rawIssue = collectPages<RawIssueComment>(
      'issue comments',
      `/repos/${slug}/issues/comments`,
      argv.issuePages,
      { sort: 'created', direction: 'desc' },
    );
    const issueComments = rawIssue
      .map((row) => ({
        id: row.id,
        user: row.user?.login ?? '',
        body: row.body ?? '',
        createdAt: row.created_at ?? '',
      }))
      .filter((row) => row.user && row.body.trim().length > 40);
    store.saveRawIssueComments(issueComments);
    log(SCOPE, `wrote ${issueComments.length} conversation comments -> ${store.paths.issueComments}`);
  }

  // --- 5. The demo PR itself. ---
  if (argv.prNumber > 0) {
    try {
      const pull = ghJson<RawPull>(`/repos/${slug}/pulls/${argv.prNumber}`);
      const meta: PullRequestMeta = {
        number: pull.number,
        title: pull.title ?? '',
        author: pull.user?.login ?? '',
        url: pull.html_url ?? `https://github.com/${slug}/pull/${argv.prNumber}`,
        baseRef: pull.base?.ref ?? 'main',
        headRef: pull.head?.ref ?? 'unknown',
        body: (pull.body ?? '').slice(0, 4000),
        additions: pull.additions ?? 0,
        deletions: pull.deletions ?? 0,
        changedFiles: pull.changed_files ?? 0,
        source: 'github',
      };
      const diff = ghText(['pr', 'diff', String(argv.prNumber), '--repo', slug]);
      store.saveDiffFile(argv.prNumber, diff);
      store.savePullRequests([meta]);
      log(SCOPE, `PR #${meta.number} "${meta.title}" (+${meta.additions}/-${meta.deletions}, ${meta.changedFiles} files)`);
      log(SCOPE, `wrote diff (${diff.split('\n').length} lines) for PR #${argv.prNumber}`);
    } catch (err) {
      log(SCOPE, `could not fetch PR #${argv.prNumber} (${firstLine(err)})`);
      log(SCOPE, 'the bundled fixture diff will be used instead — the demo still runs');
    }
  }

  const after = ghRateLimit();
  if (after) log(SCOPE, `rate limit now: ${after.remaining}/${after.limit} core requests left`);
  log(SCOPE, 'done. Next: npm run personas');
}

main().catch((err: unknown) => {
  fail(`unexpected error: ${(err as Error).stack ?? String(err)}`);
});
