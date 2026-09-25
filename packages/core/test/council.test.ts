import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { councilScore, councilVerdict, voteCounts, voteFromFinding } from '../src/council.js';
import type { Finding, Vote } from '../src/types.js';

function vote(kind: Vote['vote'], ghostName = 'Ghost of alice'): Vote {
  return { ghostId: ghostName.toLowerCase().replace(/\s+/g, '-'), ghostName, emoji: '👻', vote: kind, reason: 'r', confidence: 0.8 };
}

describe('council verdict', () => {
  it('approves when every ghost approves', () => {
    const verdict = councilVerdict([vote('approve'), vote('approve')]);
    assert.equal(verdict.verdict, 'APPROVED');
    assert.equal(verdict.score, 2);
  });

  it('returns changes when a single ghost asks for them', () => {
    const verdict = councilVerdict([vote('approve'), vote('request_changes')]);
    assert.equal(verdict.verdict, 'REQUEST_CHANGES');
    assert.equal(verdict.score, 0.5);
  });

  it('lets one block veto the whole council', () => {
    const verdict = councilVerdict([vote('approve'), vote('approve'), vote('block')]);
    assert.equal(verdict.verdict, 'BLOCKED');
    assert.match(verdict.reason, /veto/i);
  });

  it('does not approve an empty council', () => {
    const verdict = councilVerdict([]);
    assert.equal(verdict.verdict, 'REQUEST_CHANGES');
    assert.match(verdict.reason, /no ghosts/i);
  });

  it('weights the score as +1 / -0.5 / -1', () => {
    assert.equal(councilScore([vote('approve'), vote('approve'), vote('request_changes'), vote('block')]), 0.5);
    assert.deepEqual(voteCounts([vote('approve'), vote('block'), vote('block')]), {
      approve: 1,
      request_changes: 0,
      block: 2,
    });
  });

  it('turns a finding into a ballot', () => {
    const finding: Finding = {
      id: 'f1',
      ghostId: 'ghost-alice',
      ghostName: 'Ghost of alice',
      emoji: '👻',
      avatarUrl: '',
      path: 'src/a.ts',
      line: 3,
      severity: 'bug',
      comment: 'c',
      rationale: 'because',
      quote: null,
      evidence: [],
      vote: 'request_changes',
      confidence: 0.8,
      createdAt: new Date().toISOString(),
      sessionId: null,
      live: false,
    };
    const ballot = voteFromFinding(finding);
    assert.equal(ballot.vote, 'request_changes');
    assert.equal(ballot.reason, 'because');
    assert.equal(ballot.ghostId, 'ghost-alice');
  });
});
