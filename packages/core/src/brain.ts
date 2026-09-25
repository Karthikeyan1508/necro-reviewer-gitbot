import type {
  Finding,
  FixEvidence,
  FixIndex,
  GhostPersona,
  ParsedDiff,
  PullRequestMeta,
  Severity,
  VoteKind,
} from './types.js';
import { SEVERITY_VOTE } from './council.js';
import { isDocPath, isStoryPath, isTestPath } from './diff.js';
import { queryFixIndex } from './fixIndex.js';
import { avatarUrl } from './paths.js';
import { tokenize, truncate } from './text.js';

/**
 * The ghost brain.
 *
 * When there is no agent harness to talk to — no GitBot, no login, no wifi — a
 * ghost still has to review: in character, deterministically, and with
 * something worth reading. This module is that fallback, and it is also the
 * shape every live finding is normalised into afterwards.
 *
 * A "rule" is a pattern this repository's reviewers demonstrably care about: an
 * unguarded fetch, a hook with no cleanup, an escape hatch in the types. Rules
 * are tagged with the same priority labels the persona miner produces
 * (`test coverage`, `type safety`, ...), so a ghost only speaks about what the
 * real reviewer used to speak about. That is the whole trick: the corpus
 * decides who notices what.
 */

/** Base confidence per severity, before evidence and path bonuses. */
const BASE_CONFIDENCE: Record<Severity, number> = {
  nit: 0.5,
  concern: 0.66,
  bug: 0.8,
  blocker: 0.9,
};

export type RuleScope = 'line' | 'file' | 'pr';

export interface AntiPatternRule {
  id: string;
  /** What the ghost calls it when it speaks. */
  label: string;
  /** Must match one of the persona's priorities for this ghost to care. */
  priority: string;
  severity: Severity;
  scope: RuleScope;
  /**
   * `line` — tested against each added line.
   * `file` — tested against each changed path.
   * `pr`   — tested once against the whole diff body.
   */
  test: RegExp;
  /** Suppresses the rule when the diff already handles it. */
  handledBy?: RegExp;
  /** Line/file rules: only paths matching this are eligible. */
  pathFilter?: RegExp;
  /** A pattern worth naming in the comment ("the same shape as ..."). */
  patternLabel: string;
  /** Concrete advice, in the imperative. */
  fix: string;
  /** Why this reviewer would care. */
  why: string;
}

