import type { FixIndex, GhostPersona, PersonaSample, ReviewComment } from './types.js';
import { isQuestion, ngrams, safeDate, shortDate, stripMarkdown, tokenize, truncate } from './text.js';

/**
 * Persona extraction.
 *
 * Given a reviewer's real comments, work out what they care about, how they
 * sound, and which sentences they keep repeating. Everything is counted from
 * the comments themselves; nothing here is invented. That matters because the
 * demo claims these ghosts "review in their voice" — the voice has to be
 * measurable, not vibes.
 */

export interface ReviewerRanking {
  login: string;
  comments: number;
  reviewedPaths: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

/** `Jonnie Bigodes` -> `ghost-jonnie-bigodes`. */
export function slugify(login: string): string {
  return `ghost-${login
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;
}

/** Who reviews the most, by inline comment volume. */
export function rankReviewers(comments: ReviewComment[], limit = 10): ReviewerRanking[] {
  const byLogin = new Map<string, ReviewerRanking>();
  const pathsByLogin = new Map<string, Set<string>>();

  for (const comment of comments) {
    if (!comment.user || comment.user.endsWith('[bot]')) continue;
    const existing = byLogin.get(comment.user) ?? {
      login: comment.user,
      comments: 0,
      reviewedPaths: 0,
      firstSeen: null,
      lastSeen: null,
    };
    existing.comments += 1;
    const date = safeDate(comment.createdAt);
    if (date) {
      if (!existing.firstSeen || date < existing.firstSeen) existing.firstSeen = date;
      if (!existing.lastSeen || date > existing.lastSeen) existing.lastSeen = date;
    }
    byLogin.set(comment.user, existing);

    const paths = pathsByLogin.get(comment.user) ?? new Set<string>();
    if (comment.path) paths.add(comment.path);
    pathsByLogin.set(comment.user, paths);
  }

  for (const [login, entry] of byLogin) entry.reviewedPaths = pathsByLogin.get(login)?.size ?? 0;

  return [...byLogin.values()]
    .sort((a, b) => b.comments - a.comments || a.login.localeCompare(b.login))
    .slice(0, limit);
}

/** What a reviewer's vocabulary reveals they hunt for. */
interface PriorityRule {
  label: string;
  /** Words that hint at this concern. */
  terms: string[];
  /** What the ghost will end up flagging when this priority fires. */
  flagged: string;
}

const PRIORITY_RULES: PriorityRule[] = [
  {
    label: 'documentation accuracy',
    terms: ['doc', 'docs', 'documentation', 'mdx', 'readme', 'jsdoc', 'commented'],
    flagged: 'documentation left behind by the change',
  },
  {
    label: 'accessibility',
    terms: ['a11y', 'accessibility', 'accessible', 'aria', 'wcag', 'keyboard', 'focus', 'contrast'],
    flagged: 'accessible behaviour that was never verified',
  },
  {
    label: 'test coverage',
    terms: ['test', 'tests', 'testing', 'spec', 'jest', 'vitest', 'coverage', 'mock', 'assert'],
    flagged: 'missing test coverage',
  },
  {
    label: 'story coverage',
    terms: ['story', 'stories', 'storybook', 'csf', 'argtypes'],
    flagged: 'a missing story for the new state',
  },
  {
    label: 'type safety',
    terms: ['type', 'types', 'typescript', 'typed', 'generic', 'interface'],
    flagged: 'an escape hatch that weakens the types',
  },
  {
    label: 'public API stability',
    terms: ['api', 'breaking', 'deprecate', 'deprecated', 'backwards', 'migration', 'semver', 'rename'],
    flagged: 'a public API change with no migration path',
  },
  {
    label: 'performance',
    terms: ['performance', 'perf', 'slow', 'memo', 'memoize', 'rerender', 'expensive', 'loop'],
    flagged: 'an extra render or an unbounded loop',
  },
  {
    label: 'changelog hygiene',
    terms: ['changelog', 'changeset', 'release', 'prerelease', 'version'],
    flagged: 'a change that will never reach the changelog',
  },
  {
    label: 'error handling',
    terms: ['error', 'errors', 'catch', 'throw', 'fallback', 'retry', 'timeout', 'failure'],
    flagged: 'a failure path with no handling',
  },
  {
    label: 'code hygiene',
    terms: ['lint', 'eslint', 'prettier', 'format', 'formatting', 'style', 'naming', 'console'],
    flagged: 'leftover debris in the diff',
  },
  {
    label: 'security',
    terms: ['security', 'sanitize', 'injection', 'xss', 'auth', 'token', 'secret', 'escape'],
    flagged: 'a value that trusts its input',
  },
  {
    label: 'internationalisation',
    terms: ['i18n', 'locale', 'localisation', 'localization', 'translation', 'rtl'],
    flagged: 'copy that only works in English',
  },
];

/** Counts how strongly each priority shows up in a reviewer's comments. */
export function detectPriorities(
  comments: ReviewComment[],
  limit = 4,
): { label: string; hits: number; flagged: string }[] {
  const scores = new Map<string, number>();
  const flaggedByLabel = new Map<string, string>();

  for (const comment of comments) {
    const tokens = new Set(tokenize(comment.body ?? '', { keepStopwords: true }));
    const prose = (comment.body ?? '').toLowerCase();
    for (const rule of PRIORITY_RULES) {
      // A comment counts once per rule, however often the word appears.
      const hit = rule.terms.some((term) => tokens.has(term) || prose.includes(term));
      if (!hit) continue;
      scores.set(rule.label, (scores.get(rule.label) ?? 0) + 1);
      flaggedByLabel.set(rule.label, rule.flagged);
    }
  }

  return [...scores.entries()]
    .map(([label, hits]) => ({ label, hits, flagged: flaggedByLabel.get(label) ?? '' }))
    .filter((entry) => entry.hits >= 2)
    .sort((a, b) => b.hits - a.hits || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Raw trait counters behind a tone description. */
interface VoiceTraits {
  encouraging: number;
  questions: number;
  nits: number;
  snippets: number;
  imperative: number;
  comments: number;
  avgLength: number;
}

const ENCOURAGING = /thanks|thank you|nice|great|good catch|appreciate|love it|beautiful|🙏|❤️|🎉/i;
const IMPERATIVE = /^(?:add|remove|rename|update|move|revert|change|use|make|please|can you|could you|let's)\b/i;
const NIT = /\bnit\b|\bnits\b|\btiny\b|\bminor\b|\bsmall thing\b/i;

/** Measures how a reviewer sounds, from their own words. */
export function measureVoice(comments: ReviewComment[]): VoiceTraits {
  const traits: VoiceTraits = {
    encouraging: 0,
    questions: 0,
    nits: 0,
    snippets: 0,
    imperative: 0,
    comments: comments.length,
    avgLength: 0,
  };
  let length = 0;
  for (const comment of comments) {
    const body = comment.body ?? '';
    length += body.length;
    if (ENCOURAGING.test(body)) traits.encouraging += 1;
    if (isQuestion(body)) traits.questions += 1;
    if (NIT.test(body)) traits.nits += 1;
    if (body.includes('```')) traits.snippets += 1;
    if (IMPERATIVE.test(stripMarkdown(body).trim())) traits.imperative += 1;
  }
  traits.avgLength = comments.length === 0 ? 0 : Math.round(length / comments.length);
  return traits;
}

