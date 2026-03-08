import React from 'react';
import { ExamResult } from '../types';
import ScoreBadge from './ui/ScoreBadge';

interface ResultScreenProps {
  result: ExamResult;
  onClose: () => void;
  onReview: () => void;
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

const ResultScreen: React.FC<ResultScreenProps> = ({ result, onClose, onReview }) => {
  const percentage = clamp(Math.round((result.score / Math.max(result.maxScore || 1, 1)) * 100));
  const answeredQuestionCount = result.answeredQuestionCount ?? Object.keys(result.userAnswers || {}).length;
  const correctAnsweredCount = result.correctAnsweredCount ?? 0;
  const answeredAccuracy = answeredQuestionCount > 0
    ? Math.round((correctAnsweredCount / answeredQuestionCount) * 100)
    : 0;

  const bandClass = percentage >= 70 ? 'score-high' : percentage >= 40 ? 'score-mid' : 'score-low';
  const ringColor = percentage >= 70 ? 'var(--emerald)' : percentage >= 40 ? 'var(--gold)' : 'var(--rose)';
  const ringStyle = {
    background: `conic-gradient(${ringColor} ${percentage}%, var(--edge) ${percentage}% 100%)`
  };

  const message = percentage >= 70
    ? "Excellent work - you're on track."
    : percentage >= 40
      ? 'Good effort - review the flagged areas.'
      : 'Keep practicing - use the review tool to identify weak points.';

  return (
    <div className="v2-page min-h-screen flex items-center justify-center p-4 md:p-8 safe-top safe-bottom">
      <div className="w-full max-w-[520px] card">
        <div className="flex flex-col items-center text-center">
          <div className="w-44 h-44 rounded-full p-2" style={ringStyle}>
            <div className="w-full h-full rounded-full bg-[var(--surface)] border border-[var(--edge)] flex flex-col items-center justify-center">
              <p className="text-xs text-[var(--muted)] uppercase tracking-widest mb-1">Score</p>
              <span className={`font-display text-5xl font-extrabold ${bandClass}`}>{percentage}%</span>
            </div>
          </div>
          <p className="mt-4 text-sm text-[var(--muted)]">You scored {result.score} out of {result.maxScore}</p>
          <p className={`mt-2 text-sm font-semibold ${bandClass}`}>{message}</p>
        </div>

        <div className="mt-6 p-4 rounded-xl border border-[var(--edge)] bg-[var(--panel-2)]">
          <p className="section-label mb-2">Answered Accuracy</p>
          <div className="flex items-center justify-between">
            <ScoreBadge value={answeredAccuracy} />
            <p className="text-sm text-[var(--muted)]">{correctAnsweredCount} correct / {answeredQuestionCount} answered</p>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <p className="section-label">Section Scores</p>
          {result.sectionBreakdown.map((sec, i) => {
            const pct = clamp(Math.round((sec.score / Math.max(sec.total || 1, 1)) * 100));
            return (
              <div key={`${sec.sectionName}-${i}`} className="p-3 rounded-xl border border-[var(--edge)] bg-[var(--panel-2)]">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold">{sec.sectionName}</span>
                  <span className="text-sm text-[var(--muted)]">{sec.score}/{sec.total}</span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--edge)] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ringColor }}></div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={onReview} className="btn btn-outline-sky w-full">Review Test</button>
          <button onClick={onClose} className="btn btn-ghost w-full">Back to Dashboard</button>
        </div>
      </div>
    </div>
  );
};

export default ResultScreen;
