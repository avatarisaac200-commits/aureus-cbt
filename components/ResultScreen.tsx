
import React from 'react';
import { ExamResult } from '../types';

const logo = '/assets/logo.png?v=2';

// Fixed missing component logic and default export
interface ResultScreenProps {
  result: ExamResult;
  onClose: () => void;
  onReview: () => void;
}

const ResultScreen: React.FC<ResultScreenProps> = ({ result, onClose, onReview }) => {
  const percentage = (result.score / result.maxScore) * 100;
  
  return (
    <div className="fixed inset-0 bg-slate-900 flex items-center justify-center p-4 z-50">
      <div className="max-w-md w-full bg-white rounded-[2.5rem] p-8 text-center shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600"></div>
        
        <img src={logo} className="w-16 h-16 mx-auto mb-6" alt="Logo" />
        <h1 className="text-[12px] font-black uppercase tracking-[0.3em] text-slate-400 mb-8">Performance Report</h1>

        <div className="relative inline-block mb-8">
          <svg className="w-32 h-32 transform -rotate-90">
            <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-slate-100" />
            <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" strokeDasharray={364} strokeDashoffset={364 - (364 * percentage) / 100} className="text-amber-500" strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-black text-slate-900">{Math.round(percentage)}%</span>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Score</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100">
            <span className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Correct</span>
            <span className="text-xl font-black text-slate-900">{result.score}</span>
          </div>
          <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100">
            <span className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Marks</span>
            <span className="text-xl font-black text-slate-900">{result.maxScore}</span>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={onReview}
            className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl shadow-lg hover:bg-slate-800 transition-all transform active:scale-95 uppercase tracking-widest text-xs"
          >
            Review Answers
          </button>
          <button
            onClick={onClose}
            className="w-full bg-white text-slate-400 font-black py-4 rounded-2xl hover:text-slate-600 transition-all uppercase tracking-widest text-xs"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResultScreen;
