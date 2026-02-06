
import React, { useState, useEffect } from 'react';
import { ExamResult, Question } from '../types';
import { db } from '../firebase';
import { collection, getDocs, query, where, documentId } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import ScientificText from './ScientificText';

const logo = '/assets/logo.png?v=2';

// Fixed missing component logic and default export
interface ReviewInterfaceProps {
  result: ExamResult;
  onExit: () => void;
}

const ReviewInterface: React.FC<ReviewInterfaceProps> = ({ result, onExit }) => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchQuestions = async () => {
      const qids = Object.keys(result.userAnswers);
      if (qids.length === 0) return setLoading(false);
      const qSnap = await getDocs(query(collection(db, 'questions'), where(documentId(), 'in', qids)));
      setQuestions(qSnap.docs.map(d => ({ ...d.data(), id: d.id }) as Question));
      setLoading(false);
    };
    fetchQuestions();
  }, [result]);

  if (loading) return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-50">
      <img src={logo} className="w-12 h-12 animate-pulse" alt="Loading" />
    </div>
  );

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
      <header className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <img src={logo} className="w-8 h-8" alt="Logo" />
          <div>
            <h1 className="text-xs font-black uppercase tracking-widest text-slate-900 leading-none">Review Session</h1>
            <p className="text-[9px] font-bold text-amber-500 uppercase tracking-widest mt-1">{result.testName}</p>
          </div>
        </div>
        <button onClick={onExit} className="bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest px-6 py-2 rounded-xl hover:bg-slate-800 transition-all">
          Exit Review
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6">
        {questions.map((q, idx) => {
          const userAns = result.userAnswers[q.id];
          const isCorrect = userAns === q.correctAnswerIndex;

          return (
            <div key={q.id} className="max-w-4xl mx-auto bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="bg-slate-50 px-8 py-4 border-b border-slate-100 flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Question {idx + 1}</span>
                <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${isCorrect ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                  {isCorrect ? 'Correct' : 'Incorrect'}
                </span>
              </div>
              <div className="p-8">
                <ScientificText text={q.text} className="text-lg font-medium text-slate-800 mb-6" />
                <div className="space-y-3">
                  {q.options.map((opt, i) => {
                    const isCorrectOpt = i === q.correctAnswerIndex;
                    const isUserOpt = i === userAns;
                    
                    let borderColor = 'border-slate-100';
                    let bgColor = '';
                    if (isCorrectOpt) {
                      borderColor = 'border-emerald-500';
                      bgColor = 'bg-emerald-50';
                    } else if (isUserOpt && !isCorrect) {
                      borderColor = 'border-rose-500';
                      bgColor = 'bg-rose-50';
                    }

                    return (
                      <div key={i} className={`p-4 rounded-2xl border-2 flex items-center gap-4 ${borderColor} ${bgColor}`}>
                        <span className={`w-8 h-8 flex items-center justify-center rounded-xl font-black text-xs ${isCorrectOpt ? 'bg-emerald-500 text-white' : (isUserOpt ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-400')}`}>
                          {String.fromCharCode(65 + i)}
                        </span>
                        <ScientificText text={opt} className="text-slate-700 text-sm" />
                      </div>
                    );
                  })}
                </div>
                {q.explanation && (
                  <div className="mt-8 bg-amber-50 p-6 rounded-2xl border border-amber-100">
                    <h4 className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-2">Explanation</h4>
                    <ScientificText text={q.explanation} className="text-sm text-slate-600 italic" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
};

export default ReviewInterface;
