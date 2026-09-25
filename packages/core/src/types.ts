/**
 * The vocabulary of NecroReview.
 *
 * These types are the contract between three moving parts: the data pipeline
 * (scripts/), the domain logic here, and the bridge + control-room UI. The UI
 * keeps a hand-written mirror of the wire shapes in
 * `packages/ui/src/lib/types.ts`; keep the two in step when this file changes.
 */

/** A single inline PR review comment, trimmed down from the GitHub payload. */
export interface ReviewComment {
  id: number;
  prNumber: number;
  prUrl: string;
  path: string;
  line: number | null;
  /** GitHub login of the reviewer who wrote it. */
  user: string;
  body: string;
  createdAt: string;
}

/** A single commit, trimmed down from the GitHub payload. */
export interface CommitRecord {
  sha: string;
  shortSha: string;
  date: string;
  author: string;
  /** First line of the commit message. */
  message: string;
  body: string;
  /** Paths the commit touched, when known. */
  files: string[];
  url: string;
}

/** One example comment kept on a persona so a ghost can quote itself. */
export interface PersonaSample {
  prNumber: number;
  path: string;
  body: string;
  createdAt: string;
}

/**
 * The extracted voice of a top reviewer. Everything here is traceable to real
 * comments in the source repository — the extractor never invents evidence.
 */
export interface GhostPersona {
  /** Stable slug, e.g. `ghost-jonniebigodes`. */
  id: string;
  /** GitHub login this ghost was resurrected from, or `future-you`. */
  login: string;
  /** Display name, e.g. `Ghost of jonniebigodes`. */
  name: string;
  emoji: string;
  /** True for the synthetic Ghost of Future You, built from fix commits. */
  synthetic: boolean;
  blurb: string;
  tone: string;
  priorities: string[];
  commonPhrases: string[];
  flaggedPatterns: string[];
  quirks: string[];
  sampleComments: PersonaSample[];
  /** Files and directories this reviewer returns to most often. */
  topPaths: string[];
  commentCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
  /** How the persona was produced. */
  source: 'heuristic' | 'claude' | 'commit-history';
}

/** A vote one ghost casts on a PR. */
export type VoteKind = 'approve' | 'request_changes' | 'block';

export interface Vote {
  ghostId: string;
  ghostName: string;
  emoji: string;
  vote: VoteKind;
  reason: string;
  /** 0..1 — how strongly the ghost believes it. */
  confidence: number;
}

export type Severity = 'nit' | 'concern' | 'bug' | 'blocker';

/** A real historical fix that proves the pattern a ghost just flagged. */
export interface FixEvidence {
  sha: string;
  shortSha: string;
  date: string;
  message: string;
  files: string[];
  url: string;
  /** 0..1 lexical similarity between this diff and that fix. */
  score: number;
  /** The tokens the two diffs share — "the same pattern". */
  pattern: string[];
}

/** One ghost's review of one PR. */
export interface Finding {
  id: string;
  ghostId: string;
  ghostName: string;
  emoji: string;
  avatarUrl: string;
  /** File the comment is anchored to, or `*` for a PR-level remark. */
  path: string;
  line: number | null;
  severity: Severity;
  /** The comment, written in the ghost's voice. */
  comment: string;
  /** Why the ghost cares, in its own words. */
  rationale: string;
  /** A real phrase mined from this reviewer's history. */
  quote: string | null;
  /** Historical fixes that support the claim (Ghost of Future You). */
  evidence: FixEvidence[];
  vote: VoteKind;
  confidence: number;
  createdAt: string;
  /** GitBot session that produced it, when the ghost ran live. */
  sessionId: string | null;
  /** False when the deterministic ghost brain produced it. */
  live: boolean;
}

export type VerdictKind = 'APPROVED' | 'REQUEST_CHANGES' | 'BLOCKED';

export interface Verdict {
  verdict: VerdictKind;
  reason: string;
  /** Weighted score: approve +1, request_changes -0.5, block -1 (veto). */
  score: number;
  votes: Vote[];
  counts: Record<VoteKind, number>;
  decidedAt: string;
}

