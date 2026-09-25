import type { CommitRecord, ReviewComment } from '../src/types.js';

/**
 * Shared fixtures. The diff is a small, realistic React change that trips a
 * specific set of rules, so the tests can assert which ghost notices what.
 */

/** Trips: unguarded-network, unguarded-then, effect-no-deps, effect-no-cleanup,
 *  explicit-any, console-debris, missing-test, missing-changelog. */
export const RISKY_DIFF = `diff --git a/src/useArgs.ts b/src/useArgs.ts
index 1111111..2222222 100644
--- a/src/useArgs.ts
+++ b/src/useArgs.ts
@@ -1,6 +1,14 @@
 import { useEffect, useState } from 'react';
 
 export function useArgs(initial: number) {
   const [value, setValue] = useState(initial);
+  useEffect(() => {
+    fetch('/api/args').then((res) => res.json()).then(setValue);
+  });
+  const payload: any = window.__ARGS__;
+  console.log('args payload', payload);
   return [value, setValue] as const;
 }
`;

/** Trips: removed-export (pr scope) and nothing else that blocks. */
export const REMOVAL_DIFF = `diff --git a/src/index.ts b/src/index.ts
index aaaaaaa..bbbbbbb 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,4 @@
-export const legacyApi = () => 'old';
 export const newApi = () => 'new';
`;

/** A careful change: tests, docs, a changeset and a handled request. */
export const CAREFUL_DIFF = `diff --git a/src/loader.ts b/src/loader.ts
index ccccccc..ddddddd 100644
--- a/src/loader.ts
+++ b/src/loader.ts
@@ -1,4 +1,14 @@
 export async function load(): Promise<string> {
-  return 'stale';
+  try {
+    const res = await fetch('/api/load');
+    return await res.text();
+  } catch (error) {
+    // A failed load is not fatal; the caller shows the cached value.
+    return 'cached';
+  }
 }
`;

/** A created helper module with no test anywhere in the diff. */
export const HELPER_DIFF = `diff --git a/src/helpers/parse.ts b/src/helpers/parse.ts
new file mode 100644
index 0000000..eeeeeee
--- /dev/null
+++ b/src/helpers/parse.ts
@@ -0,0 +1,4 @@
+export const parse = (raw: string): number => Number.parseInt(raw, 10);
`;

export const COMMITS: CommitRecord[] = [
  {
    sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    shortSha: 'abc1234',
    date: '2025-08-14T10:12:00Z',
    author: 'kasper',
    message: 'fix: avoid infinite render loop in useArgs',
    body: 'The effect had no dependency array, so it re-ran on every render.',
    files: ['src/useArgs.ts'],
    url: 'https://github.com/storybookjs/storybook/commit/abc1234',
  },
  {
    sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    shortSha: 'def5678',
    date: '2025-09-02T08:00:00Z',
    author: 'yann',
    message: 'fix: guard args fetch when the network hangs',
    body: 'A rejected fetch left the loader stuck forever.',
    files: ['src/useArgs.ts', 'src/loader.ts'],
    url: 'https://github.com/storybookjs/storybook/commit/def5678',
  },
  {
    sha: 'cccccccccccccccccccccccccccccccccccccccc',
    shortSha: '9999999',
    date: '2025-09-20T08:00:00Z',
    author: 'norbert',
    message: 'chore: bump dependencies',
    body: '',
    files: ['package.json'],
    url: 'https://github.com/storybookjs/storybook/commit/9999999',
  },
];

/** Comments for one reviewer: story-hungry, test-hungry, always asking. */
export const ALICE_COMMENTS: ReviewComment[] = [
  makeComment(1, 'alice', 'src/Button.tsx', 'Could you add a story for this state? Without a story nobody can review it.', '2025-01-02'),
  makeComment(2, 'alice', 'src/Button.tsx', 'Could you add a story for the disabled case as well?', '2025-01-03'),
  makeComment(3, 'alice', 'src/Button.tsx', 'This needs a test before we merge it, the previous version regressed twice.', '2025-01-04'),
  makeComment(4, 'alice', 'src/Button.tsx', 'Nice catch on the aria-label! One nit: the docs still mention the old prop.', '2025-01-05'),
  makeComment(5, 'alice', 'docs/Button.mdx', 'The documentation still shows the old API. Could you update it in this PR?', '2025-01-06'),
  makeComment(6, 'alice', 'src/Button.tsx', 'Can we get a story that covers the loading state?', '2025-01-07'),
  makeComment(7, 'alice', 'src/Button.tsx', 'This needs a test for the keyboard interaction.', '2025-01-08'),
  makeComment(8, 'alice', 'src/Button.tsx', 'Thanks for the update — one nit: the story is missing the loading args.', '2025-01-09'),
];

/** Comments for a second reviewer with a completely different beat. */
export const BOB_COMMENTS: ReviewComment[] = [
  makeComment(20, 'bob', 'src/parser.ts', 'This will throw on a null input. Please add a try/catch with a fallback.', '2025-02-01'),
  makeComment(21, 'bob', 'src/parser.ts', 'What happens when the request fails? We need a fallback here.', '2025-02-02'),
  makeComment(22, 'bob', 'src/parser.ts', 'The error is swallowed here, which will make this impossible to debug.', '2025-02-03'),
  makeComment(23, 'bob', 'src/parser.ts', 'Please add a retry with a timeout rather than failing silently.', '2025-02-04'),
];

export function allComments(): ReviewComment[] {
  return [...ALICE_COMMENTS, ...BOB_COMMENTS];
}

function makeComment(
  prNumber: number,
  user: string,
  path: string,
  body: string,
  date: string,
): ReviewComment {
  return {
    id: prNumber * 1000 + user.length,
    prNumber,
    prUrl: `https://github.com/storybookjs/storybook/pull/${prNumber}`,
    path,
    line: 10,
    user,
    body,
    createdAt: `${date}T12:00:00Z`,
  };
}
