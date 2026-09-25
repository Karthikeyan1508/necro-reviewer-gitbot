import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildFutureYouPersona,
  buildPersona,
  describeTone,
  detectPriorities,
  measureVoice,
  minePhrases,
  pickSamples,
  rankReviewers,
  slugify,
  topPathsOf,
} from '../src/persona.js';
import { buildFixIndex } from '../src/fixIndex.js';
import { ALICE_COMMENTS, BOB_COMMENTS, COMMITS, allComments } from './fixtures.js';

describe('reviewer ranking', () => {
  it('ranks by comment volume and reports the window they were active in', () => {
    const ranked = rankReviewers(allComments());
    assert.equal(ranked[0]!.login, 'alice');
    assert.equal(ranked[0]!.comments, ALICE_COMMENTS.length);
    assert.ok(ranked[0]!.firstSeen!.startsWith('2025-01-02'));
    assert.ok(ranked[0]!.lastSeen!.startsWith('2025-01-09'));
    assert.ok(ranked[0]!.reviewedPaths >= 2);
  });

  it('ignores bots and empty logins', () => {
    const ranked = rankReviewers([
      ...allComments(),
      { id: 1, prNumber: 1, prUrl: '', path: 'a.ts', line: 1, user: 'dependabot[bot]', body: 'x', createdAt: '2025-01-01T00:00:00Z' },
    ]);
    assert.ok(!ranked.some((entry) => entry.login.includes('[bot]')));
  });
});

describe('persona extraction', () => {
  const alice = buildPersona('alice', allComments());
  const bob = buildPersona('bob', allComments());

  it('builds a stable id and a readable name', () => {
    assert.equal(alice.id, 'ghost-alice');
    assert.equal(alice.name, 'Ghost of alice');
    assert.equal(slugify('Jonnie_Bigodes'), 'ghost-jonnie-bigodes');
    assert.equal(alice.synthetic, false);
    assert.equal(alice.source, 'heuristic');
  });

  it('names the concerns the reviewer actually raised', () => {
    assert.ok(alice.priorities.includes('story coverage'), alice.priorities.join(','));
    assert.ok(alice.priorities.includes('test coverage'));
    assert.ok(bob.priorities.includes('error handling'), bob.priorities.join(','));
    assert.ok(!bob.priorities.includes('story coverage'));
  });

  it('describes the voice from measured traits', () => {
    assert.ok(alice.tone.length > 3);
    const traits = measureVoice(ALICE_COMMENTS);
    // Four of Alice's eight comments are questions; the rest are statements.
    assert.equal(traits.questions, 4);
    assert.equal(traits.comments, 8);
    assert.ok(describeTone(traits).includes('asks as much as tells'));
  });

  it('mines phrases that really repeat, and nothing that does not', () => {
    const phrases = minePhrases(ALICE_COMMENTS);
    assert.ok(phrases.length > 0);
    assert.ok(phrases.every((phrase) => phrase === phrase.trim()));
    assert.ok(phrases.every((phrase) => !phrase.includes('  ')));
    assert.deepEqual(minePhrases([]), []);
  });

  it('keeps quotable samples and spreads them across files', () => {
    const samples = pickSamples(ALICE_COMMENTS, 4);
    assert.ok(samples.length > 0);
    assert.ok(samples.length <= 4);
    assert.ok(samples.every((sample) => sample.prNumber > 0));
    assert.ok(samples.every((sample) => sample.body.length <= 400));
    const perPath = new Map<string, number>();
    for (const sample of samples) perPath.set(sample.path, (perPath.get(sample.path) ?? 0) + 1);
    assert.ok([...perPath.values()].every((count) => count <= 2));
  });

  it('remembers where the reviewer spent their time', () => {
    const paths = topPathsOf(ALICE_COMMENTS);
    assert.ok(paths.length > 0);
    assert.ok(paths.some((path) => path.includes('Button')));
  });

  it('counts the PRs and comments it was resurrected from', () => {
    assert.equal(alice.commentCount, ALICE_COMMENTS.length);
    assert.match(alice.blurb, /Resurrected from \d+ review comments/);
    assert.ok(alice.blurb.includes('Watches'));
    assert.ok(alice.quirks.length > 0);
  });

  it('never throws on a reviewer with nothing to work from', () => {
    const empty = buildPersona('nobody', []);
    assert.equal(empty.commentCount, 0);
    assert.deepEqual(empty.priorities, []);
    assert.ok(empty.flaggedPatterns.length > 0, 'a fallback beat is better than none');
    assert.equal(empty.firstSeen, null);
  });

  it('returns only the priorities with real support', () => {
    const priorities = detectPriorities(ALICE_COMMENTS);
    assert.ok(priorities.length <= 4);
    assert.ok(priorities.every((entry) => entry.hits >= 2));
  });
});

describe('the synthetic future-you persona', () => {
  const index = buildFixIndex({ owner: 'storybookjs', repo: 'storybook', commits: COMMITS });
  const persona = buildFutureYouPersona(index);

  it('is marked synthetic and speaks from commit history', () => {
    assert.equal(persona.id, 'ghost-future-you');
    assert.equal(persona.synthetic, true);
    assert.equal(persona.source, 'commit-history');
    assert.equal(persona.emoji, '🔮');
  });

  it('quotes real commit messages instead of invented phrases', () => {
    const messages = index.patterns.map((pattern) => pattern.message);
    assert.ok(persona.commonPhrases.length > 0);
    assert.ok(persona.commonPhrases.every((phrase) => messages.some((message) => message.includes(phrase))));
    assert.ok(persona.sampleComments.every((sample) => /\b[0-9a-f]{7}\b/.test(sample.body)));
  });

  it('survives a missing index', () => {
    const bare = buildFutureYouPersona(null);
    assert.equal(bare.commentCount, 0);
    assert.deepEqual(bare.sampleComments, []);
    assert.equal(bare.lastSeen, null);
  });
});
