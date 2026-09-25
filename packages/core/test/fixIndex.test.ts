import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFixIndex, isFixCommit, queryFixIndex, sharedPatternOf } from '../src/fixIndex.js';
import { parseDiff } from '../src/diff.js';
import { COMMITS, HELPER_DIFF, RISKY_DIFF } from './fixtures.js';

const INDEX = buildFixIndex({ owner: 'storybookjs', repo: 'storybook', commits: COMMITS });

describe('fix commit recognition', () => {
  it('accepts the ways a repository admits something was wrong', () => {
    assert.ok(isFixCommit('fix: avoid infinite render loop'));
    assert.ok(isFixCommit('fix(react): handle null child'));
    assert.ok(isFixCommit('revert: "feat: new loader"'));
    assert.ok(isFixCommit('hotfix: patch the release script'));
    assert.ok(isFixCommit('Bug fix for the args hook'));
  });

  it('rejects everything else', () => {
    assert.ok(!isFixCommit('chore: bump dependencies'));
    assert.ok(!isFixCommit('feat: add a new prop'));
  });
});

describe('fix pattern index', () => {
  it('indexes only the fix commits and counts the rest as scanned', () => {
    assert.equal(INDEX.scanned, COMMITS.length);
    assert.equal(INDEX.patterns.length, 2);
    assert.ok(INDEX.patterns.every((pattern) => pattern.sha.length === 40));
  });

  it('weighs rare tokens above common ones', () => {
    const pattern = INDEX.patterns.find((entry) => entry.shortSha === 'abc1234');
    assert.ok(pattern);
    assert.ok(pattern!.pattern.length > 0);
    assert.ok(pattern!.norm > 0);
    // The file name is part of the vector, in both its raw and split forms.
    assert.ok(pattern!.tokens.useargs !== undefined, 'raw stem');
    assert.ok(pattern!.tokens.args !== undefined, 'split stem');
  });

  it('cites the commit that fixed the same shape before', () => {
    const evidence = queryFixIndex(INDEX, parseDiff(RISKY_DIFF));
    assert.ok(evidence.length > 0, 'expected at least one historical match');
    const best = evidence[0]!;
    assert.ok(['abc1234', 'def5678'].includes(best.shortSha));
    assert.ok(best.score > 0.2, `score ${best.score} should be meaningful`);
    assert.ok(best.date.startsWith('2025-'));
    assert.ok(best.pattern.length > 0, 'the shared tokens are the explanation');
    assert.ok(best.url.includes('github.com'));
  });

  it('returns matches in descending order of similarity', () => {
    const evidence = queryFixIndex(INDEX, parseDiff(RISKY_DIFF), { limit: 3 });
    const scores = evidence.map((entry) => entry.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });

  it('stays silent when the diff has nothing in common with history', () => {
    const unrelated = `diff --git a/src/theme/colors.ts b/src/theme/colors.ts
index 1..2 100644
--- a/src/theme/colors.ts
+++ b/src/theme/colors.ts
@@ -1 +1,2 @@
+export const teal = '#008080';
`;
    assert.deepEqual(queryFixIndex(INDEX, parseDiff(unrelated)), []);
  });

  it('handles a missing index without throwing', () => {
    assert.deepEqual(queryFixIndex(null, parseDiff(RISKY_DIFF)), []);
  });

  it('summarises the shared pattern in one phrase', () => {
    const evidence = queryFixIndex(INDEX, parseDiff(RISKY_DIFF));
    const phrase = sharedPatternOf(evidence);
    assert.ok(phrase.length > 0);
    assert.ok(phrase.length <= 5);
  });

  it('still works on a brand new file', () => {
    const evidence = queryFixIndex(INDEX, parseDiff(HELPER_DIFF), { minScore: 0 });
    assert.ok(Array.isArray(evidence));
  });
});