/** Turns the counters into a short, honest description of how they sound. */
export function describeTone(traits: VoiceTraits): string {
  const total = Math.max(1, traits.comments);
  const ratio = (n: number) => n / total;
  const parts: string[] = [];

  if (ratio(traits.questions) > 0.3) parts.push('asks as much as tells');
  if (ratio(traits.encouraging) > 0.12) parts.push('warm and encouraging');
  if (ratio(traits.imperative) > 0.35) parts.push('direct');
  if (ratio(traits.nits) > 0.1) parts.push('separates nits from blockers');
  if (traits.avgLength > 320) parts.push('writes it out in full');
  if (ratio(traits.snippets) > 0.08) parts.push('answers with snippets');

  if (parts.length === 0) {
    parts.push(ratio(traits.questions) > 0.15 ? 'measured and curious' : 'terse and factual');
  }
  return parts.slice(0, 3).join(', ');
}

/**
 * Mines the phrases a reviewer actually repeats.
 *
 * Comments are normalised, then 3..8 word windows are counted across the whole
 * history. Only phrases seen at least twice survive, which is what keeps this
 * from quoting a one-off sentence as a catchphrase.
 */
export function minePhrases(comments: ReviewComment[], limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    const prose = stripMarkdown(comment.body ?? '')
      .replace(/[`*_>#\[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (prose.length < 12) continue;
    const tokens = prose
      .split(' ')
      .map((word) => word.replace(/[^\w'?!-]/g, ''))
      .filter(Boolean);
    for (let size = 3; size <= 8; size += 1) {
      for (const gram of ngrams(tokens.map((t) => t.toLowerCase()), size)) {
        counts.set(gram, (counts.get(gram) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    // Longer repeated phrases beat short ones, then by frequency.
    .filter(([phrase, count]) => count >= 2 && phrase.split(' ').length >= 3)
    .sort((a, b) => {
      const scoreA = a[1] * Math.log(2 + a[0].split(' ').length);
      const scoreB = b[1] * Math.log(2 + b[0].split(' ').length);
      return scoreB - scoreA || a[0].localeCompare(b[0]);
    })
    // Drop any phrase contained inside one already chosen.
    .reduce<string[]>((kept, [phrase]) => {
      if (kept.length >= limit) return kept;
      if (kept.some((existing) => existing.includes(phrase) || phrase.includes(existing))) return kept;
      kept.push(phrase.charAt(0).toUpperCase() + phrase.slice(1));
      return kept;
    }, []);
}

/** The quotable comments: substantive, on-topic, spread across files. */
export function pickSamples(comments: ReviewComment[], limit = 8): PersonaSample[] {
  const scored = comments
    .filter((comment) => (comment.body ?? '').trim().length >= 40)
    .map((comment) => {
      const body = stripMarkdown(comment.body);
      const questionBonus = isQuestion(comment.body) ? 40 : 0;
      const snippetBonus = comment.body.includes('```') ? 30 : 0;
      const length = Math.min(body.length, 600);
      return { comment, body, score: length + questionBonus + snippetBonus };
    })
    .sort((a, b) => b.score - a.score);

  const perPath = new Map<string, number>();
  const samples: PersonaSample[] = [];
  for (const { comment, body } of scored) {
    if (samples.length >= limit) break;
    const seen = perPath.get(comment.path) ?? 0;
    if (seen >= 2) continue;
    perPath.set(comment.path, seen + 1);
    samples.push({
      prNumber: comment.prNumber,
      path: comment.path,
      body: truncate(body, 400),
      createdAt: comment.createdAt,
    });
  }
  return samples;
}

