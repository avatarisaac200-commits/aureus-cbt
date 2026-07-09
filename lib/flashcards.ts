import { Flashcard, FlashcardConfidence, Question } from '../types';
import { getCorrectOptionId, getDisplayedOptions } from './examOptions';

const CONFIDENCE_INTERVAL_DAYS: Record<FlashcardConfidence, number> = {
  again: 1,
  hard: 2,
  good: 4,
  easy: 7
};

const stripMarkup = (value: string) => {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const getFlashcardProgressId = (userId: string, flashcardId: string) => `${userId}_${flashcardId}`;

export const getNextReviewAt = (confidence: FlashcardConfidence, now = new Date()) => {
  const next = new Date(now);
  next.setDate(next.getDate() + CONFIDENCE_INTERVAL_DAYS[confidence]);
  return next.toISOString();
};

export const buildFlashcardFromQuestion = (
  question: Question,
  source?: { testId?: string; testName?: string }
): Flashcard | null => {
  const front = stripMarkup(question.text);
  if (!question.id || !front) return null;

  const correctOptionId = getCorrectOptionId(question);
  const displayedOptions = getDisplayedOptions(question);
  const correctOption = displayedOptions.find((option, index) => option.id === correctOptionId || index === question.correctAnswerIndex);
  const answer = stripMarkup(correctOption?.text || question.options?.[question.correctAnswerIndex] || '');
  if (!answer) return null;

  return {
    id: `question_${question.id}`,
    sourceQuestionId: question.id,
    sourceTestId: source?.testId,
    sourceTestName: source?.testName,
    subject: question.subject || 'General',
    topic: question.topic || 'Mixed Practice',
    front,
    back: answer,
    explanation: stripMarkup(question.explanation || ''),
    tags: question.tags || [],
    difficulty: question.difficulty
  };
};

export const buildFlashcardsFromQuestions = (
  questions: Question[],
  source?: { testId?: string; testName?: string }
) => {
  return questions
    .map((question) => buildFlashcardFromQuestion(question, source))
    .filter((card): card is Flashcard => Boolean(card));
};

export const sortFlashcardsForStudy = (cards: Flashcard[], progressByCardId: Record<string, { nextReviewAt?: string; reviewCount?: number }>) => {
  const now = Date.now();
  return [...cards].sort((a, b) => {
    const aProgress = progressByCardId[a.id];
    const bProgress = progressByCardId[b.id];
    const aDue = !aProgress?.nextReviewAt || Date.parse(aProgress.nextReviewAt) <= now;
    const bDue = !bProgress?.nextReviewAt || Date.parse(bProgress.nextReviewAt) <= now;
    if (aDue !== bDue) return aDue ? -1 : 1;
    return (aProgress?.reviewCount || 0) - (bProgress?.reviewCount || 0);
  });
};
