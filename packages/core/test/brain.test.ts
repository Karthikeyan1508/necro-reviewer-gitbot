import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectCandidates,
  confidenceFor,
  futureYouFinding,
  ghostFindings,
  personaWatches,
  primaryFinding,
  severityForEvidence,
  voteFor,
} from '../src/brain.js';
import { parseDiff } from '../src/diff.js';
import { buildFixIndex } from '../src/fixIndex.js';
import { buildFutureYouPersona, buildPersona } from '../src/persona.js';
import type { GhostPersona, PullRequestMeta } from '../src/types.js';
import { allComments, COMMITS, RISKY_DIFF, CAREFUL_DIFF, REMOVAL_DIFF } from './fixtures.js';

const PARSED = parseDiff(RISKY_DIFF);
const INDEX = buildFixIndex({ owner: 'storybookjs', repo: 'storybook', commits: COMMITS });
const PR: PullRequestMeta = {
  number: 32464,
  title: 'fix: avoid infinite render loop in useArgs',
  author: 'kangax',
  url: 'https://github.com/storybookjs/storybook/pull/32464',
  baseRef: 'next',
  headRef: 'patch-1',
  body: 'Fixes the render loop.',
  additions: 12,
  deletions: 2,
  changedFiles: 1,
  source: 'fixture',
};

const ALICE = buildPersona('alice', allComments());
const BOB = buildPersona('bob', allComments());
const FUTURE_YOU = buildFutureYouPersona(INDEX);

describe('candidate collection', () => {
  it('finds the unguarded request, the escaping types and the debug line', () => {
    const ids = collectCandidates(PARSED).map((candidate) => candidate.rule.id);
    assert.ok(ids.includes('unguarded-network'), ids.join(','));
    assert.ok(ids.includes('unguarded-then'));
    assert.ok(ids.includes('explicit-any'));
    assert.ok(ids.includes('console-debris'));
    assert.ok(ids.includes('missing-test'));
  });

  it('silences a rule the diff already handles', () => {
    const ids = collectCandidates(parseDiff(CAREFUL_DIFF)).map((candidate) => candidate.rule.id);
    assert.ok(!ids.includes('unguarded-network'), 'a try/catch settles it');
    assert.ok(!ids.includes('unguarded-then'), 'the await is inside the try');
  });

  it('accepts a test in the diff as covering the change', () => {
    const withTest = `${RISKY_DIFF}
diff --git a/src/useArgs.test.ts b/src/useArgs.test.ts
index 1..2 100644
--- a/src/useArgs.test.ts
+++ b/src/useArgs.test.ts
@@ -1 +1,2 @@
+it('loads args', () => {});
`;
    const ids = collectCandidates(parseDiff(withTest)).map((candidate) => candidate.rule.id);
    assert.ok(!ids.includes('missing-test'));
  });

  it('notices a public export that disappeared', () => {
    const ids = collectCandidates(parseDiff(REMOVAL_DIFF)).map((candidate) => candidate.rule.id);
    assert.ok(ids.includes('removed-export'), ids.join(','));
  });
});

describe('persona matching', () => {
  it('maps a reviewer to the concerns they actually raised', () => {
    assert.ok(personaWatches(ALICE, 'story coverage'));
    assert.ok(personaWatches(ALICE, 'test coverage'));
    assert.ok(personaWatches(BOB, 'error handling'));
  });

  it('keeps a ghost out of lanes it never worked in', () => {
    assert.ok(!personaWatches(BOB, 'story coverage'));
    assert.ok(!personaWatches(ALICE, 'security'));
  });
});