/** The files and directories a reviewer keeps returning to. */
export function topPathsOf(comments: ReviewComment[], limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    if (!comment.path) continue;
    counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1);
    const dir = comment.path.includes('/') ? comment.path.slice(0, comment.path.lastIndexOf('/')) : '';
    if (dir) counts.set(`${dir}/`, (counts.get(`${dir}/`) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([path]) => path);
}

/** Human-readable habits, still counted rather than guessed. */
function quirksOf(traits: VoiceTraits): string[] {
  const total = Math.max(1, traits.comments);
  const quirks: string[] = [];
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  if (traits.questions > 0) quirks.push(`asks a question in ${pct(traits.questions)} of their comments`);
  if (traits.snippets > 0) quirks.push(`writes out a snippet every ${Math.max(2, Math.round(total / traits.snippets))} comments`);
  if (traits.nits > 0) quirks.push(`marks nits explicitly in ${pct(traits.nits)} of comments`);
  if (traits.encouraging > 0) quirks.push(`says something kind in ${pct(traits.encouraging)} of comments`);
  if (quirks.length === 0) quirks.push('reviews in short, unadorned bursts');
  return quirks.slice(0, 3);
}

/** Stable emoji per login, so a ghost looks the same on every machine. */
const GHOST_EMOJIS = ['👻', '🕯️', '🪦', '🦴', '💀', '🔮', '⚰️', '🌫️', '🕸️', '🧿'];

function emojiFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return GHOST_EMOJIS[hash % GHOST_EMOJIS.length] ?? '👻';
}

