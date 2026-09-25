import type { CommitRecord, FixEvidence, FixIndex, FixPattern, ParsedDiff } from './types.js';
import { stemOf, stemsOf } from './diff.js';
import { tokenize, tokensForStem, uniqueTokens } from './text.js';

/**
 * The Ghost of Future You.
 *
 * The promise it makes on stage is specific: "This fetch has no error handling.
 * Commit abc123 shows the same pattern caused a production hang." To keep that
 * promise honestly we index the repository's real fix and revert commits and
 * match a new diff against them, returning the commits that justify the claim.
 *
 * How matching works
 * ------------------
 * Each fix commit becomes a token vector: the identifiers and words of its
 * message, plus the file names it touched. A new diff becomes a token vector
 * from its added lines plus the files it touches. We score them with
 * idf-weighted cosine similarity, then bonus anything that shares a file name.
 *
 * Why not embeddings? A real embedding model needs a network call and an API
 * key, and the demo has to run on a laptop with the wifi off. This lexical
 * index is deterministic, instant, offline, and easy to audit — you can point
 * at the exact tokens that matched. `queryFixIndex` is the only place a
 * smarter scorer would need to be swapped in.
 */

/** Commits that admit something was wrong: the raw material for prophecy. */
export const FIX_COMMIT_RE =
  /^(fix|revert|hotfix|bugfix)\b|^(fix|revert|hotfix)\(|bug ?fix|regression|broke|breaks|repair|corrects?\b|^patch\b|workaround|oops|typo/i;

export function isFixCommit(message: string): boolean {
  return FIX_COMMIT_RE.test(message.trim());
}

/** Message words matter more than file names, but file names are the tiebreak. */
const MESSAGE_WEIGHT = 1;
const FILE_WEIGHT = 0.7;

function norm(vector: Map<string, number> | Record<string, number>): number {
  let sum = 0;
  for (const value of Object.values(vector)) sum += value * value;
  return Math.sqrt(sum);
}

/** Builds the searchable index of everything the repo has already broken. */
export function buildFixIndex(params: {
  owner: string;
  repo: string;
  commits: CommitRecord[];
  /** Keep at most this many fix commits (newest first). Default 400. */
  limit?: number;
}): FixIndex {
  const { owner, repo, commits, limit = 400 } = params;
  const fixes = commits.filter((commit) => isFixCommit(commit.message)).slice(0, limit);

  const df: Record<string, number> = {};
  const patterns: FixPattern[] = [];

  for (const commit of fixes) {
    const weights = new Map<string, number>();
    const add = (token: string, weight: number) => {
      weights.set(token, (weights.get(token) ?? 0) + weight);
    };

    for (const token of tokenize(commit.message)) add(token, MESSAGE_WEIGHT);
    // A commit body often names the exact failure ("hangs on slow network").
    if (commit.body) for (const token of tokenize(commit.body.slice(0, 600))) add(token, MESSAGE_WEIGHT * 0.6);
    for (const file of commit.files) {
      // Same helper as the query side uses, so the two can never disagree.
      for (const token of tokensForStem(stemOf(file))) add(token, FILE_WEIGHT);
    }

    if (weights.size === 0) continue;

    const tokens: Record<string, number> = {};
    for (const [token, weight] of weights) tokens[token] = Number(weight.toFixed(4));
    for (const token of Object.keys(tokens)) df[token] = (df[token] ?? 0) + 1;

    patterns.push({
      sha: commit.sha,
      shortSha: commit.shortSha || commit.sha.slice(0, 7),
      date: commit.date,
      message: commit.message,
      files: commit.files,
      url: commit.url,
      pattern: [],
      tokens,
      norm: Number(norm(tokens).toFixed(4)),
    });
  }

  // The tokens that best identify a fix are the rare ones — score them now
  // that document frequency is known.
  const total = patterns.length || 1;
  for (const pattern of patterns) {
    pattern.pattern = Object.keys(pattern.tokens)
      .map((token) => ({ token, idf: Math.log(1 + total / (1 + (df[token] ?? 0))) }))
      .sort((a, b) => b.idf - a.idf)
      .slice(0, 8)
      .map((entry) => entry.token);
  }

  return {
    owner,
    repo,
    builtAt: new Date().toISOString(),
    scanned: commits.length,
    patterns,
    df,
  };
}

export interface FixQueryOptions {
  /** How many historical fixes to return. Default 3. */
  limit?: number;
  /** Similarity floor, below which a match is noise. Default 0.12. */
  minScore?: number;
}

/**
 * Matches a new diff against the repository's fix history.
 *
 * Returns the strongest matches first, each carrying the SHAs, dates and the
 * shared tokens that justify the citation. Scores are idf-weighted cosine
 * similarities, so a rare identifier in common counts for far more than a
 * ubiquitous one like `component`.
 */
export function queryFixIndex(
  index: FixIndex | null,
  parsed: ParsedDiff,
  options: FixQueryOptions = {},
): FixEvidence[] {
  if (!index || index.patterns.length === 0) return [];
  const { limit = 3, minScore = 0.12 } = options;
  const total = index.patterns.length;
  const idfOf = (token: string): number => Math.log(1 + total / (1 + (index.df[token] ?? 0)));

  // --- The query vector: added lines plus the files the PR touches. ---
  const query = new Map<string, number>();
  for (const line of parsed.additions) {
    for (const token of tokenize(line)) {
      query.set(token, Math.min(3, (query.get(token) ?? 0) + 1));
    }
  }
  // A shared file name is a strong hint that history is about to repeat.
  const queryStems = new Set(stemsOf(parsed));
  for (const stem of queryStems) {
    for (const token of tokensForStem(stem)) {
      query.set(token, (query.get(token) ?? 0) + 1.2);
    }
  }
  if (query.size === 0) return [];

  const queryNorm = Math.sqrt(
    [...query.entries()].reduce((sum, [token, tf]) => {
      const weight = tf * idfOf(token);
      return sum + weight * weight;
    }, 0),
  );
  if (queryNorm === 0) return [];

  const matches: FixEvidence[] = [];

  for (const pattern of index.patterns) {
    const patternTokens = new Map(Object.entries(pattern.tokens));
    let dot = 0;
    let patternSquares = 0;
    const shared: { token: string; idf: number }[] = [];

    for (const [token, tf] of patternTokens) {
      const weight = tf * idfOf(token);
      patternSquares += weight * weight;
      const queryTf = query.get(token);
      if (queryTf === undefined) continue;
      dot += weight * queryTf * idfOf(token);
      shared.push({ token, idf: idfOf(token) });
    }

    const patternNorm = Math.sqrt(patternSquares);
    if (patternNorm === 0 || dot === 0) continue;

    let score = dot / (queryNorm * patternNorm);

    // Same file, even reworked since: history is repeating.
    const sharesFile = pattern.files.some((file) => queryStems.has(stemOf(file)));
    if (sharesFile) score *= 1.3;

    score = Math.min(0.99, score);
    if (score < minScore) continue;

    matches.push({
      sha: pattern.sha,
      shortSha: pattern.shortSha,
      date: pattern.date,
      message: pattern.message,
      files: pattern.files,
      url: pattern.url,
      score: Number(score.toFixed(3)),
      pattern: shared
        .sort((a, b) => b.idf - a.idf)
        .slice(0, 6)
        .map((entry) => entry.token),
    });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The tokens a set of citations have in common — "the pattern" in one phrase. */
export function sharedPatternOf(evidence: FixEvidence[]): string[] {
  if (evidence.length === 0) return [];
  return uniqueTokens(evidence[0]!.pattern).slice(0, 5);
}

