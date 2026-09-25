import type { GhostPersona, PullRequestMeta } from './types.js';

/**
 * The bridge between a persona and the bot runtime.
 *
 * GitBot bots are defined by a name, an emoji, the harness to run on, a
 * permission mode, and a block of instructions appended to the harness' own
 * system prompt. That last field is where a ghost actually lives: this module
 * turns a persona into that text, and defines the machine-readable reply the
 * bridge parses back out of the agent's transcript.
 *
 * `permissionMode` values are the ones GitBot HQ accepts — `ask-permissions`,
 * `auto-approve`, `plan`. A ghost that only reads diffs should run in `plan`.
 */
export type GitBotPermissionMode = 'ask-permissions' | 'auto-approve' | 'plan';
export type GitBotAgent = 'claude-code' | 'codex' | 'opencode';

export interface GitBotBotInput {
  name: string;
  description: string;
  emoji: string;
  agent: GitBotAgent;
  instructions: string;
  repoPath?: string;
  permissionMode: GitBotPermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  setupInstructions?: string;
}

export interface BotSpecOptions {
  agent?: GitBotAgent;
  repoPath?: string;
  permissionMode?: GitBotPermissionMode;
}

/** A ghost that reviews a diff never needs to write to the repository. */
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(gh pr *)', 'Bash(git log *)', 'Bash(git diff *)'];

/**
 * Renders the persona as the standing instruction block for a bot.
 * The numbering is deliberate: harnesses follow later, numbered rules best.
 */
export function personaInstructions(persona: GhostPersona): string {
  const lines: string[] = [];
  lines.push(`# You are ${persona.name} ${persona.emoji}`);
  lines.push('');
  lines.push(
    `You are the resurrected reviewing voice of the GitHub user \`${persona.login}\`. ` +
      `You are not a general-purpose assistant: you are one reviewer, with one history, and your value is that you notice what they noticed.`,
  );
  if (persona.blurb) lines.push(`\n${persona.blurb}`);
  lines.push(`\nYour tone: ${persona.tone}.`);

  if (persona.priorities.length > 0) {
    lines.push('\n## What you always look at first');
    for (const priority of persona.priorities) lines.push(`- ${priority}`);
  }
  if (persona.flaggedPatterns.length > 0) {
    lines.push('\n## What you flag');
    for (const pattern of persona.flaggedPatterns) lines.push(`- ${pattern}`);
  }
  if (persona.commonPhrases.length > 0) {
    lines.push('\n## Things you actually said, and still say');
    for (const phrase of persona.commonPhrases) lines.push(`- "${phrase}"`);
  }
  if (persona.sampleComments.length > 0) {
    lines.push('\n## Your own past comments, verbatim');
    for (const sample of persona.sampleComments.slice(0, 5)) {
      lines.push(
        `- On \`${sample.path}\` in PR #${sample.prNumber}: "${sample.body.replace(/\s+/g, ' ').slice(0, 220)}"`,
      );
    }
  }
  if (persona.quirks.length > 0) {
    lines.push('\n## Your habits');
    for (const quirk of persona.quirks) lines.push(`- You ${quirk}.`);
  }

  lines.push(`
## Rules of engagement
1. Review only what is in the diff you are given. Never invent a file, a line or a historical commit.
2. You may quote the commits you are given as evidence. If you have no evidence, say what you suspect and how confident you are — do not dress a guess up as a fact.
3. Write like a person leaving a code review, not like a linter. One paragraph is usually enough.
4. Never approve a change you did not read. Never block on taste.
5. If the diff touches nothing you care about, say so plainly and approve. That is a valid review.
6. Finish your reply with the JSON block described below, and nothing after it.`);

  lines.push(`
## Required output
Reply with your review as prose, then end with exactly one fenced block in this shape:

\`\`\`json
{
  "severity": "nit | concern | bug | blocker",
  "path": "the file you are commenting on",
  "line": 42,
  "comment": "the review comment, in your voice",
  "vote": "approve | request_changes | block",
  "confidence": 0.0
}
\`\`\`

\`severity\` says how bad it is, \`vote\` says what you would do about it. A \`blocker\` is a veto and ends the PR, so reserve it for something that will break in production.`);

  return lines.join('\n');
}

/** The GitBot `/bots` payload for a persona. */
export function botSpecForPersona(persona: GhostPersona, options: BotSpecOptions = {}): GitBotBotInput {
  const { agent = 'claude-code', repoPath, permissionMode = 'plan' } = options;
  const bot: GitBotBotInput = {
    name: persona.name,
    description: persona.blurb || `${persona.tone} — resurrected reviewer`,
    emoji: persona.emoji,
    agent,
    instructions: personaInstructions(persona),
    permissionMode,
    allowedTools: READ_ONLY_TOOLS,
    disallowedTools: ['Write', 'Edit', 'NotebookEdit'],
    setupInstructions:
      'Confirm the GitHub CLI is authenticated (run `gh auth status`) so you can read pull requests and commit history. ' +
      'Report the account you are signed in as, then mark this setup complete.',
  };
  if (repoPath) bot.repoPath = repoPath;
  return bot;
}

/** The prompt that asks a live ghost to review a PR. */
export function reviewPrompt(params: {
  persona: GhostPersona;
  pr: PullRequestMeta;
  diff: string;
  evidenceBlock?: string;
}): string {
  const { persona, pr, diff, evidenceBlock } = params;
  const clipped = diff.length > 60_000 ? `${diff.slice(0, 60_000)}\n… [diff truncated]` : diff;
  const parts = [
    `Review pull request #${pr.number} in ${pr.url}`,
    `Title: ${pr.title}`,
    `Author: ${pr.author}`,
    `Base: ${pr.baseRef} ← ${pr.headRef}`,
    pr.body ? `Description:\n${pr.body.slice(0, 1200)}` : '',
    '',
    'Changes:',
    '```diff',
    clipped,
    '```',
  ].filter(Boolean);

  if (evidenceBlock) {
    parts.push('', 'Fix and revert commits from this repository that may be relevant:', evidenceBlock);
  }
  parts.push(
    '',
    `Stay in character as ${persona.name}. Anchor your comment to a file and line in this diff, and end with the JSON block.`,
  );
  return parts.join('\n');
}

/** The prompt used by the Séance command. */
export function seancePrompt(params: { persona: GhostPersona; question: string; history: string }): string {
  const { persona, question, history } = params;
  return [
    `You are ${persona.name} ${persona.emoji}, answering a question about decisions this repository made in the past.`,
    '',
    'Your own past review comments:',
    history || '(none retrieved)',
    '',
    `Question: ${question}`,
    '',
    'Answer in your own voice, in under 200 words. Cite the pull request numbers above when they are relevant. ' +
      'If your past comments do not answer the question, say so, and answer from what you care about instead.',
  ].join('\n');
}

/** Pulls the trailing JSON block out of an agent's reply, if it wrote one. */
export function extractFindingJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  for (const block of blocks.reverse()) {
    const body = block[1]?.trim();
    if (!body || !body.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === 'object' && 'severity' in (parsed as Record<string, unknown>)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not this block; keep looking backwards through the reply.
    }
  }
  // Some harnesses drop the fence but keep the object.
  const bare = text.match(/\{[\s\S]*"severity"[\s\S]*\}/);
  if (bare) {
    try {
      return JSON.parse(bare[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/** The agent's prose, with the machine-readable block stripped off. */
export function proseWithoutJson(text: string): string {
  return text
    .replace(/```(?:json)?\s*\n[\s\S]*?```/g, '')
    .replace(/\{[\s\S]*"severity"[\s\S]*\}\s*$/g, '')
    .trim();
}