describe('ghost findings', () => {
  it('files findings only in the ghost own lane', () => {
    const findings = ghostFindings({ persona: ALICE, parsed: PARSED, fixIndex: INDEX, pr: PR });
    assert.ok(findings.length > 0);
    assert.ok(findings.every((finding) => finding.ghostId === ALICE.id));
    assert.ok(
      findings.every((finding) =>
        finding.rationale.includes('test') ||
        finding.rationale.includes('story') ||
        finding.rationale.includes('doc'),
      ),
    );
  });

  it('writes the comment in the ghost voice, quoting a real phrase', () => {
    const findings = ghostFindings({ persona: ALICE, parsed: PARSED, fixIndex: INDEX, pr: PR });
    const finding = findings[0]!;
    assert.ok(finding.comment.length > 40);
    assert.ok(finding.quote === null || ALICE.commonPhrases.includes(finding.quote));
    assert.equal(finding.avatarUrl.includes('dicebear'), true);
  });

  it('cites real commits when the shape was fixed before', () => {
    const findings = ghostFindings({ persona: BOB, parsed: PARSED, fixIndex: INDEX, pr: PR });
    const withEvidence = findings.filter((finding) => finding.evidence.length > 0);
    assert.ok(withEvidence.length > 0, 'bob watches error handling, which history covers');
    for (const finding of withEvidence) {
      assert.equal(finding.evidence[0]!.sha.length, 40);
      assert.match(finding.comment, /Commit [0-9a-f]{7}/);
    }
  });

  it('files a clean pass and still votes when nothing is in lane', () => {
    const quiet: GhostPersona = { ...ALICE, priorities: ['internationalisation'] };
    const findings = ghostFindings({ persona: quiet, parsed: PARSED, fixIndex: null, pr: PR });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.vote, 'approve');
    assert.match(findings[0]!.comment, /Nothing in my lane/);
  });

  it('respects the finding cap', () => {
    const findings = ghostFindings(
      { persona: ALICE, parsed: PARSED, fixIndex: INDEX, pr: PR },
      { maxFindings: 1 },
    );
    assert.equal(findings.length, 1);
  });

  it('marks the finding as offline when no session backed it', () => {
    const findings = ghostFindings({ persona: ALICE, parsed: PARSED, fixIndex: INDEX, pr: PR });
    assert.ok(findings.every((finding) => finding.live === false));
    assert.ok(findings.every((finding) => finding.sessionId === null));
  });

  it('chooses the headline finding by severity', () => {
    const primary = primaryFinding([
      { ...ghostFindings({ persona: ALICE, parsed: PARSED, fixIndex: INDEX, pr: PR })[0]!, severity: 'nit' },
      { ...ghostFindings({ persona: BOB, parsed: PARSED, fixIndex: INDEX, pr: PR })[0]!, severity: 'blocker' },
    ]);
    assert.equal(primary?.severity, 'blocker');
    assert.equal(primaryFinding([]), null);
  });
});

describe('the ghost of future you', () => {
  it('cites a commit and anchors to a line in the diff', () => {
    const finding = futureYouFinding({ persona: FUTURE_YOU, parsed: PARSED, fixIndex: INDEX, pr: PR });
    assert.ok(finding, 'expected a prophecy for this diff');
    assert.ok(finding!.evidence.length > 0);
    assert.ok(finding!.path.endsWith('useArgs.ts'));
    assert.equal(typeof finding!.line, 'number');
    assert.match(finding!.comment, /same shape as/);
    assert.match(finding!.comment, /Commit [0-9a-f]{7} \(\d{4}-\d{2}-\d{2}\)/);
  });

  it('says nothing when it has no receipts', () => {
    const finding = futureYouFinding({ persona: FUTURE_YOU, parsed: PARSED, fixIndex: null, pr: PR });
    assert.equal(finding, null);
  });

  it('escalates by how strong the resemblance is', () => {
    assert.equal(severityForEvidence(0.8), 'blocker');
    assert.equal(severityForEvidence(0.5), 'bug');
    assert.equal(severityForEvidence(0.2), 'concern');
  });

  it('can block, so the council can reach a veto', () => {
    const finding = futureYouFinding({ persona: FUTURE_YOU, parsed: PARSED, fixIndex: INDEX, pr: PR });
    assert.ok(finding);
    if (finding!.evidence[0]!.score >= 0.6) assert.equal(finding!.vote, 'block');
  });
});

describe('confidence and voting', () => {
  const evidence = (score: number) => ({
    sha: 'a'.repeat(40),
    shortSha: 'aaaaaaa',
    date: '2025-01-01T00:00:00Z',
    message: 'fix: x',
    files: [],
    url: '',
    score,
    pattern: ['x'],
  });

  it('rises with evidence and stays capped', () => {
    const plain = confidenceFor('concern', []);
    const backed = confidenceFor('concern', [evidence(0.4)]);
    assert.ok(backed > plain);
    assert.ok(confidenceFor('blocker', new Array(20).fill(evidence(0.9))) <= 0.99);
  });

  it('downgrades an unsure blocker instead of letting it veto', () => {
    assert.equal(voteFor('blocker', 0.6, false), 'request_changes');
    assert.equal(voteFor('blocker', 0.6, true), 'block');
    assert.equal(voteFor('blocker', 0.9, false), 'block');
    assert.equal(voteFor('nit', 0.5), 'approve');
    assert.equal(voteFor('bug', 0.9), 'request_changes');
  });
});


