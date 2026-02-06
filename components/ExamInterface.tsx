
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MockTest, Question, ExamResult, User } from '../types';
import { db } from '../firebase';
import { collection, getDocs, addDoc, query, where, documentId } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import Calculator from './Calculator';
import ScientificText from './ScientificText';

const logo = '/assets/logo.png?v=2';

// Fixed missing component logic and default export
interface ExamInterfaceProps {
  test: MockTest;
  user: User;
  onFinish: (result: ExamResult) => void;
  onExit: () => void;
}

const ExamInterface: React.FC<ExamInterfaceProps> = ({ test, user, onFinish, onExit }) => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, number>>({});
  const [timeLeft, setTimeLeft] = useState(test.totalDurationSeconds);
  const [loading, setLoading] = useState(true);
  const [showCalc, setShowCalc] = useState(false);

  useEffect(() => {
    const fetchQuestions = async () => {
      const allQuestionIds = test.sections.flatMap(s => s.questionIds);
      if (allQuestionIds.length === 0) return setLoading(false);
      
      const qSnap = await getDocs(query(collection(db, 'questions'), where(documentId(), 'in', allQuestionIds)));
      setQuestions(qSnap.docs.map(d => ({ ...d.data(), id: d.id }) as Question));
      setLoading(false);
    };
    fetchQuestions();

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [test]);

  const handleSubmit = async () => {
    let score = 0;
    let maxScore = 0;
    const sectionBreakdown = test.sections.map(section => {
      let sectionScore = 0;
      section.questionIds.forEach(qid => {
        const q = questions.find(q => q.id === qid);
        if (q && userAnswers[qid] === q.correctAnswerIndex) {
          sectionScore += section.marksPerQuestion;
        }
      });
      score += sectionScore;
      const sectionTotal = section.questionIds.length * section.marksPerQuestion;
      maxScore += sectionTotal;
      return { sectionName: section.name, score: sectionScore, total: sectionTotal };
    });

    const result: ExamResult = {
      id: '', // Firestore will generate
      userId: user.id,
      userName: user.name,
      testId: test.id,
      testName: test.name,
      score,
      maxScore,
      completedAt: new Date().toISOString(),
      status: 'completed',
      userAnswers,
      sectionBreakdown
    };

    const docRef = await addDoc(collection(db, 'results'), result);
    onFinish({ ...result, id: docRef.id });
  };

  if (loading) return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-slate-900">
      <img src={logo} className="w-16 h-16 mb-4 animate-spin" alt="Loading" />
      <p className="text-amber-500 text-[10px] font-black uppercase tracking-widest">Loading Exam Environment</p>
    </div>
  );

  const currentQ = questions[currentIdx];
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}:${rs < 10 ? '0' : ''}${rs}`;
  };

  return (
    <div className="fixed inset-0 bg-slate-50 flex flex-col">
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow-xl">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-8 h-8" alt="Logo" />
          <div className="hidden sm:block">
            <h1 className="text-xs font-black uppercase tracking-widest leading-none">{test.name}</h1>
            <p className="text-[9px] font-bold text-slate-400 uppercase mt-1 tracking-widest">Aureus Medicos CBT</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="bg-slate-800 rounded-lg px-4 py-1.5 flex flex-col items-center border border-slate-700">
            <span className="text-[8px] font-black text-amber-500 uppercase tracking-widest">Time Remaining</span>
            <span className="text-lg font-mono font-black">{formatTime(timeLeft)}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCalc(!showCalc)} className="bg-slate-800 p-2 rounded-lg border border-slate-700 hover:bg-slate-700 transition-colors">
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
            </button>
            <button onClick={() => { if(confirm("Exit exam? Progress will be lost.")) onExit(); }} className="bg-rose-900/50 text-rose-500 p-2 rounded-lg border border-rose-900 hover:bg-rose-900 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex items-center justify-between text-xs font-black uppercase tracking-widest text-slate-400">
            <span>Question {currentIdx + 1} of {questions.length}</span>
            <span className="bg-amber-100 text-amber-600 px-3 py-1 rounded-full">{currentQ?.subject}</span>
          </div>

          <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
            <ScientificText text={currentQ?.text || ''} className="text-lg font-medium text-slate-800 mb-8 leading-relaxed" />
            
            <div className="space-y-3">
              {currentQ?.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => setUserAnswers({ ...userAnswers, [currentQ.id]: i })}
                  className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex items-center gap-4 ${userAnswers[currentQ.id] === i ? 'border-amber-500 bg-amber-50 shadow-inner' : 'border-slate-100 hover:border-slate-200'}`}
                >
                  <span className={`w-8 h-8 flex items-center justify-center rounded-xl font-black text-xs ${userAnswers[currentQ.id] === i ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  <ScientificText text={opt} className="text-slate-700" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-slate-100 p-4 sm:p-6 flex items-center justify-between shadow-2xl">
        <button
          onClick={() => setCurrentIdx(prev => Math.max(0, prev - 1))}
          disabled={currentIdx === 0}
          className="bg-slate-100 text-slate-400 font-black uppercase tracking-widest text-[10px] px-6 py-3 rounded-xl hover:bg-slate-200 disabled:opacity-50 transition-all"
        >
          Previous
        </button>

        <div className="flex gap-2">
          {currentIdx === questions.length - 1 ? (
            <button
              onClick={() => { if(confirm("Submit your exam now?")) handleSubmit(); }}
              className="bg-emerald-600 text-white font-black uppercase tracking-widest text-[10px] px-8 py-3 rounded-xl shadow-lg hover:bg-emerald-500 transition-all"
            >
              Finish & Submit
            </button>
          ) : (
            <button
              onClick={() => setCurrentIdx(prev => Math.min(questions.length - 1, prev + 1))}
              className="bg-slate-900 text-white font-black uppercase tracking-widest text-[10px] px-8 py-3 rounded-xl shadow-lg hover:bg-slate-800 transition-all"
            >
              Next Question
            </button>
          )}
        </div>
      </footer>

      {showCalc && <Calculator onClose={() => setShowCalc(false)} />}
    </div>
  );
};

export default ExamInterface;
