import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  botSpecForPersona,
  extractFindingJson,
  personaInstructions,
  proseWithoutJson,
  reviewPrompt,
  seancePrompt,
} from '../src/ghostPrompt.js';
import { buildPersona } from '../src/persona.js';
import type { PullRequestMeta } from '../src/types.js';
import { allComments } from './fixtures.js';

const ALICE = buildPersona('alice', allComments());
const BOB = buildPersona('bob', allComments());

describe('gitbot bot specification', () => {
  it('uses a permission mode GitBot actually accepts', () => {
    const spec = botSpecForPersona(ALICE);
    assert.ok(['ask-permissions', 'auto-approve', 'plan'].includes(spec.permissionMode));
    assert.equal(spec.permissionMode, 'plan');
  });

  it('names the bot, gives it an emoji and a harness', () => {
    const spec = botSpecForPersona(ALICE, { agent: 'claude-code', repoPath: 'C:/repo' });
    assert.equal(spec.name, 'Ghost of alice');
    assert.equal(spec.emoji, ALICE.emoji);
    assert.equal(spec.agent, 'claude-code');
    assert.equal(spec.repoPath, 'C:/repo');
  });

  it('fences a reviewing ghost out of the working tree', () => {
    const spec = botSpecForPersona(ALICE);
    assert.ok(spec.disallowedTools?.includes('Write'));
    assert.ok(spec.disallowedTools?.includes('Edit'));
    assert.ok((spec.allowedTools ?? []).includes('Read'));
  });

  it('declares setup steps, which is how GitBot knows to make a setup thread', () => {
    const spec = botSpecForPersona(ALICE);
    assert.match(spec.setupInstructions ?? '', /gh auth status/);
  });
});

describe('ghost instructions', () => {
  const text = personaInstructions(ALICE);

  it('carries the persona voice into the system prompt', () => {
    assert.match(text, /You are Ghost of alice/);
    assert.ok(text.includes(ALICE.tone));
    for (const priority of ALICE.priorities) assert.ok(text.includes(priority));
  });

  it('quotes the reviewer past comments verbatim', () => {
    assert.match(text, /Your own past comments/);
    assert.ok(text.includes(ALICE.sampleComments[0]!.path));
    assert.match(text, /PR #\d+/);
  });

  it('forbids inventing evidence and requires the JSON block', () => {
    assert.match(text, /Never invent a file, a line or a historical commit/);
    assert.match(text, /"severity"/);
    assert.match(text, /"vote"/);
  });

  it('works for a persona with no phrases at all', () => {
    const bare = personaInstructions({ ...ALICE, commonPhrases: [], sampleComments: [], priorities: [], quirks: [] });
    assert.match(bare, /Rules of engagement/);
  });
});

describe('review and seance prompts', () => {
  const pr: PullRequestMeta = {
    number: 42,
    title: 'fix: thing',
    author: 'someone',
    url: 'https://github.com/o/r/pull/42',
    baseRef: 'main',
    headRef: 'patch',
    body: 'body',
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    source: 'github',
  };

  it('includes the PR metadata and the diff', () => {
    const prompt = reviewPrompt({ persona: ALICE, pr, diff: '+const a = 1;\n' });
    assert.ok(prompt.includes('#42'));
    assert.ok(prompt.includes('+const a = 1;'));
    assert.match(prompt, /Stay in character as Ghost of alice/);
  });

  it('clips an enormous diff instead of blowing the context window', () => {
    const prompt = reviewPrompt({ persona: ALICE, pr, diff: 'x'.repeat(120_000) });
    assert.ok(prompt.length < 70_000);
    assert.ok(prompt.includes('[diff truncated]'));
  });

  it('passes evidence to the ghost when there is history', () => {
    const prompt = reviewPrompt({ persona: ALICE, pr, diff: 'x', evidenceBlock: '- abc1234 fix: thing' });
    assert.ok(prompt.includes('abc1234'));
  });

  it('asks the seance question in character', () => {
    const prompt = seancePrompt({ persona: BOB, question: 'why the fallback?', history: '- PR #1: nothing' });
    assert.ok(prompt.includes('why the fallback?'));
    assert.match(prompt, /You are Ghost of bob/);
  });
});

describe('reading a live ghost reply', () => {
  it('extracts the JSON block a live ghost ends with', () => {
    const reply = [
      'This fetch has no error handling.',
      '',
      '```json',
      '{ "severity": "bug", "path": "src/a.ts", "line": 12, "comment": "add try/catch", "vote": "request_changes", "confidence": 0.8 }',
      '```',
    ].join('\n');
    const parsed = extractFindingJson(reply);
    assert.equal(parsed?.severity, 'bug');
    assert.equal(parsed?.line, 12);
    assert.equal(proseWithoutJson(reply), 'This fetch has no error handling.');
  });

  it('ignores JSON that is not a finding', () => {
    assert.equal(extractFindingJson('```json\n{"hello":"world"}\n```'), null);
  });

  it('does not throw on prose with no block, or on nothing at all', () => {
    assert.equal(extractFindingJson('just prose'), null);
    assert.equal(extractFindingJson(''), null);
    assert.equal(proseWithoutJson(''), '');
  });

  it('recovers a bare object when the harness drops the fence', () => {
    const parsed = extractFindingJson('prose { "severity": "nit", "comment": "c" }');
    assert.equal(parsed?.severity, 'nit');
  });
});