export interface BuildPersonaOptions {
  maxSamples?: number;
  priorityLimit?: number;
}

/**
 * Builds one ghost from one reviewer's comment history.
 *
 * Every field is derived from the comments passed in, so two runs over the same
 * fetch produce an identical persona — which is what makes the demo repeatable
 * and the Hall of Fame numbers mean something.
 */
export function buildPersona(
  login: string,
  allComments: ReviewComment[],
  options: BuildPersonaOptions = {},
): GhostPersona {
  const { maxSamples = 8, priorityLimit = 4 } = options;
  const comments = allComments.filter((comment) => comment.user === login && (comment.body ?? '').trim());
  const traits = measureVoice(comments);
  const priorities = detectPriorities(comments, priorityLimit);
  const prNumbers = new Set(comments.map((comment) => comment.prNumber).filter(Boolean));
  const dates = comments.map((comment) => safeDate(comment.createdAt)).filter((date): date is string => Boolean(date));
  const firstSeen = dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : null;
  const lastSeen = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null;

  const flaggedPatterns =
    priorities.length > 0
      ? priorities.map((entry) => entry.flagged)
      : ['the thing everyone else missed'];

  const lead = priorities[0]?.label ?? 'the change as a whole';
  const blurb =
    `Resurrected from ${comments.length} review comments across ${prNumbers.size} PRs. ` +
    `Last seen ${shortDate(lastSeen)}. Watches ${lead} first.`;

  return {
    id: slugify(login),
    login,
    name: `Ghost of ${login}`,
    emoji: emojiFor(login),
    synthetic: false,
    blurb,
    tone: describeTone(traits),
    priorities: priorities.map((entry) => entry.label),
    commonPhrases: minePhrases(comments),
    flaggedPatterns,
    quirks: quirksOf(traits),
    sampleComments: pickSamples(comments, maxSamples),
    topPaths: topPathsOf(comments),
    commentCount: comments.length,
    firstSeen,
    lastSeen,
    source: 'heuristic',
  };
}

/**
 * The Ghost of Future You.
 *
 * It has no comments to mine, because it is not a reviewer — it is the repo's
 * own scar tissue. Its "voice" is taken from the fix and revert commits that
 * are already in the index, so when it speaks it is quoting a real commit
 * message with a real SHA behind it.
 */
export function buildFutureYouPersona(index: FixIndex | null): GhostPersona {
  const patterns = index?.patterns ?? [];
  const newest = [...patterns].sort((a, b) => b.date.localeCompare(a.date));
  const sampleComments: PersonaSample[] = newest.slice(0, 12).map((pattern) => ({
    prNumber: 0,
    path: pattern.files[0] ?? 'commit',
    body: `${pattern.shortSha} — ${pattern.message}`,
    createdAt: pattern.date,
  }));

  const dates = patterns.map((pattern) => pattern.date).filter(Boolean);
  const lastSeen = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null;

  return {
    id: 'ghost-future-you',
    login: 'future-you',
    name: 'Ghost of Future You',
    emoji: '🔮',
    synthetic: true,
    blurb:
      `Not a reviewer — the version of you who already fixed this. ` +
      `Speaks from ${patterns.length} fix and revert commits in ${index?.owner ?? 'the repo'}/${index?.repo ?? ''}.`,
    tone: 'forensic, unsentimental, quotes receipts',
    priorities: [
      'regressions this repository has already paid for',
      'error handling on every network call',
      'unbounded loops and effect cycles',
      'cleanup that was never written',
    ],
    commonPhrases: newest
      .slice(0, 5)
      .map((pattern) => pattern.message.replace(/^\w+(\([^)]*\))?:\s*/, '').trim())
      .filter(Boolean),
    flaggedPatterns: [
      'a pattern that has already caused a fix in this repository',
      'a failure path with nothing handling it',
    ],
    quirks: ['cites a commit for every claim', 'never speculates without evidence'],
    sampleComments,
    topPaths: [
      ...new Set(patterns.flatMap((pattern) => pattern.files.map((file) => file.split('/').slice(0, 3).join('/')))),
    ].slice(0, 5),
    commentCount: patterns.length,
    firstSeen: dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : null,
    lastSeen,
    source: 'commit-history',
  };
}