/** A fix/revert commit, tokenised and ready to be matched against a new diff. */
export interface FixPattern {
  sha: string;
  shortSha: string;
  date: string;
  message: string;
  files: string[];
  url: string;
  /** Distinctive tokens shared by this fix's message and hunks. */
  pattern: string[];
  /** token -> weight, precomputed for cosine scoring. */
  tokens: Record<string, number>;
  /** Euclidean norm of `tokens`, precomputed. */
  norm: number;
}

export interface FixIndex {
  owner: string;
  repo: string;
  builtAt: string;
  /** Total commits scanned, including those that were not fixes. */
  scanned: number;
  patterns: FixPattern[];
  /** Document frequency per token, used for idf weighting. */
  df: Record<string, number>;
}

export interface HallOfFameEntry {
  ghostId: string;
  ghostName: string;
  emoji: string;
  login: string;
  /** How many review runs this ghost has been summoned for. */
  resurrections: number;
  findings: number;
  votes: Record<VoteKind, number>;
  /** Findings backed by historical evidence. */
  bugsPredicted: number;
  /**
   * Share of this ghost's findings that were backed by a real historical fix
   * or escalated past `nit`. See docs/ARCHITECTURE.md for the full definition.
   */
  accuracy: number;
  lastSummoned: string | null;
  topPaths: string[];
}

export interface HallOfFame {
  owner: string;
  repo: string;
  updatedAt: string;
  entries: HallOfFameEntry[];
  /** How many councils have sat, and what they decided. */
  runs: number;
  verdicts: Record<VerdictKind, number>;
}

/** A parsed unified diff. */
export interface DiffLine {
  kind: '+' | '-' | ' ';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath: string | null;
  newPath: string | null;
  language: string;
  hunks: DiffHunk[];
  additions: string[];
  deletions: string[];
}

export interface ParsedDiff {
  raw: string;
  files: DiffFile[];
  /** Every added line across every file, in order. */
  additions: string[];
}

/** Metadata about the PR under review. */
export interface PullRequestMeta {
  number: number;
  title: string;
  author: string;
  url: string;
  baseRef: string;
  headRef: string;
  body: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** Where the diff came from. */
  source: 'github' | 'fixture';
}

/** ---------- Wire protocol: bridge -> control room ---------- */

export interface GhostRosterEntry {
  ghostId: string;
  ghostName: string;
  emoji: string;
  avatarUrl: string;
  login: string;
  blurb: string;
  priorities: string[];
  /** How many review comments this ghost was resurrected from. */
  intents: number;
  persona: GhostPersona;
}

export type ReviewEvent =
  | { type: 'review:start'; pr: PullRequestMeta; ghosts: GhostRosterEntry[]; mode: 'live' | 'offline' }
  | { type: 'diff:loaded'; pr: PullRequestMeta; diff: string; files: string[] }
  | { type: 'ghost:summoned'; ghostId: string; ghostName: string; emoji: string; avatarUrl: string; order: number }
  | { type: 'ghost:thinking'; ghostId: string; ghostName: string; status: string }
  | { type: 'ghost:tool'; ghostId: string; toolName: string; detail: string }
  | {
      type: 'ghost:permission';
      ghostId: string;
      sessionId: string;
      toolUseID: string;
      toolName: string;
      input: unknown;
    }
  | { type: 'ghost:finding'; ghostId: string; finding: Finding }
  | { type: 'ghost:error'; ghostId: string; message: string }
  | { type: 'council:verdict'; verdict: Verdict }
  | { type: 'review:done'; findings: Finding[]; verdict: Verdict; durationMs: number };

/** Séance: asking a ghost about a past decision. */
export interface SeanceCitation {
  prNumber: number;
  path: string;
  excerpt: string;
  createdAt: string;
}

export interface SeanceAnswer {
  ghostId: string;
  ghostName: string;
  emoji: string;
  question: string;
  answer: string;
  citations: SeanceCitation[];
  live: boolean;
  sessionId: string | null;
  createdAt: string;
}
