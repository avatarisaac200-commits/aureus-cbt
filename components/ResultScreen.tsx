
import React from 'react';
import { ExamResult } from '../types';

interface ResultScreenProps {
  result: ExamResult;
  onClose: () => void;
  onReview: () => void;
}

const ResultScreen: React.FC<ResultScreenProps> = ({ result, onClose, onReview }) => {
  const percentage = Math.round((result.score / result.maxScore) * 100);
  
  const getFeedback = () => {
    if (result.status === 'abandoned') return { text: "SESSION TERMINATED", color: "text-red-600", bg: "bg-red-50" };
    if (percentage >= 70) return { text: "EXCELLENCE ACHIEVED", color: "text-amber-600", bg: "bg-amber-50" };
    if (percentage >= 50) return { text: "MINIMUM COMPETENCY", color: "text-slate-800", bg: "bg-slate-50" };
    return { text: "BELOW THRESHOLD", color: "text-rose-600", bg: "bg-rose-50" };
  };

  const feedback = getFeedback();

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 pb-20 safe-top safe-bottom">
       <div className="max-w-3xl w-full bg-white rounded-[3rem] shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95 fade-in duration-700">
          <div className="bg-slate-950 p-14 text-center relative border-b-8 border-amber-500">
             <div className="flex justify-center mb-8">
                <img src="/assets/logo.png" alt="Aureus Logo" className="w-24 h-24 drop-shadow-2xl" />
             </div>
             <p className="text-amber-500 text-[11px] font-black uppercase tracking-[0.4em] mb-3">Academic Performance Transcript</p>
             <h1 className="text-3xl font-black text-white uppercase tracking-tight leading-tight">{result.testName}</h1>
          </div>

          <div className="p-12 md:p-16">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center mb-16 text-center md:text-left">
                <div>
                   <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">Official Assessment Result</p>
                   <h2 className={`text-4xl font-black mb-8 ${feedback.color} uppercase tracking-tighter leading-none`}>{feedback.text}</h2>
                   <div className="flex gap-6 items-center justify-center md:justify-start">
                      <div className={`px-8 py-4 rounded-[2rem] font-black text-4xl ${feedback.bg} ${feedback.color} shadow-lg border border-current/10`}>
                         {percentage}%
                      </div>
                      <div className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] leading-relaxed">
                        {result.score} / {result.maxScore}<br/>Raw Aggregate
                      </div>
                   </div>
                </div>

                <div className="flex justify-center">
                   <div className="relative w-52 h-52">
                      <svg className="w-full h-full transform -rotate-90">
                         <circle cx="104" cy="104" r="90" stroke="currentColor" strokeWidth="20" fill="transparent" className="text-slate-50" />
                         <circle cx="104" cy="104" r="90" stroke="currentColor" strokeWidth="20" fill="transparent" strokeDasharray={565} strokeDashoffset={565 - (565 * percentage) / 100} strokeLinecap="round" className={feedback.color} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center flex-col">
                         <span className="text-5xl font-black text-slate-950 leading-none">{percentage}%</span>
                         <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] mt-2">Aureus</span>
                      </div>
                   </div>
                </div>
             </div>

             <div className="space-y-8 mb-16">
                <h3 className="text-[11px] font-black text-slate-950 uppercase tracking-[0.3em] text-center md:text-left">Section Analysis</h3>
                {result.sectionBreakdown.map((sec, i) => {
                  const secPerc = Math.round((sec.score / sec.total) * 100);
                  return (
                    <div key={i} className="flex flex-col gap-3 group">
                       <div className="flex justify-between items-center text-[10px] px-2">
                          <span className="font-black text-slate-800 uppercase tracking-widest">{sec.sectionName}</span>
                          <span className="font-black text-slate-400">{sec.score} / {sec.total}</span>
                       </div>
                       <div className="w-full h-4 bg-slate-50 rounded-full overflow-hidden border border-slate-100 p-1">
                          <div className={`h-full transition-all duration-1000 rounded-full shadow-sm ${secPerc >= 70 ? 'bg-amber-500' : 'bg-slate-950'}`} style={{ width: `${secPerc}%` }}></div>
                       </div>
                    </div>
                  );
                })}
             </div>

             <div className="flex flex-col sm:flex-row gap-4">
                <button 
                   onClick={onReview}
                   className="flex-1 py-6 bg-amber-500 text-slate-950 rounded-3xl font-black uppercase tracking-[0.3em] text-xs shadow-xl hover:bg-amber-400 transition-all active:scale-95"
                >
                   Review Items
                </button>
                <button 
                   onClick={onClose}
                   className="flex-1 py-6 bg-slate-950 text-amber-500 rounded-3xl font-black uppercase tracking-[0.3em] text-xs shadow-xl hover:bg-slate-900 transition-all active:scale-95"
                >
                   Close Transcript
                </button>
             </div>
          </div>
       </div>
    </div>
  );
};

export default ResultScreen;
