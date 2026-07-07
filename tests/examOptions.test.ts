import assert from 'node:assert/strict';
import test from 'node:test';
import { fisherYatesShuffleInPlace } from '../lib/shuffle.ts';
import {
  getDisplayedOptions,
  isCorrectAnswer,
  shuffleOptionIdsForAttempt
} from '../lib/examOptions.ts';
import type { Question } from '../types.ts';

const makeQuestion = (): Question => ({
  id: 'q1',
  subject: 'Biology',
  topic: 'Cells',
  text: 'Which option is correct?',
  options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
  correctAnswerIndex: 2,
  optionChoices: [
    { id: 'a-stable', text: 'Alpha' },
    { id: 'b-stable', text: 'Beta' },
    { id: 'c-stable', text: 'Gamma' },
    { id: 'd-stable', text: 'Delta' }
  ],
  correctOptionId: 'c-stable',
  createdBy: 'test',
  createdAt: '2026-07-07T00:00:00.000Z'
});

test('Fisher-Yates produces a valid in-place permutation', () => {
  const source = ['a', 'b', 'c', 'd'];
  const shuffled = fisherYatesShuffleInPlace(source, () => 0);

  assert.equal(shuffled, source);
  assert.deepEqual([...shuffled].sort(), ['a', 'b', 'c', 'd']);
  assert.equal(new Set(shuffled).size, 4);
});

test('scoring is correct regardless of shuffled option position', () => {
  const question = makeQuestion();
  const order = ['d-stable', 'a-stable', 'c-stable', 'b-stable'];
  const displayed = getDisplayedOptions(question, order);

  assert.equal(displayed[2].id, 'c-stable');
  assert.equal(isCorrectAnswer(question, displayed[2].id), true);
  assert.equal(isCorrectAnswer(question, displayed[0].id), false);
});

test('consecutive attempts can produce different option orderings for the same question', () => {
  const question = makeQuestion();
  const first = shuffleOptionIdsForAttempt(question, () => 0).join('|');
  const second = shuffleOptionIdsForAttempt(question, () => 0.75).join('|');

  assert.notEqual(first, second);
  assert.deepEqual(first.split('|').sort(), second.split('|').sort());
});
