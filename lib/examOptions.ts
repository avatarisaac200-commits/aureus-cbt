import type { AnswerOption, Question } from '../types.ts';
import { fisherYatesShuffle } from './shuffle.ts';

export const legacyOptionId = (index: number) => `opt_${index}`;

export const getQuestionOptions = (question: Question): AnswerOption[] => {
  if (Array.isArray(question.optionChoices) && question.optionChoices.length > 0) {
    return question.optionChoices
      .filter(option => option && String(option.id || '').trim())
      .map(option => ({ id: String(option.id), text: String(option.text || '') }));
  }

  return (question.options || []).map((text, index) => ({
    id: legacyOptionId(index),
    text: String(text || '')
  }));
};

export const buildOptionChoices = (options: string[]): AnswerOption[] => {
  return options.map((text, index) => ({ id: legacyOptionId(index), text: String(text || '') }));
};

export const buildOptionMetadata = (options: string[], correctAnswerIndex: number) => ({
  optionChoices: buildOptionChoices(options),
  correctOptionId: legacyOptionId(Number(correctAnswerIndex || 0))
});

export const getCorrectOptionId = (question: Question): string => {
  return question.correctOptionId || legacyOptionId(Number(question.correctAnswerIndex || 0));
};

export const getDisplayedOptions = (question: Question, optionOrder?: string[]): AnswerOption[] => {
  const options = getQuestionOptions(question);
  if (!optionOrder || optionOrder.length === 0) return options;

  const byId = new Map(options.map(option => [option.id, option]));
  const ordered = optionOrder
    .map(id => byId.get(id))
    .filter((option): option is AnswerOption => Boolean(option));

  return ordered.length === options.length ? ordered : options;
};

export const shuffleOptionIdsForAttempt = (question: Question, rng: () => number = Math.random): string[] => {
  return fisherYatesShuffle(getQuestionOptions(question).map(option => option.id), rng);
};

export const isCorrectAnswer = (question: Question, answer: number | string | undefined): boolean => {
  if (answer === undefined) return false;
  if (typeof answer === 'number') return answer === Number(question.correctAnswerIndex);
  return String(answer) === getCorrectOptionId(question);
};

export const getAnswerIndexForAnalytics = (
  question: Question,
  answer: number | string | undefined,
  optionOrder?: string[]
): number => {
  if (answer === undefined) return -1;
  if (typeof answer === 'number') return answer;

  const displayed = getDisplayedOptions(question, optionOrder);
  return displayed.findIndex(option => option.id === answer);
};
