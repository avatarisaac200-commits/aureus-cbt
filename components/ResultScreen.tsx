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
    if (result.status === 'abandoned') return { text: "TEST CANCELLED", color: "text-red-600", bg: "bg-red-50" };
    if (percentage >= 70) return { text: "EXCELLENT WORK!", color: "text-amber-600", bg: "bg-amber-50" };
    if (percentage >= 50) return { text: "WELL DONE", color: "text-slate-800", bg: "bg-slate-50" };
    return { text: "KEEP PRACTICING", color: "text-rose-600", bg: "bg-rose-50" };
  };

  const feedback = getFeedback();

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 pb-20">
       <div className="max-w-3xl w-full bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-gray-200">
          <div className="bg-slate-950 p-12 text-center relative border-b-8 border-amber-500">
             <div className="flex justify-center mb-6">
                <img src={logo} alt="Crest" className="w-24 h-24 drop-shadow-lg" />
             </div>
             <p className="text-amber-500 text-[10px] font-black uppercase tracking-[0.3em] mb-2">Practice Test Results</p>
             <h1 className="text-3xl font-black text-white uppercase tracking-tight">{result.testName}</h1>
          </div>

          <div className="p-12">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center mb-16">
                <div className="text-center md:text-left">
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Result Summary</p>
                   <h2 className={`text-3xl font-black mb-6 ${feedback.color} uppercase tracking-tighter`}>{feedback.text}</h2>
                   <div className="flex gap-4 items-center justify-center md:justify-start">
                      <div className={`px-6 py-3 rounded-2xl font-black text-3xl ${feedback.bg} ${feedback.color} shadow-sm border border-current/10`}>
                         {percentage}%
                      </div>
                      <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">
                        {result.score} / {result.maxScore}<br/>TOTAL POINTS
                      </div>
                   </div>
                </div>

                <div className="flex justify-center">
                   <div className="relative w-44 h-44">
                      <svg className="w-full h-full transform -rotate-90">
                         <circle cx="88" cy="88" r="76" stroke="currentColor" strokeWidth="16" fill="transparent" className="text-gray-100" />
                         <circle cx="88" cy="88" r="76" stroke="currentColor" strokeWidth="16" fill="transparent" strokeDasharray={477} strokeDashoffset={477 - (477 * percentage) / 100} strokeLinecap="round" className={feedback.color} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                         <span className="text-4xl font-black text-slate-950">{percentage}%</span>
                      </div>
                   </div>
                </div>
             </div>

             <div className="space-y-6 mb-12">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">Scores by Subject</h3>
                {result.sectionBreakdown.map((sec, i) => {
                  const secPerc = Math.round((sec.score / sec.total) * 100);
                  return (
                    <div key={i} className="flex flex-col gap-2">
                       <div className="flex justify-between items-center text-xs px-1">
                          <span className="font-black text-slate-800 uppercase tracking-tight">{sec.sectionName}</span>
                          <span className="font-black text-slate-400">{sec.score}/{sec.total} Points</span>
                       </div>
                       <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full transition-all duration-1000 rounded-full ${secPerc >= 70 ? 'bg-amber-500' : 'bg-slate-900'}`} style={{ width: `${secPerc}%` }}></div>
                       </div>
                    </div>
                  );
                })}
             </div>

             <div className="flex flex-col gap-3">
                <button 
                   onClick={onReview}
                   className="w-full py-5 bg-amber-500 text-slate-950 rounded-2xl font-black uppercase tracking-[0.3em] text-xs hover:bg-amber-400 shadow-xl transition-all"
                >
                   Review Answers
                </button>
                <button 
                   onClick={onClose}
                   className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase tracking-[0.3em] text-xs hover:bg-slate-800 shadow-xl transition-all"
                >
                   Back to Dashboard
                </button>
             </div>
          </div>
       </div>
    </div>
  );
};

export default ResultScreen;