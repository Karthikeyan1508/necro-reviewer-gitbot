import type { GhostPersona, SeanceAnswer, SeanceCitation } from './types.js';
import { tokenizeStemmed, truncate } from './text.js';

/**
 * The Séance: `/seance @ghost-alice why did we use this pattern?`
 *
 * Retrieval over the reviewer's own comments — no network, no model call, so
 * the answer always comes back instantly and always cites something real. The
 * ghost is answering from its own record, which is the whole conceit: it can
 * only tell you what it actually argued at the time.
 */

/** Retained from the persona's samples, scored by overlap with the question. */
export function retrieveCitations(persona: GhostPersona, question: string, limit = 3): SeanceCitation[] {
  const questionTokens = new Set(tokenizeStemmed(question));
  if (questionTokens.size === 0) return [];

  // Rarity across the persona's own samples stands in for idf.
  const df = new Map<string, number>();
  for (const sample of persona.sampleComments) {
    for (const token of new Set(tokenizeStemmed(sample.body))) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const total = Math.max(1, persona.sampleComments.length);
  const idf = (token: string): number => Math.log(1 + total / (1 + (df.get(token) ?? 0)));

  const scored = persona.sampleComments
    .map((sample) => {
      const tokens = new Set(tokenizeStemmed(sample.body));
      let score = 0;
      for (const token of questionTokens) if (tokens.has(token)) score += idf(token);
      // A comment that mentions the file or PR in question wins ties.
      const haystack = `${sample.path} pr ${sample.prNumber} ${sample.body}`.toLowerCase();
      for (const token of questionTokens) if (haystack.includes(token)) score += 0.35;
      return { sample, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.sample.prNumber - b.sample.prNumber)
    .slice(0, limit);

  return scored.map(({ sample }) => ({
    prNumber: sample.prNumber,
    path: sample.path,
    excerpt: truncate(sample.body, 260),
    createdAt: sample.createdAt,
  }));
}

/** Which shape of question is being asked, so the stance reads right. */
export type QuestionShape = 'why' | 'should' | 'what-broke' | 'who' | 'open';

export function classifyQuestion(question: string): QuestionShape {
  const text = question.toLowerCase();
  if (/\bwhy\b|\breason\b|\brationale\b|\bwhat made you\b/.test(text)) return 'why';
  if (/\bshould\b|\bwould you\b|\bdo you still\b|\bchange it\b|\breconsider\b/.test(text)) return 'should';
  if (/\bbroke\b|\bbug\b|\bregress|\bfail|\bincident\b/.test(text)) return 'what-broke';
  if (/\bwho\b|\bwho decided\b|\bwho wrote\b/.test(text)) return 'who';
  return 'open';
}

/** The stance the ghost takes, given what it has always cared about. */
function stance(shape: QuestionShape, persona: GhostPersona): string {
  const lead = persona.priorities[0] ?? 'the change as a whole';
  switch (shape) {
    case 'why':
      return `My reason was always ${lead}. If the change still buys that, the reason still holds.`;
    case 'should':
      return `Ask whether it still holds ${lead} up. If it does, leave it alone — I argued for it once and I would again.`;
    case 'what-broke':
      return `What broke will be in the fix commits. I only ever cared that ${lead} survived the change; check whether it did.`;
    case 'who':
      return 'I cannot tell you who wrote it — I can only tell you what I said about it at the time.';
    default:
      return `Weigh it against ${lead}. That is the axis I used every time I reviewed this area.`;
  }
}

/** Opening line, in the ghost's own register. */
function opener(shape: QuestionShape, persona: GhostPersona): string {
  const phrase = persona.commonPhrases[0];
  const base =
    shape === 'why'
      ? 'I remember this one.'
      : shape === 'should'
        ? 'Let me answer that the way I answered it then.'
        : 'Here is what I have on that.';
  return phrase ? `${phrase} — ${base}` : base;
}

/**
 * Answers a question from the ghost's own history.
 *
 * Returns citations whether or not the retrieval found anything, so the UI can
 * always show the receipts it reasoned from — including the honest case where
 * there were none.
 */
export function seanceAnswer(params: {
  persona: GhostPersona;
  question: string;
  /** Overrides the persona's stored samples, e.g. after a fresh fetch. */
  samples?: GhostPersona['sampleComments'];
}): SeanceAnswer {
  const { question } = params;
  const persona: GhostPersona = params.samples
    ? { ...params.persona, sampleComments: params.samples }
    : params.persona;
  const citations = retrieveCitations(persona, question);
  const shape = classifyQuestion(question);

  const lines: string[] = [opener(shape, persona)];

  if (citations.length > 0) {
    const top = citations[0]!;
    const where = top.prNumber > 0 ? `PR #${top.prNumber}` : `commit ${top.excerpt.slice(0, 7)}`;
    lines.push(`I said this on \`${top.path}\` in ${where}: "${truncate(top.excerpt, 220)}"`);
    if (citations.length > 1) {
      const more = citations
        .slice(1)
        .map((citation) =>
          citation.prNumber > 0 ? `#${citation.prNumber}` : citation.excerpt.slice(0, 7),
        )
        .join(', ');
      lines.push(`Same argument again in ${more}.`);
    }
  } else {
    lines.push('I have nothing in my own comments that answers this directly, so I will not pretend otherwise.');
  }

  lines.push(stance(shape, persona));

  return {
    ghostId: persona.id,
    ghostName: persona.name,
    emoji: persona.emoji,
    question,
    answer: lines.join('\n\n'),
    citations,
    live: false,
    sessionId: null,
    createdAt: new Date().toISOString(),
  };
}

/** Formats citations as the history block a live séance prompt is given. */
export function citationHistory(citations: SeanceCitation[]): string {
  return citations.map((citation) => `- PR #${citation.prNumber} on ${citation.path}: "${citation.excerpt}"`).join('\n');
}

/**
 * The `/seance` command parser, for the Slack-style surface.
 *
 * The ghost is addressed either as `@ghost-alice` or as a bare `ghost-alice`
 * slug. Anything else after the command is the question — so
 * `/seance what about this?` asks the council, it does not address a ghost
 * called "what". Returns null when the text is not a séance command.
 */
export function parseSeanceCommand(text: string): { ghostSlug: string | null; question: string } | null {
  const match = text.trim().match(/^\/seance\b([\s\S]*)$/i);
  if (!match) return null;

  let rest = (match[1] ?? '').trim();
  let ghostSlug: string | null = null;

  const target = rest.match(/^@?(ghost-[\w-]+)(?:\s+|$)/i);
  if (target?.[1]) {
    ghostSlug = target[1].toLowerCase();
    rest = rest.slice(target[0].length).trim();
  }

  return { ghostSlug, question: rest };
}

