import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MockTest, Question, ExamResult, User } from '../types';
import { db } from '../firebase';
import { collection, getDocs, addDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import Calculator from './Calculator';
import ScientificText from './ScientificText';
import logo from '../assets/logo.png';

interface ExamInterfaceProps {
  test: MockTest;
  user: User;
  onFinish: (result: ExamResult) => void;
  onExit: () => void;
}

const ExamInterface: React.FC<ExamInterfaceProps> = ({ test, user, onFinish, onExit }) => {
  const [view, setView] = useState<'lobby' | 'testing'>('lobby');
  const [activeSectionIndex, setActiveSectionIndex] = useState<number | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(test.totalDurationSeconds);
  const [hasStarted, setHasStarted] = useState(false); // New state to control timer start
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [completedSections, setCompletedSections] = useState<number[]>([]);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showNav, setShowNav] = useState(false);
  const [allQuestions, setAllQuestions] = useState<Record<string, Question>>({});
  const [isFinishing, setIsFinishing] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const fetchQuestions = async () => {
      const qSnap = await getDocs(collection(db, 'questions'));
      const qMap: Record<string, Question> = {};
      qSnap.docs.forEach(d => { qMap[d.id] = { ...d.data(), id: d.id } as Question; });
      setAllQuestions(qMap);
    };
    fetchQuestions();
  }, []);

  const calculateResult = useCallback(async (status: ExamResult['status']) => {
    const sectionBreakdown = test.sections.map((section, idx) => {
      let sectionScore = 0;
      section.questionIds.forEach(qId => {
        const question = allQuestions[qId];
        if (question && answers[qId] === question.correctAnswerIndex) {
          sectionScore += section.marksPerQuestion;
        }
      });
      return {
        sectionName: section.name,
        score: sectionScore,
        total: section.questionIds.length * section.marksPerQuestion
      };
    });

    const totalScore = sectionBreakdown.reduce((acc, curr) => acc + curr.score, 0);
    const maxScore = sectionBreakdown.reduce((acc, curr) => acc + curr.total, 0);

    const result: Omit<ExamResult, 'id'> = {
      userId: user.id,
      testId: test.id,
      testName: test.name,
      score: totalScore,
      maxScore: maxScore,
      completedAt: new Date().toISOString(),
      status: status,
      userAnswers: answers,
      sectionBreakdown
    };

    try {
      const docRef = await addDoc(collection(db, 'results'), result);
      onFinish({ ...result, id: docRef.id } as ExamResult);
    } catch (e) {
      console.error("Failed to save results:", e);
      onFinish({ ...result, id: 'temp-' + Date.now() } as ExamResult);
    }
  }, [allQuestions, answers, onFinish, test, user.id]);

  useEffect(() => {
    if (!hasStarted) return; // Only start timer if hasStarted is true

    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          calculateResult('auto-submitted');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [calculateResult, hasStarted]);

  const enterSection = (idx: number) => {
    if (completedSections.includes(idx)) return;
    setHasStarted(true); // Begin countdown when user starts their first section
    setActiveSectionIndex(idx);
    setCurrentQuestionIndex(0);
    setView('testing');
  };

  const handleSectionSubmit = () => {
    if (activeSectionIndex === null) return;
    if (window.confirm("Submit this section? You cannot return to these questions later.")) {
      setCompletedSections(prev => [...prev, activeSectionIndex]);
      setView('lobby');
      setActiveSectionIndex(null);
    }
  };

  const finalSubmit = () => {
    if (completedSections.length < test.sections.length) {
      alert("Please complete all sections before final submission.");
      return;
    }
    if (window.confirm("End the entire exam and view results?")) {
      setIsFinishing(true);
      calculateResult('completed');
    }
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (view === 'lobby') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="bg-slate-950 p-4 md:p-6 flex justify-between items-center border-b-4 border-amber-500 text-white shadow-xl">
          <div className="flex items-center gap-3">
            <img src={logo} className="w-10 h-10 md:w-12 md:h-12" alt="Logo" />
            <div>
              <h1 className="text-xs md:text-sm font-black uppercase tracking-widest text-amber-500 truncate max-w-[150px] md:max-w-none">{test.name}</h1>
              <p className="text-[8px] md:text-[10px] text-slate-400 font-bold uppercase">Dr. {user.name}</p>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 px-3 py-1 md:px-6 md:py-2 rounded-xl text-amber-400 font-mono text-base md:text-xl font-black">
            {hasStarted ? formatTime(timeRemaining) : "WAITING"}
          </div>
        </header>

        <main className="flex-1 max-w-4xl mx-auto w-full p-4 md:p-8">
          <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-6 md:p-10">
            <h2 className="text-lg md:text-xl font-black text-slate-950 mb-1 uppercase tracking-tight">Test Sections</h2>
            <p className="text-slate-400 text-[10px] md:text-xs font-medium mb-8">
              {!hasStarted ? "Timer will start upon entering any section." : "Exam is in progress. Complete remaining sections."}
            </p>
            
            <div className="space-y-3">
              {test.sections.map((section, idx) => {
                const isCompleted = completedSections.includes(idx);
                return (
                  <button
                    key={idx}
                    onClick={() => enterSection(idx)}
                    disabled={isCompleted}
                    className={`w-full flex justify-between items-center p-4 md:p-6 rounded-2xl border-2 transition-all ${
                      isCompleted 
                      ? 'bg-slate-50 border-slate-100 grayscale opacity-50 cursor-not-allowed' 
                      : 'bg-white border-gray-100 hover:border-amber-500 active:bg-amber-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-4 md:gap-6">
                      <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center font-black text-sm md:text-base ${isCompleted ? 'bg-slate-200 text-slate-400' : 'bg-slate-950 text-amber-500'}`}>
                        {idx + 1}
                      </div>
                      <div className="text-left">
                        <h3 className="font-black text-slate-900 text-xs md:text-sm uppercase">{section.name}</h3>
                        <p className="text-[8px] md:text-[10px] text-slate-400 font-bold uppercase">{section.questionIds.length} Q • {section.marksPerQuestion} Pts</p>
                      </div>
                    </div>
                    {isCompleted ? (
                      <span className="text-[8px] md:text-[10px] font-black text-slate-400 bg-slate-200 px-3 py-1.5 rounded-full uppercase">Locked</span>
                    ) : (
                      <span className="text-[8px] md:text-[10px] font-black text-amber-600 bg-amber-100 px-3 py-1.5 rounded-full uppercase">Start</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-10 pt-8 border-t border-gray-100 flex flex-col md:flex-row gap-4 justify-between items-center">
              <button 
                onClick={() => { if(window.confirm('Quit exam? No score will be recorded.')) onExit(); }}
                className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest order-2 md:order-1"
              >
                Terminate Session
              </button>
              <button
                onClick={finalSubmit}
                disabled={completedSections.length < test.sections.length || isFinishing}
                className="w-full md:w-auto px-10 py-4 bg-slate-950 text-amber-500 rounded-2xl text-[10px] font-black uppercase tracking-widest disabled:opacity-30 shadow-xl order-1 md:order-2 active:scale-95 transition-transform"
              >
                {isFinishing ? 'Processing...' : 'Complete Exam'}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const activeSection = test.sections[activeSectionIndex!];
  const currentQuestionId = activeSection.questionIds[currentQuestionIndex];
  const currentQuestion = allQuestions[currentQuestionId];

  return (
    <div className="flex flex-col h-screen bg-gray-50 select-none overflow-hidden">
      <header className="bg-slate-950 text-white px-4 md:px-8 py-3 md:py-4 flex justify-between items-center border-b-4 border-amber-500 z-30">
        <div className="flex items-center gap-3">
          <img src={logo} className="w-8 h-8 md:w-10 md:h-10" alt="Logo" />
          <div className="hidden sm:block">
            <h1 className="text-[10px] font-black uppercase tracking-widest text-amber-500">{test.name}</h1>
            <p className="text-[8px] text-slate-400 font-bold uppercase truncate max-w-[120px]">Section: {activeSection.name}</p>
          </div>
          <div className="sm:hidden">
             <span className="text-[10px] font-black uppercase text-amber-500">Q{currentQuestionIndex + 1}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="font-mono text-sm md:text-lg font-black text-amber-400 bg-slate-900 px-3 py-1 rounded-lg">
            {formatTime(timeRemaining)}
          </div>
          <button 
            onClick={() => setShowNav(!showNav)}
            className="md:hidden p-2 text-amber-500 bg-slate-900 rounded-lg border border-slate-800"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        <main className="flex-1 flex flex-col p-3 md:p-6 overflow-hidden">
          <div className="flex-1 bg-white rounded-2xl md:rounded-3xl shadow-sm border border-gray-200 overflow-y-auto p-5 md:p-10 no-scrollbar">
            <div className="mb-4 md:mb-6 border-b border-gray-100 pb-3 md:pb-4 flex justify-between items-center">
               <span className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Question {currentQuestionIndex + 1} / {activeSection.questionIds.length}
               </span>
               <span className="text-[8px] md:text-[10px] font-black text-amber-600 uppercase tracking-widest sm:hidden">
                  {activeSection.name}
               </span>
            </div>

            <div className="text-base md:text-xl font-bold text-slate-900 mb-8 md:mb-10 leading-relaxed">
              <ScientificText text={currentQuestion?.text || "Loading question..."} />
            </div>

            <div className="space-y-3 md:space-y-4">
              {currentQuestion?.options.map((option, idx) => (
                <button
                  key={idx}
                  onClick={() => setAnswers(prev => ({ ...prev, [currentQuestionId]: idx }))}
                  className={`w-full text-left p-4 md:p-6 rounded-xl md:rounded-2xl border-2 transition-all flex items-center group active:scale-[0.98] ${
                    answers[currentQuestionId] === idx 
                    ? 'border-amber-500 bg-amber-50 ring-2 md:ring-4 ring-amber-500/10' 
                    : 'border-gray-50 hover:border-amber-100 hover:bg-slate-50'
                  }`}
                >
                  <div className={`w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center mr-4 md:mr-6 font-black text-xs md:text-base flex-shrink-0 transition-colors ${
                    answers[currentQuestionId] === idx ? 'bg-amber-500 text-slate-950' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {String.fromCharCode(65 + idx)}
                  </div>
                  <ScientificText 
                    text={option} 
                    className={`text-sm md:text-base font-semibold flex-1 ${answers[currentQuestionId] === idx ? 'text-slate-900' : 'text-slate-600'}`} 
                  />
                </button>
              ))}
            </div>
            
            <div className="h-20 md:hidden"></div>
          </div>
        </main>

        <aside className={`
          fixed inset-y-0 right-0 w-72 bg-white border-l border-gray-200 z-40 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 md:w-80 md:flex md:flex-col shadow-2xl md:shadow-none
          ${showNav ? 'translate-x-0' : 'translate-x-full'}
        `}>
          <div className="h-full flex flex-col">
            <div className="p-4 border-b border-gray-100 bg-slate-50 flex justify-between items-center">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Question Palette</h3>
              <button onClick={() => setShowNav(false)} className="md:hidden text-slate-400"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
            </div>
            <div className="p-3 grid grid-cols-5 gap-1.5 content-start overflow-y-auto no-scrollbar flex-1 pb-safe">
              {activeSection.questionIds.map((id, idx) => (
                <button
                  key={id}
                  onClick={() => { setCurrentQuestionIndex(idx); setShowNav(false); }}
                  className={`h-10 rounded-lg text-[10px] font-black border transition-all ${
                    idx === currentQuestionIndex 
                    ? 'border-amber-500 bg-amber-500 text-slate-950 scale-105 z-10' 
                    : answers[id] !== undefined 
                      ? 'border-slate-300 bg-slate-100 text-slate-800'
                      : 'border-gray-100 text-gray-300 bg-gray-50/50'
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
            <div className="p-4 bg-slate-50 border-t border-gray-100 space-y-2 pb-safe">
              <button onClick={() => { setShowCalculator(!showCalculator); setShowNav(false); }} className="w-full py-3 bg-slate-950 text-amber-500 rounded-xl text-[9px] font-black uppercase tracking-widest">Scientific Calc</button>
              <div className="text-[8px] text-slate-400 font-bold text-center uppercase py-2">Attempted: {Object.keys(answers).filter(k => activeSection.questionIds.includes(k)).length} / {activeSection.questionIds.length}</div>
            </div>
          </div>
        </aside>
      </div>

      <footer className="bg-white border-t border-gray-200 p-3 md:p-5 px-4 md:px-10 flex justify-between items-center z-20 pb-safe">
         <button onClick={() => setView('lobby')} className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-900 py-2">
            Main Menu
         </button>
         
         <div className="flex gap-2">
           <button 
             onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))}
             disabled={currentQuestionIndex === 0}
             className="px-4 py-2 border border-slate-200 rounded-xl text-[9px] font-black uppercase disabled:opacity-20"
           >
             Prev
           </button>
           <button 
             onClick={() => setCurrentQuestionIndex(prev => Math.min(activeSection.questionIds.length - 1, prev + 1))}
             disabled={currentQuestionIndex === activeSection.questionIds.length - 1}
             className="px-4 py-2 border border-slate-200 rounded-xl text-[9px] font-black uppercase disabled:opacity-20"
           >
             Next
           </button>
           <button 
             onClick={handleSectionSubmit}
             className="ml-2 px-6 md:px-10 py-3 md:py-4 bg-amber-500 text-slate-950 rounded-xl md:rounded-2xl text-[9px] md:text-xs font-black uppercase tracking-widest shadow-lg shadow-amber-500/20 active:scale-95 transition-transform"
           >
             Submit
           </button>
         </div>
      </footer>

      {showCalculator && <Calculator onClose={() => setShowCalculator(false)} />}
      {showNav && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setShowNav(false)}></div>}
    </div>
  );
};

export default ExamInterface;