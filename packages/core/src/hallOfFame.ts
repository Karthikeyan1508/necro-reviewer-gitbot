import type { Finding, GhostPersona, HallOfFame, HallOfFameEntry, Verdict } from './types.js';
import { emptyHallOfFame } from './store.js';
import { sourceRepo } from './paths.js';

/**
 * The Hall of Fame.
 *
 * Counters are updated after every council run. The interesting number is
 * `accuracy`, and it needs an honest definition or it is just decoration:
 *
 *   accuracy = findings with a real fix commit behind them, or severe enough to
 *              be more than taste (bug / blocker)
 *              --------------------------------------------------------------
 *              every finding the ghost has filed
 *
 * Nothing here counts an opinion as a hit. A ghost that only ever files nits
 * scores 0, which is the point — the ghosts with history behind them rise.
 */

/** Did this finding turn out to be more than taste? */
export function isProphetic(finding: Finding): boolean {
  return finding.evidence.length > 0 || finding.severity === 'bug' || finding.severity === 'blocker';
}

function blankEntry(persona: GhostPersona): HallOfFameEntry {
  return {
    ghostId: persona.id,
    ghostName: persona.name,
    emoji: persona.emoji,
    login: persona.login,
    resurrections: 0,
    findings: 0,
    votes: { approve: 0, request_changes: 0, block: 0 },
    bugsPredicted: 0,
    accuracy: 0,
    lastSummoned: null,
    topPaths: persona.topPaths,
  };
}

/** Reads an entry, creating it on first sight. */
export function entryFor(hallOfFame: HallOfFame, persona: GhostPersona): HallOfFameEntry {
  const existing = hallOfFame.entries.find((entry) => entry.ghostId === persona.id);
  if (existing) return existing;
  const created = blankEntry(persona);
  hallOfFame.entries.push(created);
  return created;
}

/**
 * Folds one council run into the hall of fame and returns a fresh copy.
 * `personas` supplies the identity of every ghost that sat on the council,
 * including any that filed no finding.
 */
export function applyRun(params: {
  hallOfFame: HallOfFame;
  findings: Finding[];
  verdict: Verdict;
  personas: GhostPersona[];
}): HallOfFame {
  const { hallOfFame, findings, verdict, personas } = params;
  const { owner, repo } = sourceRepo();
  const next: HallOfFame = {
    owner: hallOfFame.owner || owner,
    repo: hallOfFame.repo || repo,
    updatedAt: new Date().toISOString(),
    runs: hallOfFame.runs + 1,
    verdicts: {
      APPROVED: hallOfFame.verdicts?.APPROVED ?? 0,
      REQUEST_CHANGES: hallOfFame.verdicts?.REQUEST_CHANGES ?? 0,
      BLOCKED: hallOfFame.verdicts?.BLOCKED ?? 0,
    },
    entries: hallOfFame.entries.map((entry) => ({
      ...entry,
      votes: { ...entry.votes },
      topPaths: [...entry.topPaths],
    })),
  };
  next.verdicts[verdict.verdict] += 1;

  for (const persona of personas) {
    const entry = entryFor(next, persona);
    entry.resurrections += 1;
    entry.lastSummoned = next.updatedAt;
    entry.topPaths = persona.topPaths.length > 0 ? persona.topPaths : entry.topPaths;
  }

  for (const finding of findings) {
    const existing = next.entries.find((entry) => entry.ghostId === finding.ghostId);
    if (!existing) continue;
    existing.findings += 1;
    existing.votes[finding.vote] += 1;
    if (isProphetic(finding)) existing.bugsPredicted += 1;
  }

  for (const entry of next.entries) {
    entry.accuracy = entry.findings === 0 ? 0 : Number((entry.bugsPredicted / entry.findings).toFixed(3));
  }

  return next;
}

/** Ranking for the leaderboard: most resurrections, then accuracy, then reach. */
export function leaderboard(hallOfFame: HallOfFame): HallOfFameEntry[] {
  return [...hallOfFame.entries].sort(
    (a, b) =>
      b.resurrections - a.resurrections ||
      b.accuracy - a.accuracy ||
      b.bugsPredicted - a.bugsPredicted ||
      a.ghostName.localeCompare(b.ghostName),
  );
}

/**
 * Value each ghost brought: findings that came with evidence, today's price on
 * `bugsPredicted`. Used for the "money shot" line in the UI.
 */
export function contributionOf(entry: HallOfFameEntry): number {
  return entry.bugsPredicted;
}

/** A fresh hall of fame with every persona pre-registered. */
export function seedHallOfFame(personas: GhostPersona[], base: HallOfFame = emptyHallOfFame()): HallOfFame {
  const next: HallOfFame = {
    owner: base.owner,
    repo: base.repo,
    updatedAt: base.updatedAt,
    runs: base.runs,
    verdicts: { ...base.verdicts },
    entries: base.entries.map((entry) => ({ ...entry, votes: { ...entry.votes }, topPaths: [...entry.topPaths] })),
  };
  for (const persona of personas) entryFor(next, persona);
  return next;
}