/** Rules every reviewer in a TypeScript monorepo has, at some point, written. */
export const LINE_RULES: AntiPatternRule[] = [
  {
    id: 'unguarded-network',
    label: 'unguarded network call',
    priority: 'error handling',
    severity: 'bug',
    scope: 'line',
    test: /\b(?:fetch|axios\.(?:get|post|put|delete|patch)|request)\s*\(/,
    handledBy: /try\s*\{|\.catch\s*\(|catch\s*\(/,
    patternLabel: 'a request with no failure path',
    fix: 'wrap it in try/catch with a fallback and surface the error to the caller',
    why: 'a rejected request here becomes an unhandled rejection, and the caller stays in its loading state forever',
  },
  {
    id: 'effect-no-cleanup',
    label: 'effect with no cleanup',
    priority: 'performance',
    severity: 'concern',
    scope: 'line',
    test: /\buseEffect\s*\(/,
    handledBy:
      /return\s*\(\s*\)\s*=>|clearTimeout|clearInterval|removeEventListener|abortController|\.abort\s*\(|unsubscribe|dispose/,
    pathFilter: /\.(?:tsx?|jsx?)$/,
    patternLabel: 'a subscription with no teardown',
    fix: 'return a cleanup function from the effect',
    why: 'without cleanup this effect keeps firing after unmount and stacks up on every re-render',
  },
  {
    id: 'effect-no-deps',
    label: 'effect with no dependency array',
    priority: 'performance',
    severity: 'concern',
    scope: 'line',
    test: /\buseEffect\s*\(\s*\([^)]*\)\s*=>/,
    handledBy: /\}\s*,\s*\[[^\]]*\]\s*\)/,
    pathFilter: /\.(?:tsx?|jsx?)$/,
    patternLabel: 'an effect that runs on every render',
    fix: 'give it a dependency array, and say why in a comment if it really must run every time',
    why: 'an effect with no dependency array runs after every render, which is how render loops start',
  },
  {
    id: 'explicit-any',
    label: 'escape hatch in the types',
    priority: 'type safety',
    severity: 'concern',
    scope: 'line',
    test: /:\s*any\b|\bas\s+any\b|<\s*any\s*>/,
    patternLabel: 'an explicit any',
    fix: 'type the value properly, or use `unknown` and narrow it',
    why: 'once an `any` enters here the rest of the file stops being checked',
  },
  {
    id: 'ts-suppression',
    label: 'suppressed compiler error',
    priority: 'type safety',
    severity: 'concern',
    scope: 'line',
    test: /@ts-ignore|@ts-expect-error|@ts-nocheck/,
    patternLabel: 'a silenced compiler',
    fix: 'fix the underlying type error, or narrow the suppression to one line and say why',
    why: 'a blanket suppression hides the next real error in the same file',
  },
  {
    id: 'non-null-assertion',
    label: 'non-null assertion',
    priority: 'type safety',
    severity: 'nit',
    scope: 'line',
    test: /[A-Za-z0-9_\]\)]!\./,
    patternLabel: 'a promise made to the compiler',
    fix: 'guard the value instead of asserting it away',
    why: 'the value can still be null at runtime; the `!` removes the warning, not the case',
  },
  {
    id: 'console-debris',
    label: 'debug output left behind',
    priority: 'code hygiene',
    severity: 'nit',
    scope: 'line',
    test: /\bconsole\.(?:log|debug|trace)\s*\(/,
    pathFilter: /^(?!.*(?:__tests__|\.test\.|\.spec\.|\.stories\.)).*$/,
    patternLabel: 'a leftover console call',
    fix: 'drop it, or route it through the logger this package already uses',
    why: 'this ships to every consumer of the package',
  },
  {
    id: 'todo-added',
    label: 'new piece of unfinished business',
    priority: 'code hygiene',
    severity: 'nit',
    scope: 'line',
    test: /\/\/\s*(?:TODO|FIXME|HACK|XXX)\b|\/\*\s*(?:TODO|FIXME)/,
    patternLabel: 'a TODO with no owner',
    fix: 'open the follow-up issue and reference it here, or finish it in this PR',
    why: 'an unowned TODO is never picked up',
  },
  {
    id: 'unguarded-then',
    label: 'promise chain with no rejection handler',
    priority: 'error handling',
    severity: 'concern',
    scope: 'line',
    test: /\.then\s*\(/,
    handledBy: /\.catch\s*\(/,
    patternLabel: 'a then without a catch',
    fix: 'add a rejection handler, or move to await inside try/catch',
    why: 'if this rejects, nothing reports it and nothing recovers',
  },
  {
    id: 'dangerous-html',
    label: 'raw HTML injected into the tree',
    priority: 'security',
    severity: 'bug',
    scope: 'line',
    test: /dangerouslySetInnerHTML/,
    patternLabel: 'unsanitised markup',
    fix: 'sanitise the markup before it reaches the tree, or render it as text',
    why: 'whatever is in that string runs in the user’s page',
  },
  {
    id: 'a11y-unlabelled',
    label: 'control with nothing to announce it',
    priority: 'accessibility',
    severity: 'concern',
    scope: 'line',
    test: /<(?:input|select|textarea|img)\b(?![^>]*(?:aria-label|aria-labelledby|alt=|id=))/,
    pathFilter: /\.(?:tsx?|jsx?|mdx)$/,
    patternLabel: 'an unlabelled control',
    fix: 'give it a label, or an aria-label when there is no visible one',
    why: 'a screen reader user gets an unlabelled control and no way to tell what it does',
  },
  {
    id: 'magic-timeout',
    label: 'hard-coded wait',
    priority: 'performance',
    severity: 'nit',
    scope: 'line',
    test: /\bset(?:Timeout|Interval)\s*\([^,]+,\s*\d{3,}/,
    patternLabel: 'a magic number in the timing path',
    fix: 'name the constant and say where the number came from',
    why: 'a bare millisecond value is the first thing to break on a slow machine',
  },
  {
    id: 'removed-export',
    label: 'removal from the public surface',
    priority: 'public API stability',
    severity: 'bug',
    scope: 'pr',
    test: /^-\s*export\s+(?:default\s+)?(?:type|interface|const|function|class|enum)\b/m,
    pathFilter: /^(?!.*(?:__tests__|\.test\.|\.spec\.|\.stories\.)).*$/,
    patternLabel: 'a public export that disappeared',
    fix: 'keep the old export as a deprecated alias and document the migration',
    why: 'anything importing this by name breaks on upgrade, and a minor release is not allowed to do that',
  },
];

/** Higher sorts first. */
const SEVERITY_RANK: Record<Severity, number> = { blocker: 3, bug: 2, concern: 1, nit: 0 };

/** Deterministic pick from a list — same ghost, same rule, same phrase. */
function pick<T>(list: T[], seed: string, offset = 0): T | null {
  if (list.length === 0) return null;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return list[(hash + offset) % list.length] ?? null;
}

/** Does a persona watch this rule's concern? Substring either way catches
 *  labels like `error handling on every network call`. */
export function personaWatches(persona: GhostPersona, priority: string): boolean {
  const needle = priority.toLowerCase();
  return persona.priorities.some((item) => {
    const hay = item.toLowerCase();
    return hay.includes(needle) || needle.includes(hay);
  });
}

/** Severity, evidence and familiarity decide how sure a ghost sounds. */
export function confidenceFor(
  severity: Severity,
  evidence: FixEvidence[],
  opts: { familiarPath: boolean } = { familiarPath: false },
): number {
  let confidence = BASE_CONFIDENCE[severity] + evidence.length * 0.06;
  if (opts.familiarPath) confidence += 0.05;
  return Number(Math.min(0.99, confidence).toFixed(2));
}

/**
 * A ghost only blocks when it is sure: a blocker finding with weak confidence
 * is downgraded, so a single hedged remark cannot veto a PR.
 */
export function voteFor(severity: Severity, confidence: number, hasEvidence = false): VoteKind {
  if (severity === 'blocker' && confidence < 0.7 && !hasEvidence) return 'request_changes';
  if (severity === 'bug' && confidence < 0.5) return 'request_changes';
  return SEVERITY_VOTE[severity];
}

/** `Commit abc1234 (2025-08-14) shows the same shape: "fix: ..."`. */
export function evidenceSentence(evidence: FixEvidence[]): string | null {
  if (evidence.length === 0) return null;
  const first = evidence[0]!;
  const date = first.date ? first.date.slice(0, 10) : 'undated';
  const others = evidence.length > 1 ? ` (${evidence.length - 1} more like it)` : '';
  return `Commit ${first.shortSha} (${date}) shows the same pattern was already fixed once: "${truncate(first.message, 90)}"${others}.`;
}

/** The phrase this ghost reaches for on this subject, or null. */
export function phraseFor(persona: GhostPersona, ruleId: string): string | null {
  return pick(persona.commonPhrases, `${persona.id}:${ruleId}`);
}

/** Reads a finding back as the reviewer would have typed it. */
export function composeComment(params: {
  persona: GhostPersona;
  rule: AntiPatternRule;
  snippet: string | null;
  evidence: FixEvidence[];
  cleanPass?: boolean;
}): string {
  const { persona, rule, snippet, evidence, cleanPass = false } = params;
  const phrase = phraseFor(persona, rule.id);

  if (cleanPass) {
    const lead = persona.priorities[0] ?? 'the change as a whole';
    return phrase
      ? `${phrase}\n\nNothing in my lane on this one — I watch ${lead}, and this diff does not touch it. Approving.`
      : `Nothing in my lane on this one — I watch ${lead}, and this diff does not touch it. Approving.`;
  }

  const lines: string[] = [];
  if (phrase) lines.push(phrase);

  const where = snippet ? `\`${truncate(snippet, 90)}\` is ${rule.patternLabel}.` : `This is ${rule.patternLabel}.`;
  lines.push(`${where} ${capitalise(rule.why)}.`);

  const evidenceLine = evidenceSentence(evidence);
  if (evidenceLine) lines.push(evidenceLine);

  lines.push(`${capitalise(rule.fix)}.`);
  return lines.join('\n\n');
}

function capitalise(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Rules that are about the shape of the whole PR rather than one line: the test
 * nobody wrote, the story that was not added, the changelog entry that will be
 * missing at release. Detectors fill in `path` and `snippet` themselves.
 */
export const MISSING_TEST_RULE: AntiPatternRule = {
  id: 'missing-test',
  label: 'tests that were not written',
  priority: 'test coverage',
  severity: 'concern',
  scope: 'file',
  test: /.*/,
  patternLabel: 'a behaviour change with no test attached',
  fix: 'add a test that would fail on the old code',
  why: 'the next person to touch this file has nothing to tell them what it is supposed to do',
};

export const MISSING_STORY_RULE: AntiPatternRule = {
  id: 'missing-story',
  label: 'state with no story',
  priority: 'story coverage',
  severity: 'concern',
  scope: 'file',
  test: /.*/,
  patternLabel: 'a new visual state nobody can see',
  fix: 'add a story for the new state so it can be reviewed and regression-tested',
  why: 'without a story this state only exists on someone’s machine',
};

export const CHANGELOG_RULE: AntiPatternRule = {
  id: 'missing-changelog',
  label: 'shipped change with no entry',
  priority: 'changelog hygiene',
  severity: 'nit',
  scope: 'pr',
  test: /.*/,
  patternLabel: 'a user-visible change with no changelog',
  fix: 'add the changeset entry so the release notes write themselves',
  why: 'this lands in a release and nobody reading the notes will know it happened',
};

export const DOC_DRIFT_RULE: AntiPatternRule = {
  id: 'doc-drift',
  label: 'docs that no longer match',
  priority: 'documentation accuracy',
  severity: 'nit',
  scope: 'pr',
  test: /.*/,
  patternLabel: 'public surface changed with no docs update',
  fix: 'update the docs in this PR, while you still remember what changed',
  why: 'the docs are the only thing most users will read',
};

/** A place where a ghost found something worth saying. */
export interface Candidate {
  rule: AntiPatternRule;
  path: string;
  line: number | null;
  snippet: string | null;
}

const SOURCE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const isSourcePath = (path: string): boolean => SOURCE_EXT.test(path);

/**
 * Walks a diff and returns every place a rule fires, before any ghost has had
 * an opinion about it. Rules that the diff already handles are skipped, so a
 * `try/catch` added alongside a `fetch` silences the complaint about it.
 */
export function collectCandidates(parsed: ParsedDiff): Candidate[] {
  const diffText = parsed.raw;
  const candidates: Candidate[] = [];
  const touched = parsed.files.map((file) => file.path);

  for (const rule of LINE_RULES) {
    if (rule.handledBy && rule.handledBy.test(diffText)) continue;

    if (rule.scope === 'pr') {
      if (!rule.test.test(diffText)) continue;
      const anchor = touched.find(
        (path) => isSourcePath(path) && (!rule.pathFilter || rule.pathFilter.test(path)),
      );
      if (!anchor) continue;
      candidates.push({ rule, path: anchor, line: null, snippet: null });
      continue;
    }

    for (const file of parsed.files) {
      if (rule.pathFilter && !rule.pathFilter.test(file.path)) continue;
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.kind !== '+') continue;
          if (!rule.test.test(line.text)) continue;
          candidates.push({
            rule,
            path: file.path,
            line: line.newLine,
            snippet: line.text.trim(),
          });
          break; // one mention per rule per file is plenty
        }
        if (candidates.some((c) => c.rule.id === rule.id && c.path === file.path)) break;
      }
    }
  }

  // --- Whole-PR detectors. ---
  const sourceFiles = touched.filter((path) => isSourcePath(path) && !isTestPath(path));
  const hasTests = touched.some(isTestPath);
  const hasStory = touched.some(isStoryPath);
  const hasDocs = touched.some(isDocPath);
  const hasChangelog = touched.some((path) => /changelog|changeset|\.changeset\//i.test(path));
  const componentFiles = sourceFiles.filter((path) => /\.(?:tsx|jsx)$/.test(path));
  const addedPublicSurface = /^\+\s*export\s+(?:default\s+)?(?:const|function|class|interface|type|enum)\b/m.test(
    diffText,
  );

  if (sourceFiles.length > 0 && !hasTests) {
    candidates.push({ rule: MISSING_TEST_RULE, path: sourceFiles[0]!, line: null, snippet: null });
  }
  if (componentFiles.length > 0 && !hasStory && !hasDocs) {
    candidates.push({ rule: MISSING_STORY_RULE, path: componentFiles[0]!, line: null, snippet: null });
  }
  if (sourceFiles.length > 0 && !hasChangelog && !hasDocs) {
    candidates.push({ rule: CHANGELOG_RULE, path: sourceFiles[0]!, line: null, snippet: null });
  }
  if (addedPublicSurface && !hasDocs && sourceFiles.length > 0) {
    candidates.push({ rule: DOC_DRIFT_RULE, path: sourceFiles[0]!, line: null, snippet: null });
  }

  return candidates;
}

/** Used when a ghost has nothing in its lane — it still has to vote. */
export const CLEAN_PASS_RULE: AntiPatternRule = {
  id: 'clean-pass',
  label: 'nothing in this lane',
  priority: 'the change as a whole',
  severity: 'nit',
  scope: 'pr',
  test: /^$/,
  patternLabel: 'nothing of mine',
  fix: 'carry on',
  why: 'this diff does not touch what I watch',
};

export interface GhostReviewContext {
  persona: GhostPersona;
  parsed: ParsedDiff;
  /** Fix history, for ghosts that cite their receipts. May be null. */
  fixIndex: FixIndex | null;
  pr: PullRequestMeta;
  live?: boolean;
  sessionId?: string | null;
}

export interface GhostFindingOptions {
  /** How many findings one ghost may file. Default 2. */
  maxFindings?: number;
}

/** Where a priority sits in this ghost's ordering; unranked concerns come last. */
export function personaRankOf(persona: GhostPersona, priority: string): number {
  const needle = priority.toLowerCase();
  const index = persona.priorities.findIndex((item) => {
    const hay = item.toLowerCase();
    return hay.includes(needle) || needle.includes(hay);
  });
  return index === -1 ? persona.priorities.length + 1 : index;
}

/** Narrows a diff to one file, so evidence is about the line being discussed. */
function scopeToCandidate(parsed: ParsedDiff, candidate: Candidate): ParsedDiff {
  const file = parsed.files.find((entry) => entry.path === candidate.path);
  if (!file) return parsed;
  const additions = candidate.snippet ? [candidate.snippet] : file.additions;
  const raw = [`diff --git a/${file.path} b/${file.path}`, ...additions.map((line) => `+${line}`)].join('\n');
  return { raw, files: [{ ...file, additions }], additions };
}

/** Assembled from the parts every finding needs. */
function buildFinding(params: {
  persona: GhostPersona;
  rule: AntiPatternRule;
  path: string;
  line: number | null;
  snippet: string | null;
  evidence: FixEvidence[];
  severity?: Severity;
  familiarPath: boolean;
  live: boolean;
  sessionId: string | null;
  pr: PullRequestMeta;
}): Finding {
  const { persona, rule, path, line, snippet, evidence, familiarPath, live, sessionId, pr } = params;
  const severity = params.severity ?? rule.severity;
  const confidence = confidenceFor(severity, evidence, { familiarPath });
  const vote = voteFor(severity, confidence, evidence.length > 0);
  const comment = composeComment({ persona, rule, snippet, evidence });

  return {
    id: `${persona.id}:${rule.id}:${pr.number}:${line ?? 0}`,
    ghostId: persona.id,
    ghostName: persona.name,
    emoji: persona.emoji,
    avatarUrl: avatarUrl(persona.login),
    path,
    line,
    severity,
    comment,
    rationale: `${rule.label} in ${path}${line ? `:${line}` : ''} — ${rule.why}.`,
    quote: phraseFor(persona, rule.id),
    evidence,
    vote,
    confidence,
    createdAt: new Date().toISOString(),
    sessionId,
    live,
  };
}

/**
 * One ghost reviews the PR.
 *
 * The ghost sees every candidate the rules found, keeps the ones in its lane,
 * orders them by how much it cares, then attaches the historical evidence for
 * the specific line it is about to complain about. If nothing is in its lane it
 * files a clean pass rather than inventing a grievance — and still votes, so the
 * council always has a full set of ballots.
 */
export function ghostFindings(
  context: GhostReviewContext,
  options: GhostFindingOptions = {},
): Finding[] {
  const { persona, parsed, fixIndex, pr, live = false, sessionId = null } = context;
  const { maxFindings = 2 } = options;

  const inLane = collectCandidates(parsed)
    .filter((candidate) => personaWatches(persona, candidate.rule.priority))
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[b.rule.severity] - SEVERITY_RANK[a.rule.severity];
      if (bySeverity !== 0) return bySeverity;
      const byPriority = personaRankOf(persona, a.rule.priority) - personaRankOf(persona, b.rule.priority);
      if (byPriority !== 0) return byPriority;
      return `${a.path}:${a.line ?? 0}`.localeCompare(`${b.path}:${b.line ?? 0}`);
    });

  if (inLane.length === 0) {
    const finding = buildFinding({
      persona,
      rule: CLEAN_PASS_RULE,
      path: pr.changedFiles > 0 ? parsed.files[0]?.path ?? '*' : '*',
      line: null,
      snippet: null,
      evidence: [],
      familiarPath: true,
      live,
      sessionId,
      pr,
    });
    return [
      {
        ...finding,
        comment: composeComment({ persona, rule: CLEAN_PASS_RULE, snippet: null, evidence: [], cleanPass: true }),
        confidence: 0.72,
        vote: 'approve',
      },
    ];
  }

  return inLane.slice(0, maxFindings).map((candidate) => {
    const evidence = queryFixIndex(fixIndex, scopeToCandidate(parsed, candidate), { limit: 2, minScore: 0.2 });
    return buildFinding({
      persona,
      rule: candidate.rule,
      path: candidate.path,
      line: candidate.line,
      snippet: candidate.snippet,
      evidence,
      familiarPath: persona.topPaths.some(
        (known) => candidate.path.startsWith(known) || known.startsWith(candidate.path),
      ),
      live,
      sessionId,
      pr,
    });
  });
}

/** How serious a repeat of history is, by how strong the resemblance is. */
export function severityForEvidence(score: number): Severity {
  if (score >= 0.6) return 'blocker';
  if (score >= 0.4) return 'bug';
  return 'concern';
}

/**
 * The Ghost of Future You files exactly one finding, and it always has a commit
 * behind it. It finds the added line that most resembles a past fix, says which
 * tokens matched, and names the commit that proves the pattern is dangerous.
 */
export function futureYouFinding(context: GhostReviewContext): Finding | null {
  const { persona, parsed, fixIndex, pr, live = false, sessionId = null } = context;
  const evidence = queryFixIndex(fixIndex, parsed, { limit: 3, minScore: 0.15 });
  const top = evidence[0];
  if (!top) return null;

  // Anchor the comment to whichever added line shares the most with that fix.
  const patternTokens = new Set(top.pattern);
  let anchor: { path: string; line: number | null; snippet: string | null } | null = null;
  let bestScore = 0;
  for (const file of parsed.files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.kind !== '+') continue;
        const shared = tokenize(line.text).filter((token) => patternTokens.has(token)).length;
        if (shared > bestScore) {
          bestScore = shared;
          anchor = { path: file.path, line: line.newLine, snippet: line.text.trim() };
        }
      }
    }
  }

  const severity = severityForEvidence(top.score);
  const confidence = confidenceFor(severity, evidence, { familiarPath: false });
  const vote = voteFor(severity, confidence, true);
  const patternPhrase = top.pattern.slice(0, 3).join(' + ') || 'the same shape';
  const date = top.date ? top.date.slice(0, 10) : 'undated';

  const lines = [
    anchor?.snippet
      ? `\`${truncate(anchor.snippet, 90)}\` is the same shape as ${patternPhrase}.`
      : `This diff is the same shape as ${patternPhrase}.`,
    `Commit ${top.shortSha} (${date}) fixed exactly this: "${truncate(top.message, 100)}".`,
  ];
  if (evidence.length > 1) {
    lines.push(`It has happened ${evidence.length} times in what I can see: ${evidence
      .slice(1)
      .map((entry) => entry.shortSha)
      .join(', ')}.`);
  }
  lines.push(
    severity === 'blocker'
      ? 'I have seen this exact diff before, and I have seen what it cost. Handle the failure path before this merges.'
      : 'Keep an eye on the failure path here; last time nobody did.',
  );

  return {
    id: `${persona.id}:${top.shortSha}:${pr.number}`,
    ghostId: persona.id,
    ghostName: persona.name,
    emoji: persona.emoji,
    avatarUrl: avatarUrl(persona.login),
    path: anchor?.path ?? parsed.files[0]?.path ?? '*',
    line: anchor?.line ?? null,
    severity,
    comment: lines.join('\n\n'),
    rationale: `Repeats a pattern already fixed by ${top.shortSha} (similarity ${top.score}): ${top.message}.`,
    quote: `Commit ${top.shortSha}`,
    evidence,
    vote,
    confidence,
    createdAt: new Date().toISOString(),
    sessionId,
    live,
  };
}

/** The headline finding: the one a ghost would cast its vote on. */
export function primaryFinding(findings: Finding[]): Finding | null {
  if (findings.length === 0) return null;
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (bySeverity !== 0) return bySeverity;
    return b.confidence - a.confidence;
  })[0]!;
}





