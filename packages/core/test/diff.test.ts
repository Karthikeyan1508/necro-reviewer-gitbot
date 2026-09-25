import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffStats, isDocPath, isStoryPath, isTestPath, languageOf, parseDiff, stemOf, stemsOf } from '../src/diff.js';
import { CAREFUL_DIFF, HELPER_DIFF, REMOVAL_DIFF, RISKY_DIFF } from './fixtures.js';

describe('unified diff parsing', () => {
  it('reads files, hunks and added lines out of a real diff', () => {
    const parsed = parseDiff(RISKY_DIFF);
    assert.equal(parsed.files.length, 1);
    const file = parsed.files[0]!;
    assert.equal(file.path, 'src/useArgs.ts');
    assert.equal(file.language, 'typescript');
    assert.equal(file.hunks.length, 1);
    assert.equal(file.hunks[0]!.newStart, 1);
    assert.ok(file.additions.some((line) => line.includes('fetch(')));
    assert.equal(parsed.additions.length, file.additions.length);
  });

  it('assigns real new-file line numbers to added lines', () => {
    const parsed = parseDiff(RISKY_DIFF);
    const added = parsed.files[0]!.hunks[0]!.lines.filter((line) => line.kind === '+');
    // Context lines before the additions push the first added line down.
    assert.ok(added.length > 0);
    assert.ok(added.every((line) => typeof line.newLine === 'number' && line.newLine > 0));
    assert.equal(added[0]!.oldLine, null);
  });

  it('counts deletions', () => {
    const parsed = parseDiff(REMOVAL_DIFF);
    const file = parsed.files[0]!;
    assert.equal(file.deletions.length, 1);
    assert.match(file.deletions[0]!, /legacyApi/);
    assert.deepEqual(diffStats(parsed), { files: 1, additions: 0, deletions: 1 });
  });

  it('handles a newly created file', () => {
    const parsed = parseDiff(HELPER_DIFF);
    const file = parsed.files[0]!;
    assert.equal(file.path, 'src/helpers/parse.ts');
    assert.equal(file.oldPath, null);
    assert.equal(file.additions.length, 1);
  });

  it('keeps every file in a multi-hunk diff', () => {
    const parsed = parseDiff(`${RISKY_DIFF}${CAREFUL_DIFF}`);
    assert.equal(parsed.files.length, 2);
    assert.deepEqual(stemsOf(parsed).sort(), ['loader', 'useArgs']);
  });

  it('names paths the way the classifiers need', () => {
    assert.equal(languageOf('a/b/c.tsx'), 'tsx');
    assert.equal(languageOf('a/unknown.zzz'), 'zzz');
    assert.equal(stemOf('src/deep/useArgs.ts'), 'useArgs');
    assert.ok(isTestPath('src/useArgs.test.ts'));
    assert.ok(isTestPath('e2e/thing.ts'));
    assert.ok(!isTestPath('src/useArgs.ts'));
    assert.ok(isStoryPath('src/Button.stories.tsx'));
    assert.ok(isDocPath('docs/Button.mdx'));
    assert.ok(!isDocPath('src/Button.tsx'));
  });

  it('returns an empty parse for input that is not a diff', () => {
    const parsed = parseDiff('not a diff at all\n');
    assert.deepEqual(parsed.files, []);
    assert.deepEqual(parsed.additions, []);
  });
});
