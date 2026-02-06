
import React from 'react';
import { ExamResult } from '../types';
import logo from '../assets/logo.png';

interface ResultScreenProps {
  result: ExamResult;
  onClose: () => void;
  onReview: () => void;
}

const ResultScreen: React.FC<ResultScreenProps> = ({ result, onClose, onReview }) => {
  const percentage = Math.round((result.score / result.maxScore) * 100);
  
  const getFeedback = () => {
    if (result.status === 'abandoned') return { text: "SESSION ENDED", color: "text-red-600", bg: "bg-red-50" };
    if (percentage >= 70) return { text: "EXCELLENT", color: "text-amber-600", bg: "bg-amber-50" };
    if (percentage >= 50) return { text: "PASSED", color: "text-slate-800", bg: "bg-slate-50" };
    return { text: "FAILED", color: "text-rose-600", bg: "bg-rose-50" };
  };

  const feedback = getFeedback();

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 pb-20 safe-top safe-bottom">
       <div className="max-w-3xl w-full bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95 fade-in duration-700">
          <div className="bg-slate-950 p-10 text-center relative border-b-8 border-amber-500">
             <div className="flex justify-center mb-6">
                <img src={logo} alt="Logo" className="w-20 h-20" />
             </div>
             <p className="text-amber-500 text-[10px] font-bold uppercase tracking-widest mb-2">Test Result</p>
             <h1 className="text-2xl font-bold text-white uppercase tracking-tight">{result.testName}</h1>
          </div>

          <div className="p-8 md:p-12 text-center">
             <div className="mb-10">
                <h2 className={`text-4xl font-bold mb-4 ${feedback.color}`}>{feedback.text}</h2>
                <div className="flex justify-center items-center gap-6">
                   <div className={`px-8 py-4 rounded-2xl font-bold text-5xl ${feedback.bg} ${feedback.color} shadow-lg`}>
                      {percentage}%
                   </div>
                   <div className="text-left text-slate-400 text-[10px] font-bold uppercase leading-relaxed">
                     Score: {result.score} / {result.maxScore}
                   </div>
                </div>
             </div>

             <div className="space-y-4 mb-10 text-left">
                <h3 className="text-[10px] font-bold text-slate-950 uppercase tracking-widest">Section Scores</h3>
                {result.sectionBreakdown.map((sec, i) => {
                  const secPerc = Math.round((sec.score / sec.total) * 100);
                  return (
                    <div key={i} className="flex flex-col gap-2">
                       <div className="flex justify-between items-center text-[10px]">
                          <span className="font-bold text-slate-800 uppercase">{sec.sectionName}</span>
                          <span className="font-bold text-slate-400">{sec.score} / {sec.total}</span>
                       </div>
                       <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full bg-amber-500`} style={{ width: `${secPerc}%` }}></div>
                       </div>
                    </div>
                  );
                })}
             </div>

             <div className="flex flex-col sm:flex-row gap-4">
                <button onClick={onReview} className="flex-1 py-5 bg-amber-500 text-slate-950 rounded-2xl font-bold uppercase tracking-widest text-[10px] shadow-lg">Review Questions</button>
                <button onClick={onClose} className="flex-1 py-5 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase tracking-widest text-[10px] shadow-lg">Back to Dashboard</button>
             </div>
          </div>
       </div>
    </div>
  );
};

export default ResultScreen;
