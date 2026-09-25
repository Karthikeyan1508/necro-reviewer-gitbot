/**
 * Small text toolkit shared by the persona miner, the fix-pattern index and the
 * séance retrieval. No dependencies: every function here is deterministic, so a
 * demo run is reproducible.
 */

/** English filler plus JavaScript scaffolding that carries no review signal. */
const STOPWORDS = new Set([
  // prose
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'doing',
  'have', 'has', 'had', 'having', 'will', 'would', 'should', 'could', 'can', 'may', 'might',
  'must', 'shall', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'as', 'into',
  'from', 'up', 'down', 'out', 'over', 'under', 'again', 'further', 'once', 'here', 'there',
  'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'too', 'very', 'just',
  'it', 'its', 'i', 'you', 'your', 'we', 'our', 'they', 'their', 'he', 'she', 'them', 'us',
  'me', 'my', 'what', 'which', 'who', 'whom', 'also', 'get', 'got', 'make', 'makes', 'made',
  'use', 'uses', 'used', 'using', 'need', 'needs', 'needed', 'want', 'wants', 'like', 'one',
  'two', 'see', 'seems', 'seem', 'looks', 'look', 'think', 'know', 'well', 'still', 'even',
  // code scaffolding
  'const', 'let', 'var', 'function', 'return', 'returns', 'returned', 'import', 'imports',
  'from', 'export', 'exports', 'default', 'class', 'extends', 'async', 'await', 'new', 'typeof',
  'this', 'arguments', 'true', 'false', 'void', 'undefined', 'null', 'else', 'while',
  'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws',
  // diff noise
  'plus', 'minus', 'index', 'diff', 'file', 'files', 'line', 'lines',
]);

/** Splits an identifier into its words: `useArgsStore` -> use, args, store. */
export function splitIdentifier(raw: string): string[] {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_.\-/:]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}

export interface TokenizeOptions {
  /** Keep tokens of a single character (default: drop them). */
  keepShort?: boolean;
  /** Drop the stopword list (default: apply it). */
  keepStopwords?: boolean;
}

/**
 * Turns arbitrary text — a review comment, a diff hunk, a commit message —
 * into comparable lowercase tokens.
 */
export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
  const { keepShort = false, keepStopwords = false } = options;
  const out: string[] = [];
  const matches = text.match(/[A-Za-z_$][A-Za-z0-9_$]*|\d+[a-z]*/g) ?? [];
  for (const match of matches) {
    for (const part of splitIdentifier(match)) {
      if (!keepShort && part.length < 2) continue;
      if (!keepStopwords && STOPWORDS.has(part)) continue;
      out.push(part);
    }
  }
  return out;
}

/** Token list with duplicates removed, order preserved. */
export function uniqueTokens(tokens: string[]): string[] {
  return [...new Set(tokens)];
}

/**
 * A deliberately small stemmer, so "stories" matches "story" and "args"
 * matches "arg". This is not linguistics — it is the minimum needed for
 * retrieval over review comments, where the same word shows up in both
 * numbers. Anything longer than 4 characters qualifies, so "css" and "is"
 * are left alone.
 */
export function stemToken(token: string): string {
  if (token.length <= 4) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.endsWith('sses')) return token.slice(0, -2);
  if (token.endsWith('es') && !token.endsWith('ses')) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** `tokenize`, with light stemming applied. Used for retrieval, not indexing. */
export function tokenizeStemmed(text: string, options: TokenizeOptions = {}): string[] {
  return tokenize(text, options).map(stemToken);
}

/**
 * The tokens that stand for a file name, used on both sides of a similarity
 * comparison so they can never drift apart.
 *
 * `useArgs` becomes `useargs` *and* `use` *and* `args`: the raw form catches an
 * exact path match, the split form catches `src/useArgs.ts` against
 * `lib/hooks/useArgs.ts`. Stopwords are kept here on purpose — a file called
 * `use.ts` is still a file with a name worth matching.
 */
export function tokensForStem(stem: string): string[] {
  if (!stem) return [];
  return uniqueTokens([stem.toLowerCase(), ...tokenize(stem, { keepStopwords: true })]);
}

/** Counts token occurrences. */
export function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  return tf;
}

/** Contiguous n-grams, used to mine the phrases a reviewer repeats. */
export function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i += 1) out.push(tokens.slice(i, i + n).join(' '));
  return out;
}

/** Removes markdown scaffolding, keeping the words. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[>#]+\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/__([^_]*)__/g, '$1')
    .replace(/\r/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** First sentence of a block of text, trimmed to `max` characters. */
export function firstSentence(text: string, max = 160): string {
  const clean = stripMarkdown(text).replace(/\s+/g, ' ').trim();
  const match = clean.match(/^[^.!?\n]{4,}?[.!?]/);
  const sentence = (match ? match[0] : clean).trim();
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).trimEnd()}…`;
}

/** Collapses whitespace and cuts to length on a word boundary. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** True when the text is a question the reviewer asked. */
export function isQuestion(text: string): boolean {
  const clean = stripMarkdown(text).trim();
  return clean.includes('?') || /^(could|can|would|should|why|how|what|is|are|do|does|did|any)\b/i.test(clean);
}

/** Escapes a string for safe use inside a RegExp. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** ISO date or null, never `Invalid Date`. */
export function safeDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** `2025-08-14T09:12:00Z` -> `2025-08-14`. */
export function shortDate(value: string | null): string {
  return value ? value.slice(0, 10) : 'unknown';
}
