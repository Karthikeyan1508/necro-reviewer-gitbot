import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyRun, isProphetic, leaderboard, seedHallOfFame } from '../src/hallOfFame.js';
import { emptyHallOfFame } from '../src/store.js';
import { councilVerdict, voteFromFinding } from '../src/council.js';
import { buildFixIndex } from '../src/fixIndex.js';
import { buildFutureYouPersona, buildPersona } from '../src/persona.js';
import type { Finding } from '../src/types.js';
import { allComments, COMMITS } from './fixtures.js';

const ALICE = buildPersona('alice', allComments());
const BOB = buildPersona('bob', allComments());
const FUTURE_YOU = buildFutureYouPersona(buildFixIndex({ owner: 'storybookjs', repo: 'storybook', commits: COMMITS }));

const finding = (over: Partial<Finding>): Finding => ({
  id: 'x',
  ghostId: ALICE.id,
  ghostName: ALICE.name,
  emoji: ALICE.emoji,
  avatarUrl: '',
  path: 'src/a.ts',
  line: 1,
  severity: 'concern',
  comment: 'c',
  rationale: 'r',
  quote: null,
  evidence: [],
  vote: 'request_changes',
  confidence: 0.7,
  createdAt: new Date().toISOString(),
  sessionId: null,
  live: false,
  ...over,
});

describe('hall of fame', () => {
  it('counts a run and every ghost that sat on the council', () => {
    const findings = [finding({})];
    const verdict = councilVerdict(findings.map(voteFromFinding));
    const hof = applyRun({ hallOfFame: seedHallOfFame([ALICE, BOB]), findings, verdict, personas: [ALICE, BOB] });
    assert.equal(hof.runs, 1);
    assert.equal(hof.verdicts.REQUEST_CHANGES, 1);
    assert.equal(hof.entries.length, 2);
    assert.equal(hof.entries.find((entry) => entry.ghostId === ALICE.id)?.resurrections, 1);
  });

  it('only counts a finding as prophetic when it has evidence or real severity', () => {
    assert.equal(isProphetic(finding({ severity: 'nit' })), false);
    assert.equal(isProphetic(finding({ severity: 'bug' })), true);
    assert.equal(
      isProphetic(
        finding({
          severity: 'nit',
          evidence: [
            {
              sha: 'a'.repeat(40),
              shortSha: 'aaaaaaa',
              date: '',
              message: '',
              files: [],
              url: '',
              score: 0.5,
              pattern: [],
            },
          ],
        }),
      ),
      true,
    );
  });

  it('computes accuracy from the counters, never from vibes', () => {
    const findings = [
      finding({ severity: 'bug' }),
      finding({ severity: 'nit' }),
      finding({ severity: 'nit' }),
      finding({ severity: 'nit' }),
    ];
    const verdict = councilVerdict(findings.map(voteFromFinding));
    const hof = applyRun({ hallOfFame: emptyHallOfFame(), findings, verdict, personas: [ALICE] });
    const entry = hof.entries.find((candidate) => candidate.ghostId === ALICE.id)!;
    assert.equal(entry.findings, 4);
    assert.equal(entry.bugsPredicted, 1);
    assert.equal(entry.accuracy, 0.25);
  });

  it('accumulates across runs and ranks the leaderboard', () => {
    let hof = emptyHallOfFame();
    const verdict = councilVerdict([
      { ghostId: ALICE.id, ghostName: ALICE.name, emoji: '👻', vote: 'approve', reason: 'r', confidence: 0.9 },
    ]);
    for (let i = 0; i < 3; i += 1) {
      hof = applyRun({
        hallOfFame: hof,
        findings: [
          finding({ ghostId: ALICE.id, severity: 'bug' }),
          finding({ ghostId: FUTURE_YOU.id, severity: 'blocker' }),
        ],
        verdict,
        personas: [ALICE, FUTURE_YOU],
      });
    }
    assert.equal(hof.runs, 3);
    assert.equal(hof.verdicts.APPROVED, 3);
    const board = leaderboard(hof);
    assert.equal(board.length, 2);
    assert.ok(board.every((entry) => entry.resurrections === 3));
    assert.ok(board.every((entry) => entry.accuracy === 1));
    assert.ok(board[0]!.lastSummoned);
  });

  it('leaves a nit-only ghost at zero rather than flattering it', () => {
    const findings = [finding({ severity: 'nit' })];
    const verdict = councilVerdict(findings.map(voteFromFinding));
    const hof = applyRun({ hallOfFame: emptyHallOfFame(), findings, verdict, personas: [ALICE] });
    assert.equal(hof.entries[0]!.accuracy, 0);
  });

  it('records a blocked verdict, so the veto is visible in the stats', () => {
    const findings = [finding({ severity: 'blocker', vote: 'block' })];
    const verdict = councilVerdict(findings.map(voteFromFinding));
    const hof = applyRun({ hallOfFame: emptyHallOfFame(), findings, verdict, personas: [ALICE] });
    assert.equal(hof.verdicts.BLOCKED, 1);
  });

  it('tolerates a hall of fame file written before verdicts existed', () => {
    const legacy = { ...emptyHallOfFame(), verdicts: undefined as never };
    const verdict = councilVerdict([voteFromFinding(finding({}))]);
    const hof = applyRun({ hallOfFame: legacy, findings: [finding({})], verdict, personas: [ALICE] });
    assert.equal(hof.verdicts.REQUEST_CHANGES, 1);
  });
});
