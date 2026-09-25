import type { Finding, Verdict, Vote, VoteKind } from './types.js';

/**
 * The Council Bot. Every ghost casts one vote; the council turns those votes
 * into a single verdict.
 *
 *   approve           +1
 *   request_changes   -0.5
 *   block             -1, and a veto: one blocker stops the PR outright
 *
 * The weights are the ones agreed for the demo. They are deliberately simple —
 * a jury you can explain out loud in three seconds beats a formula nobody can
 * argue with on stage.
 */

export const VOTE_WEIGHTS: Record<VoteKind, number> = {
  approve: 1,
  request_changes: -0.5,
  block: -1,
};

/** Severity -> the vote a ghost would cast for it. */
export const SEVERITY_VOTE: Record<Finding['severity'], VoteKind> = {
  nit: 'approve',
  concern: 'request_changes',
  bug: 'request_changes',
  blocker: 'block',
};

/** Turns a finding into a ballot. */
export function voteFromFinding(finding: Finding): Vote {
  return {
    ghostId: finding.ghostId,
    ghostName: finding.ghostName,
    emoji: finding.emoji,
    vote: finding.vote,
    reason: finding.rationale,
    confidence: finding.confidence,
  };
}

/** Weighted score of a set of votes. */
export function councilScore(votes: Vote[]): number {
  return votes.reduce((total, vote) => total + (VOTE_WEIGHTS[vote.vote] ?? 0), 0);
}

/** Counts each vote kind. */
export function voteCounts(votes: Vote[]): Record<VoteKind, number> {
  const counts: Record<VoteKind, number> = { approve: 0, request_changes: 0, block: 0 };
  for (const vote of votes) counts[vote.vote] += 1;
  return counts;
}

/**
 * The verdict.
 *
 *   1. Any block      -> BLOCKED (a single ghost can veto)
 *   2. >half changes  -> REQUEST_CHANGES
 *   3. otherwise      -> APPROVED
 *
 * Ties fall through to APPROVED only when no ghost objected; a single
 * request_changes is enough to stop a quiet council, because a council that
 * says nothing is not an approval.
 */
export function councilVerdict(votes: Vote[]): Verdict {
  const counts = voteCounts(votes);
  const score = Number(councilScore(votes).toFixed(2));
  const decidedAt = new Date().toISOString();

  if (votes.length === 0) {
    return {
      verdict: 'REQUEST_CHANGES',
      reason: 'No ghosts rose. An empty council cannot approve a change.',
      score,
      votes,
      counts,
      decidedAt,
    };
  }

  const blockers = votes.filter((v) => v.vote === 'block');
  if (blockers.length > 0) {
    const names = blockers.map((v) => v.ghostName.replace(/^Ghost of /, '')).join(', ');
    return {
      verdict: 'BLOCKED',
      reason: `${blockers.length} ghost(s) blocked: ${names}. A block is a veto.`,
      score,
      votes,
      counts,
      decidedAt,
    };
  }

  if (counts.request_changes > 0) {
    const who = votes
      .filter((v) => v.vote === 'request_changes')
      .map((v) => v.ghostName.replace(/^Ghost of /, ''))
      .join(', ');
    return {
      verdict: 'REQUEST_CHANGES',
      reason: `${counts.request_changes} of ${votes.length} ghosts requested changes: ${who}.`,
      score,
      votes,
      counts,
      decidedAt,
    };
  }

  return {
    verdict: 'APPROVED',
    reason: `All ${votes.length} ghosts approve. Weighted score ${score >= 0 ? '+' : ''}${score}.`,
    score,
    votes,
    counts,
    decidedAt,
  };
}

/** One-line summary for the terminal and the demo log. */
export function describeVerdict(verdict: Verdict): string {
  const { counts } = verdict;
  return `${verdict.verdict} — ${verdict.reason} (approve ${counts.approve} / changes ${counts.request_changes} / block ${counts.block}, score ${verdict.score})`;
}
