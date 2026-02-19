
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MockTest, Question, ExamResult, User, TestSection } from '../types';
import { db } from '../firebase';
import { collection, getDocs, addDoc, query, where, documentId } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import Calculator from './Calculator';
import ScientificText from './ScientificText';
import logo from '../assets/logo.png';

interface ExamInterfaceProps {
  test: MockTest;
  user: User;
  packagedQuestions?: Record<string, Question>;
  onFinish: (result: ExamResult) => void;
  onExit: () => void;
}

const PENDING_RESULTS_QUEUE_KEY = 'pendingResultsQueue';

const queuePendingResult = (payload: Omit<ExamResult, 'id'>) => {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(PENDING_RESULTS_QUEUE_KEY);
    const queue = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(queue) ? queue : [];
    next.push({
      payload: { ...payload, queuedOfflineAt: new Date().toISOString() },
      createdAt: new Date().toISOString()
    });
    window.localStorage.setItem(PENDING_RESULTS_QUEUE_KEY, JSON.stringify(next));
  } catch {
    // Queueing failed; continue with local completion path.
  }
};

const ExamInterface: React.FC<ExamInterfaceProps> = ({ test, user, packagedQuestions, onFinish, onExit }) => {
  const [view, setView] = useState<'lobby' | 'testing'>('lobby');
  const [activeSectionIndex, setActiveSectionIndex] = useState<number | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(test.totalDurationSeconds);
  const [hasStarted, setHasStarted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [completedSections, setCompletedSections] = useState<number[]>([]);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showNav, setShowNav] = useState(false);
  const [allQuestions, setAllQuestions] = useState<Record<string, Question>>({});
  const [questionLoadError, setQuestionLoadError] = useState<string | null>(null);
  const [isPreparingQuestions, setIsPreparingQuestions] = useState(true);
  const [isFinishing, setIsFinishing] = useState(false);

  // Store the shuffled order of question IDs for each section
  const [shuffledSections, setShuffledSections] = useState<TestSection[]>([]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endTimeRef = useRef<number | null>(null);
  const hasSubmittedRef = useRef(false);

  // Simple shuffle function (Fisher-Yates)
  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  useEffect(() => {
    const fetchQuestions = async () => {
      setIsPreparingQuestions(true);
      setQuestionLoadError(null);
      try {
        if (packagedQuestions && Object.keys(packagedQuestions).length > 0) {
          setAllQuestions(packagedQuestions);
          return;
        }

        const ids = Array.from(new Set(test.sections.flatMap(section => section.questionIds)));
        if (ids.length === 0) {
          throw new Error('This test has no questions configured.');
        }

        const chunkSize = 10;
        const qMap: Record<string, Question> = {};
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          const qSnap = await getDocs(query(collection(db, 'questions'), where(documentId(), 'in', chunk)));
          qSnap.docs.forEach(d => { qMap[d.id] = { ...d.data(), id: d.id } as Question; });
        }

        const missing = ids.filter(id => !qMap[id]);
        if (missing.length > 0) {
          throw new Error('Some questions could not be loaded for this test.');
        }
        setAllQuestions(qMap);
      } catch (err: any) {
        console.error('Exam question load error:', err);
        setQuestionLoadError(err?.message || 'Unable to prepare this test.');
      } finally {
        setIsPreparingQuestions(false);
      }
    };
    fetchQuestions();

    // Prepare shuffled question IDs for this specific attempt
    const randomized = test.sections.map(section => ({
      ...section,
      questionIds: shuffleArray(section.questionIds)
    }));
    setShuffledSections(randomized);
  }, [test, packagedQuestions]);

  const calculateResult = useCallback(async (status: ExamResult['status']) => {
    const sectionBreakdown = test.sections.map((section) => {
      let sectionScore = 0;
      section.questionIds.forEach(qId => {
        const question = allQuestions[qId];
        if (question && answers[qId] === question.correctAnswerIndex) {
          sectionScore += section.marksPerQuestion;
        }
      });
      return { sectionName: section.name, score: sectionScore, total: section.questionIds.length * section.marksPerQuestion };
    });

    const totalScore = sectionBreakdown.reduce((acc, curr) => acc + curr.score, 0);
    const maxScore = sectionBreakdown.reduce((acc, curr) => acc + curr.total, 0);

    const result: Omit<ExamResult, 'id'> = {
      userId: user.id,
      userName: user.name,
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
      queuePendingResult(result);
      onFinish({ ...result, id: 'temp-' + Date.now() } as ExamResult);
    }
  }, [allQuestions, answers, onFinish, test, user.id, user.name]);

  useEffect(() => {
    if (!hasStarted) return;

    if (endTimeRef.current === null) {
      endTimeRef.current = Date.now() + (timeRemaining * 1000);
    }

    const syncTimerWithWallClock = () => {
      if (endTimeRef.current === null || hasSubmittedRef.current) return;
      const remainingMs = Math.max(0, endTimeRef.current - Date.now());
      const nextSeconds = Math.ceil(remainingMs / 1000);
      setTimeRemaining(nextSeconds);

      if (remainingMs <= 0 && !hasSubmittedRef.current) {
        hasSubmittedRef.current = true;
        if (timerRef.current) clearInterval(timerRef.current);
        calculateResult('auto-submitted');
      }
    };

    syncTimerWithWallClock();
    timerRef.current = setInterval(syncTimerWithWallClock, 1000);

    const handleVisibilityOrFocus = () => {
      syncTimerWithWallClock();
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [calculateResult, hasStarted]);

  const enterSection = (idx: number) => {
    setHasStarted(true);
    setActiveSectionIndex(idx);
    setCurrentQuestionIndex(0);
    setView('testing');
  };

  const returnToLobby = () => {
    setView('lobby');
    setActiveSectionIndex(null);
    setShowNav(false);
  };

  const handleSectionSubmit = () => {
    if (activeSectionIndex === null) return;
    if (window.confirm("Finish this section? You cannot change your answers after this.")) {
      setCompletedSections(prev => (
        prev.includes(activeSectionIndex) ? prev : [...prev, activeSectionIndex]
      ));
      returnToLobby();
    }
  };

  const finalSubmit = () => {
    if (window.confirm("Submit your entire test?")) {
      setIsFinishing(true);
      hasSubmittedRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      calculateResult('completed');
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (isPreparingQuestions) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-950 p-8 text-center">
        <img src={logo} className="w-12 h-12 animate-pulse mb-5" alt="Aureus Medicos CBT Logo" />
        <p className="text-amber-500 text-[10px] font-black uppercase tracking-[0.3em] mb-2">Preparing Question Package</p>
        <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Please wait...</p>
      </div>
    );
  }

  if (questionLoadError) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-50 p-8 text-center">
        <img src={logo} className="w-14 h-14 mb-6" alt="Aureus Medicos CBT Logo" />
        <p className="text-red-600 text-[10px] font-black uppercase tracking-[0.2em] mb-3">Could Not Open Test</p>
        <p className="text-slate-500 text-sm max-w-md mb-8">{questionLoadError}</p>
        <button onClick={onExit} className="px-8 py-3 bg-slate-950 text-amber-500 rounded-xl text-[10px] font-bold uppercase tracking-widest">Back to Dashboard</button>
      </div>
    );
  }

  if (view === 'lobby') {
    return (
      <div className="h-full w-full bg-slate-50 flex flex-col overflow-hidden safe-top">
        <header className="bg-slate-950 p-6 flex justify-between items-center border-b-4 border-amber-500 text-white shadow-2xl">
          <div className="flex items-center gap-4">
            <img src={logo} className="w-10 h-10" alt="Logo" />
            <div>
              <h1 className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Aureus Medicos</h1>
              <p className="text-[8px] text-slate-400 font-bold uppercase truncate max-w-[150px]">{test.name}</p>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 px-5 py-2 rounded-xl text-amber-400 font-mono text-xl font-bold">
            {hasStarted ? formatTime(timeRemaining) : "READY"}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 md:p-12 no-scrollbar safe-bottom">
          <div className="max-w-4xl mx-auto bg-white rounded-[2rem] shadow-xl border border-slate-100 p-8 md:p-12">
            <h2 className="text-2xl font-bold text-slate-950 mb-2 uppercase tracking-tight">Test Instructions</h2>
            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-10">You can move between sections anytime from the lobby.</p>
            <div className="space-y-4">
              {test.sections.map((section, idx) => {
                const isCompleted = completedSections.includes(idx);
                return (
                  <button key={idx} onClick={() => enterSection(idx)} className={`w-full flex justify-between items-center p-6 rounded-2xl border-2 transition-all ${isCompleted ? 'bg-slate-50 border-slate-100' : 'bg-white border-slate-100 hover:border-amber-500'}`}>
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${isCompleted ? 'bg-slate-200 text-slate-400' : 'bg-slate-950 text-amber-500'}`}>{idx + 1}</div>
                      <div className="text-left">
                        <h3 className="font-bold text-slate-950 text-sm uppercase">{section.name}</h3>
                        <p className="text-[9px] text-slate-400 font-bold uppercase">{section.questionIds.length} Questions</p>
                      </div>
                    </div>
                    <span className={`text-[9px] font-bold px-4 py-2 rounded-xl uppercase tracking-widest transition-all ${isCompleted ? 'bg-slate-100 text-slate-400' : 'bg-amber-100 text-amber-600'}`}>{isCompleted ? 'Review' : 'Start'}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-12 pt-8 border-t border-slate-50 flex flex-col md:flex-row gap-6 justify-end items-center">
              <button onClick={finalSubmit} disabled={!hasStarted || isFinishing} className="w-full md:w-auto px-10 py-4 bg-slate-950 text-amber-500 rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-xl hover:bg-slate-900 transition-all disabled:opacity-30">Submit Final Test</button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Use the shuffled section for question order
  const activeSection = shuffledSections[activeSectionIndex!];
  const currentQuestionId = activeSection?.questionIds[currentQuestionIndex];
  const currentQuestion = allQuestions[currentQuestionId];

  return (
    <div className="flex flex-col h-full bg-slate-50 select-none overflow-hidden safe-top">
      <header className="bg-slate-950 text-white px-6 py-4 flex justify-between items-center border-b-4 border-amber-500 z-30 shrink-0">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-8 h-8" alt="Logo" />
          <div className="hidden sm:block">
            <h1 className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Aureus Medicos</h1>
            <p className="text-[9px] text-slate-400 font-bold uppercase truncate max-w-[200px] mt-0.5">{test.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="font-mono text-xl font-bold text-amber-400 bg-slate-900 px-4 py-1.5 rounded-xl border border-slate-800">{formatTime(timeRemaining)}</div>
          <button onClick={() => setShowNav(!showNav)} className="md:hidden p-2 text-amber-500 bg-slate-900 rounded-xl border border-slate-800"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg></button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        <main className="flex-1 flex flex-col p-4 md:p-8 overflow-hidden">
          <div className="flex-1 bg-white rounded-[2rem] md:rounded-[3rem] shadow-sm border border-slate-100 overflow-y-auto p-8 md:p-12 no-scrollbar">
            <div className="mb-8 border-b border-slate-50 pb-4 flex justify-between items-center">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Question {currentQuestionIndex + 1} of {activeSection.questionIds.length}</span>
               <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-3 py-1 rounded-full uppercase tracking-widest">{activeSection.name}</span>
            </div>
            <div className="text-lg md:text-2xl font-bold text-slate-900 mb-12 leading-tight"><ScientificText text={currentQuestion?.text || "Loading..."} /></div>
            <div className="space-y-4">
              {currentQuestion?.options.map((option, idx) => (
                <button key={idx} onClick={() => setAnswers(prev => ({ ...prev, [currentQuestionId]: idx }))} className={`w-full text-left p-6 rounded-2xl border-2 transition-all flex items-center ${answers[currentQuestionId] === idx ? 'border-amber-500 bg-amber-50 shadow-sm' : 'border-slate-50 hover:bg-slate-50 hover:border-slate-200'}`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mr-6 font-bold text-base transition-all ${answers[currentQuestionId] === idx ? 'bg-amber-500 text-slate-950' : 'bg-slate-100 text-slate-400'}`}>{String.fromCharCode(65 + idx)}</div>
                  <ScientificText text={option} className={`text-base font-bold flex-1 ${answers[currentQuestionId] === idx ? 'text-slate-950' : 'text-slate-600'}`} />
                </button>
              ))}
            </div>
          </div>
        </main>

        <aside className={`fixed inset-y-0 right-0 w-72 bg-white border-l border-slate-100 z-40 transform transition-transform duration-300 md:relative md:translate-x-0 ${showNav ? 'translate-x-0' : 'translate-x-full'} shadow-2xl md:shadow-none`}>
          <div className="h-full flex flex-col">
            <div className="p-6 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
              <h3 className="text-[10px] font-bold text-slate-950 uppercase tracking-widest">Questions</h3>
              <button onClick={() => setShowNav(false)} className="md:hidden text-slate-400"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
            </div>
            <div className="p-4 grid grid-cols-4 gap-2 content-start overflow-y-auto no-scrollbar flex-1">
              {activeSection.questionIds.map((id, idx) => (
                <button key={id} onClick={() => { setCurrentQuestionIndex(idx); setShowNav(false); }} className={`h-10 rounded-xl text-[10px] font-bold border transition-all ${idx === currentQuestionIndex ? 'border-amber-500 bg-amber-500 text-slate-950' : answers[id] !== undefined ? 'border-slate-300 bg-slate-100 text-slate-800' : 'border-slate-100 text-slate-300 bg-white hover:border-slate-300'}`}>{idx + 1}</button>
              ))}
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100">
              <button onClick={() => { setShowCalculator(!showCalculator); setShowNav(false); }} className="w-full py-4 bg-slate-950 text-amber-500 rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-lg">Calculator</button>
            </div>
          </div>
        </aside>
      </div>

      <footer className="bg-white border-t border-slate-100 p-6 flex flex-col sm:flex-row gap-4 justify-between items-center z-20 shrink-0 safe-bottom">
         <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">You can return to lobby anytime</div>
         <div className="flex gap-2 w-full sm:w-auto">
           <button onClick={returnToLobby} className="flex-1 sm:flex-none px-6 py-3 border-2 border-slate-100 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50">Lobby</button>
           <button onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))} disabled={currentQuestionIndex === 0} className="flex-1 sm:flex-none px-6 py-3 border-2 border-slate-100 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 disabled:opacity-30">Back</button>
           <button onClick={() => setCurrentQuestionIndex(prev => Math.min(activeSection.questionIds.length - 1, prev + 1))} disabled={currentQuestionIndex === activeSection.questionIds.length - 1} className="flex-1 sm:flex-none px-6 py-3 border-2 border-slate-100 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 disabled:opacity-30">Next</button>
           <button onClick={handleSectionSubmit} className="flex-1 sm:flex-none px-8 py-3 bg-amber-500 text-slate-950 rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-md">Mark Done</button>
         </div>
      </footer>

      {showCalculator && <Calculator onClose={() => setShowCalculator(false)} />}
      {showNav && <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-30 md:hidden" onClick={() => setShowNav(false)}></div>}
    </div>
  );
};

export default ExamInterface;
