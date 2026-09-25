import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { citationHistory, classifyQuestion, parseSeanceCommand, retrieveCitations, seanceAnswer } from '../src/seance.js';
import { buildPersona } from '../src/persona.js';
import { allComments } from './fixtures.js';

const ALICE = buildPersona('alice', allComments());
const BOB = buildPersona('bob', allComments());

describe('the seance', () => {
  it('retrieves the reviewer own comments for the question', () => {
    const citations = retrieveCitations(ALICE, 'what about the stories?');
    assert.ok(citations.length > 0);
    assert.ok(citations.every((citation) => citation.prNumber > 0));
    assert.ok(citations[0]!.excerpt.length <= 261);
  });

  it('answers in character and cites the PR it is quoting', () => {
    const answer = seanceAnswer({ persona: ALICE, question: 'why did we insist on stories?' });
    assert.equal(answer.ghostId, ALICE.id);
    assert.match(answer.answer, /PR #\d+/);
    assert.ok(answer.citations.length > 0);
    assert.equal(answer.live, false);
    assert.equal(answer.sessionId, null);
    assert.ok(answer.createdAt);
  });

  it('admits when the record has nothing to say', () => {
    const answer = seanceAnswer({ persona: ALICE, question: 'zygomorphic quokka telemetry' });
    assert.match(answer.answer, /nothing in my own comments|I will not pretend/i);
    assert.deepEqual(answer.citations, []);
  });

  it('classifies the shape of the question', () => {
    assert.equal(classifyQuestion('why did we do this?'), 'why');
    assert.equal(classifyQuestion('would you still do it this way?'), 'should');
    assert.equal(classifyQuestion('what broke last time?'), 'what-broke');
    assert.equal(classifyQuestion('who wrote this?'), 'who');
    assert.equal(classifyQuestion('thoughts?'), 'open');
  });

  it('parses the /seance command surface', () => {
    const parsed = parseSeanceCommand('/seance @ghost-alice why the fallback?');
    assert.equal(parsed?.ghostSlug, 'ghost-alice');
    assert.equal(parsed?.question, 'why the fallback?');
    assert.equal(parseSeanceCommand('hello there'), null);
    assert.equal(parseSeanceCommand('/seance what about this?')?.ghostSlug, null);
  });

  it('formats citations for a live prompt', () => {
    const history = citationHistory(retrieveCitations(ALICE, 'stories'));
    assert.match(history, /^- PR #\d+/m);
  });

  it('can answer from a fresh set of samples', () => {
    const answer = seanceAnswer({
      persona: BOB,
      question: 'why the retry?',
      samples: [
        { prNumber: 999, path: 'src/x.ts', body: 'Please add a retry with a timeout.', createdAt: '2025-03-01' },
      ],
    });
    assert.match(answer.answer, /PR #999/);
  });

  it('returns no citations for an empty question', () => {
    assert.deepEqual(retrieveCitations(ALICE, ''), []);
  });
});
