
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MockTest, Question, ExamResult, User, TestSection } from '../types';
import { db } from '../firebase';
import { collection, getDocs, addDoc, query, where, documentId, doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import Calculator from './Calculator';
import ScientificText from './ScientificText';
import logo from '../assets/scholar-main.png';
import { getOrCreateAiExplanation } from './aiExplanationService';
import { confirmDialog } from './ui/ConfirmDialog';
import { refreshOwnLeaderboardPublic, toPublicLeaderboardRow } from '../lib/leaderboard';
import { DEFAULT_PREP_MODE, getTestPrepMode } from '../lib/prepModes';

interface ExamInterfaceProps {
  test: MockTest;
  user: User;
  instantFeedback?: boolean;
  resolvedSections?: TestSection[];
  attemptId?: string;
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

const ExamInterface: React.FC<ExamInterfaceProps> = ({ test, user, instantFeedback = false, resolvedSections, attemptId, packagedQuestions, onFinish, onExit }) => {
  const isTimedMode = !instantFeedback;
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
  const [revealedAnswers, setRevealedAnswers] = useState<Record<string, boolean>>({});
  const [showMoreInfo, setShowMoreInfo] = useState(false);
  const [aiExplanation, setAiExplanation] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSource, setAiSource] = useState<'cache' | 'generated' | 'fallback' | ''>('');
  const effectiveSections = resolvedSections || test.sections;

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

        const ids = Array.from(new Set(effectiveSections.flatMap(section => section.questionIds)));
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
    const randomized = effectiveSections.map(section => ({
      ...section,
      questionIds: shuffleArray(section.questionIds)
    }));
    setShuffledSections(randomized);
  }, [test, packagedQuestions, effectiveSections]);

  const calculateResult = useCallback(async (status: ExamResult['status']) => {
    const sectionsForResult = shuffledSections.length > 0 ? shuffledSections : effectiveSections;
    const allQuestionIds = sectionsForResult.flatMap(section => section.questionIds);
    const answeredIdSet = new Set(Object.keys(answers || {}));
    const attemptedSections = sectionsForResult
      .map((section) => ({
        ...section,
        questionIds: section.questionIds.filter((qId) => answeredIdSet.has(qId))
      }))
      .filter((section) => section.questionIds.length > 0);
    const attemptedQuestionIds = attemptedSections.flatMap((section) => section.questionIds);
    const answeredQuestionCount = allQuestionIds.reduce((count, qId) => (
      Object.prototype.hasOwnProperty.call(answers, qId) ? count + 1 : count
    ), 0);
    const correctAnsweredCount = allQuestionIds.reduce((count, qId) => {
      const question = allQuestions[qId];
      if (!question) return count;
      return answers[qId] === question.correctAnswerIndex ? count + 1 : count;
    }, 0);
    const sectionBreakdown = sectionsForResult.map((section) => {
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

    const snapshotEntries = attemptedQuestionIds
      .map((qId) => [qId, allQuestions[qId]] as const)
      .filter((entry): entry is [string, Question] => Boolean(entry[1]));
    const questionSnapshot = Object.fromEntries(snapshotEntries) as Record<string, Question>;

    const result: Omit<ExamResult, 'id'> = {
      userId: user.id,
      userName: user.name,
      testId: test.id,
      testName: test.name,
      prepMode: getTestPrepMode(test) || DEFAULT_PREP_MODE,
      score: totalScore,
      maxScore: maxScore,
      correctAnsweredCount,
      answeredQuestionCount,
      totalQuestionCount: allQuestionIds.length,
      completedAt: new Date().toISOString(),
      status: status,
      userAnswers: answers,
      resolvedSections: effectiveSections,
      attemptSections: attemptedSections,
      attemptQuestionIds: attemptedQuestionIds,
      questionSnapshot,
      attemptId: attemptId || undefined,
      sectionBreakdown
    };

    try {
      const docRef = await addDoc(collection(db, 'results'), result);
      await setDoc(doc(db, 'testLeaderboardPublic', docRef.id), toPublicLeaderboardRow(result)).catch(() => undefined);
      await refreshOwnLeaderboardPublic(user.id, { ...result, id: docRef.id }).catch(() => undefined);
      onFinish({ ...result, id: docRef.id } as ExamResult);
    } catch (e) {
      queuePendingResult(result);
      onFinish({ ...result, id: 'temp-' + Date.now() } as ExamResult);
    }
  }, [allQuestions, answers, onFinish, test, user.id, user.name, effectiveSections, attemptId, shuffledSections]);

  useEffect(() => {
    if (!isTimedMode) return;
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
  }, [calculateResult, hasStarted, isTimedMode]);

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

  const exitToDashboard = async () => {
    const confirmed = await confirmDialog({
      title: 'Exit test?',
      message: 'Leave this test and return to dashboard? Your current progress will not be submitted.',
      confirmText: 'Exit',
      variant: 'danger'
    });
    if (!confirmed) return;
    if (timerRef.current) clearInterval(timerRef.current);
    onExit();
  };

  const handleSectionSubmit = async () => {
    if (activeSectionIndex === null) return;
    const confirmed = await confirmDialog({
      title: 'Finish section?',
      message: 'You cannot change your answers after this.',
      confirmText: 'Finish',
      variant: 'primary'
    });
    if (confirmed) {
      setCompletedSections(prev => (
        prev.includes(activeSectionIndex) ? prev : [...prev, activeSectionIndex]
      ));
      returnToLobby();
    }
  };

  const selectAnswer = (questionId: string | undefined, optionIndex: number) => {
    if (!questionId) return;
    if (instantFeedback && revealedAnswers[questionId]) return;
    setAnswers(prev => ({ ...prev, [questionId]: optionIndex }));
    if (instantFeedback) {
      setRevealedAnswers(prev => ({ ...prev, [questionId]: true }));
      setShowMoreInfo(true);
    }
  };

  const finalSubmit = async () => {
    const confirmed = await confirmDialog({
      title: 'Submit test?',
      message: 'Submit your entire test now?',
      confirmText: 'Submit',
      variant: 'primary'
    });
    if (confirmed) {
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

  // Keep these derived values and hooks before any conditional return.
  const activeSection = activeSectionIndex === null ? undefined : shuffledSections[activeSectionIndex];
  const currentQuestionId = activeSection?.questionIds[currentQuestionIndex];
  const currentQuestion = currentQuestionId ? allQuestions[currentQuestionId] : undefined;
  const correctAnswerIndex = currentQuestion?.correctAnswerIndex ?? -1;
  const currentAnswer = currentQuestionId ? answers[currentQuestionId] : undefined;
  const isCurrentRevealed = currentQuestionId ? Boolean(revealedAnswers[currentQuestionId]) : false;
  const timerToneClass = timeRemaining <= 60 ? 'text-red-500' : timeRemaining <= 300 ? 'text-amber-500' : 'text-emerald-500';

  useEffect(() => {
    setAiExplanation('');
    setAiError('');
    setAiSource('');
  }, [currentQuestionId]);

  useEffect(() => {
    if (!instantFeedback || !showMoreInfo || !currentQuestion || !isCurrentRevealed) return;
    let cancelled = false;
    const run = async () => {
      try {
        const localExplanation = currentQuestion.explanation?.trim();
        if (localExplanation) {
          setAiExplanation(localExplanation);
          setAiSource('fallback');
        }
        setAiLoading(true);
        setAiError('');
        const result = await getOrCreateAiExplanation(currentQuestion);
        if (!cancelled) {
          setAiExplanation(result.text);
          setAiSource(result.source);
        }
      } catch (err: any) {
        if (!cancelled) setAiError(err?.message || 'Could not load AI explanation.');
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [instantFeedback, showMoreInfo, currentQuestionId, isCurrentRevealed, currentQuestion]);

  if (isPreparingQuestions) {
    return (
      <div className="v2-page h-full w-full flex flex-col items-center justify-center bg-slate-950 p-8 text-center">
        <img src={logo} className="w-12 h-12 animate-pulse mb-5" alt="Scholar! logo" />
        <p className="text-amber-500 text-xs font-black uppercase tracking-[0.3em] mb-2">Preparing Question Package</p>
        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Please wait...</p>
      </div>
    );
  }

  if (questionLoadError) {
    return (
      <div className="v2-page h-full w-full flex flex-col items-center justify-center bg-slate-50 p-8 text-center">
        <img src={logo} className="w-14 h-14 mb-6" alt="Scholar! logo" />
        <p className="text-red-600 text-xs font-black uppercase tracking-[0.2em] mb-3">Could Not Open Test</p>
        <p className="text-slate-500 text-sm max-w-md mb-8">{questionLoadError}</p>
        <button onClick={onExit} className="px-8 py-3 bg-slate-950 text-amber-500 rounded-xl text-xs font-bold uppercase tracking-widest">Back to Dashboard</button>
      </div>
    );
  }

  if (view === 'lobby') {
    return (
      <div className="v2-page h-full w-full bg-slate-50 flex flex-col overflow-hidden min-h-0 safe-top">
        <header className="v2-shell bg-slate-950 p-6 flex justify-between items-center border-b-4 border-amber-500 text-white shadow-2xl">
          <div className="flex items-center gap-4">
            <img src={logo} className="w-10 h-10" alt="Logo" />
            <div>
              <h1 className="text-xs font-bold uppercase tracking-widest text-amber-500">Scholar!</h1>
              <p className="text-xs text-slate-400 font-bold uppercase truncate max-w-[150px]">{test.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isTimedMode ? (
              <div className="bg-slate-900 border border-slate-800 px-5 py-2 rounded-xl text-amber-400 font-mono text-xl font-bold">
                {hasStarted ? formatTime(timeRemaining) : "READY"}
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 px-5 py-2 rounded-xl text-emerald-400 font-mono text-sm font-bold uppercase tracking-widest">
                Untimed
              </div>
            )}
            <button
              onClick={exitToDashboard}
              className="px-4 py-2 border border-slate-700 text-slate-100 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-slate-900/70"
            >
              Exit
            </button>
          </div>
        </header>

        <main className="flex-1 v2-scroll p-6 md:p-12 safe-bottom">
          <div className="max-w-4xl mx-auto bg-white rounded-[2rem] shadow-xl border border-slate-100 p-8 md:p-12">
            <h2 className="text-2xl font-bold text-slate-950 mb-2 uppercase tracking-tight">Test Instructions</h2>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-3">You can move between sections anytime from the lobby.</p>
            {instantFeedback && (
              <p className="text-emerald-700 text-xs font-bold uppercase tracking-widest mb-10">
                Quiz Mode: answers are revealed instantly after each selection.
              </p>
            )}
            <div className="space-y-4">
              {effectiveSections.map((section, idx) => {
                const isCompleted = completedSections.includes(idx);
                return (
                  <button key={idx} onClick={() => enterSection(idx)} className={`w-full flex justify-between items-center p-6 rounded-2xl border-2 transition-all ${isCompleted ? 'bg-slate-50 border-slate-100' : 'bg-white border-slate-100 hover:border-amber-500'}`}>
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${isCompleted ? 'bg-slate-200 text-slate-400' : 'bg-slate-950 text-amber-500'}`}>{idx + 1}</div>
                      <div className="text-left">
                        <h3 className="font-bold text-slate-950 text-sm uppercase">{section.name}</h3>
                        <p className="text-xs text-slate-400 font-bold uppercase">{section.questionIds.length} Questions</p>
                      </div>
                    </div>
                    <span className={`text-xs font-bold px-4 py-2 rounded-xl uppercase tracking-widest transition-all ${isCompleted ? 'bg-slate-100 text-slate-400' : 'bg-amber-100 text-amber-600'}`}>{isCompleted ? 'Review' : 'Start'}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-12 pt-8 border-t border-slate-50 flex flex-col md:flex-row gap-6 justify-end items-center">
              <button onClick={finalSubmit} disabled={!hasStarted || isFinishing} className="w-full md:w-auto px-10 py-4 bg-slate-950 text-amber-500 rounded-2xl text-xs font-bold uppercase tracking-widest shadow-xl hover:bg-slate-900 transition-all disabled:opacity-30">Submit Final Test</button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!activeSection) {
    return (
      <div className="v2-page h-full w-full flex flex-col items-center justify-center bg-slate-950 p-8 text-center">
        <img src={logo} className="w-12 h-12 animate-pulse mb-5" alt="Scholar! logo" />
        <p className="text-amber-500 text-xs font-black uppercase tracking-[0.3em] mb-2">Preparing Section</p>
        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Please wait...</p>
      </div>
    );
  }

  return (
    <div className="v2-page flex flex-col h-full bg-slate-50 overflow-hidden min-h-0 safe-top">
      <header className="v2-shell bg-slate-950 text-white px-6 py-4 flex justify-between items-center border-b-4 border-amber-500 z-30 shrink-0 sticky top-0">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-8 h-8" alt="Logo" />
          <div className="hidden sm:block">
            <h1 className="text-xs font-bold uppercase tracking-widest text-amber-500">Scholar!</h1>
            <p className="text-xs text-slate-400 font-bold uppercase truncate max-w-[200px] mt-0.5">{test.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={exitToDashboard}
            className="hidden sm:inline-flex px-4 py-2 border border-slate-700 text-slate-100 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-slate-900/70"
          >
            Exit
          </button>
          {isTimedMode ? (
            <div className={`font-mono text-xl font-bold bg-slate-900 px-4 py-1.5 rounded-xl border border-slate-800 ${timerToneClass}`}>{formatTime(timeRemaining)}</div>
          ) : (
            <div className="font-mono text-sm font-bold bg-slate-900 px-4 py-2 rounded-xl border border-slate-800 text-emerald-400 uppercase tracking-widest">Untimed</div>
          )}
          <button onClick={() => setShowNav(!showNav)} className="md:hidden p-2 text-amber-500 bg-slate-900 rounded-xl border border-slate-800"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg></button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative min-h-0">
        <main className="flex-1 flex flex-col p-4 md:p-8 overflow-hidden min-h-0">
          <div className="flex-1 bg-white rounded-[2rem] md:rounded-[3rem] shadow-sm border border-slate-100 v2-scroll p-8 md:p-12">
            <div className="mb-8 border-b border-slate-50 pb-4 flex justify-between items-center">
               <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Question {currentQuestionIndex + 1} of {activeSection.questionIds.length}</span>
               <div className="flex items-center gap-2 q-action-row">
                 {instantFeedback && (
                   <button
                     type="button"
                     onClick={() => setShowMoreInfo(prev => !prev)}
                     className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-widest border ${showMoreInfo ? 'text-sky-700 bg-sky-50 border-sky-200' : 'text-slate-500 bg-white border-slate-200'}`}
                   >
                     {showMoreInfo ? 'Hide More Info' : 'Show More Info'}
                   </button>
                 )}
                 <span className="text-xs font-bold text-amber-600 bg-amber-50 px-3 py-1 rounded-full uppercase tracking-widest">{activeSection.name}</span>
               </div>
            </div>
            <div className="question-text text-[17px] md:text-2xl font-bold text-slate-900 mb-8 leading-tight text-center md:text-left"><ScientificText text={currentQuestion?.text || "Loading..."} /></div>
            {currentQuestion?.imageUrl && (
              <div className="mb-10 rounded-2xl border border-slate-100 bg-slate-50 p-3 md:p-4">
                <img
                  src={currentQuestion.imageUrl}
                  alt={currentQuestion.imageAlt || 'Question diagram'}
                  loading="lazy"
                  className="mx-auto max-h-[48vh] w-full object-contain rounded-xl bg-white"
                />
              </div>
            )}
            <div className="space-y-4">
              {currentQuestion?.options.map((option, idx) => (
                <button
                  key={idx}
                  onClick={() => selectAnswer(currentQuestionId, idx)}
                    disabled={instantFeedback && isCurrentRevealed}
                    className={`w-full text-left p-6 min-h-12 rounded-2xl border-2 transition-all flex items-center ${(instantFeedback && isCurrentRevealed)
                    ? (correctAnswerIndex === idx
                      ? 'border-emerald-500 bg-emerald-50 shadow-sm'
                      : (currentAnswer === idx
                        ? 'border-red-400 bg-red-50 shadow-sm'
                        : 'border-slate-100 bg-white'))
                    : (currentAnswer === idx
                      ? 'border-amber-500 bg-amber-50 shadow-sm'
                      : 'border-slate-50 hover:bg-slate-50 hover:border-slate-200')
                  } ${instantFeedback && isCurrentRevealed ? 'cursor-default' : ''}`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mr-6 font-bold text-base transition-all ${(instantFeedback && isCurrentRevealed)
                    ? (correctAnswerIndex === idx
                      ? 'bg-emerald-500 text-white'
                      : (currentAnswer === idx ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-400'))
                    : (currentAnswer === idx ? 'bg-amber-500 text-slate-950' : 'bg-slate-100 text-slate-400')
                  }`}>{String.fromCharCode(65 + idx)}</div>
                  <ScientificText text={option} className={`text-base font-bold flex-1 ${(instantFeedback && isCurrentRevealed)
                    ? (correctAnswerIndex === idx ? 'text-emerald-700' : (currentAnswer === idx ? 'text-red-700' : 'text-slate-600'))
                    : (currentAnswer === idx ? 'text-slate-950' : 'text-slate-600')
                  }`} />
                </button>
              ))}
            </div>
            {instantFeedback && isCurrentRevealed && currentQuestion && (
              <div className="mt-6 p-4 rounded-2xl border border-emerald-100 bg-emerald-50">
                <p className={`text-xs font-bold uppercase tracking-widest ${currentAnswer === correctAnswerIndex ? 'text-emerald-700' : 'text-red-600'}`}>
                  {currentAnswer === correctAnswerIndex ? 'Correct' : `Incorrect. Correct answer: ${String.fromCharCode(65 + correctAnswerIndex)}`}
                </p>
              </div>
            )}
            {instantFeedback && showMoreInfo && isCurrentRevealed && (
              <div className="mt-6 p-5 rounded-2xl border border-sky-100 bg-sky-50">
                <h4 className="text-xs font-bold uppercase tracking-widest text-sky-700 mb-3">Explanation</h4>
                {aiLoading && <p className="text-xs font-bold uppercase tracking-widest text-sky-700">Loading explanation...</p>}
                {!aiLoading && aiError && <p className="text-xs font-bold uppercase tracking-widest text-red-600">{aiError}</p>}
                {!aiLoading && !aiError && aiSource === 'fallback' && (
                  <p className="mb-3 text-xs font-bold uppercase tracking-widest text-amber-700 bg-amber-100 border border-amber-200 rounded-lg px-3 py-2">
                    AI quota is unavailable. Showing stored local explanation.
                  </p>
                )}
                {!aiLoading && !aiError && aiExplanation && (
                  <div className="text-sm leading-relaxed text-slate-700">
                    <ScientificText text={aiExplanation} />
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        <aside className={`fixed inset-y-0 right-0 w-72 bg-white border-l border-slate-100 z-40 transform transition-transform duration-300 md:relative md:translate-x-0 ${showNav ? 'translate-x-0' : 'translate-x-full'} shadow-2xl md:shadow-none`}>
          <div className="h-full flex flex-col">
            <div className="p-6 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-950 uppercase tracking-widest">Questions</h3>
              <button onClick={() => setShowNav(false)} className="md:hidden text-slate-400"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
            </div>
            <div className="p-4 grid grid-cols-4 gap-2 content-start v2-scroll flex-1">
              {activeSection.questionIds.map((id, idx) => (
                <button key={id} onClick={() => { setCurrentQuestionIndex(idx); setShowNav(false); }} className={`q-dot h-10 rounded-xl text-xs font-bold border transition-all ${idx === currentQuestionIndex ? 'active border-amber-500 bg-amber-500 text-slate-950 shadow-[var(--shadow-gold)]' : answers[id] !== undefined ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-100 text-slate-300 bg-white hover:border-slate-300'}`}>{idx + 1}</button>
              ))}
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100">
              <button onClick={() => { setShowCalculator(!showCalculator); setShowNav(false); }} className="w-full py-4 bg-slate-950 text-amber-500 rounded-xl text-xs font-bold uppercase tracking-widest shadow-lg">Calculator</button>
            </div>
          </div>
        </aside>
      </div>

      <footer className="v2-shell bg-white border-t border-slate-100 p-4 sm:p-6 flex flex-col gap-3 justify-between items-center z-20 shrink-0 safe-bottom sticky bottom-0">
         <div className="hidden sm:block text-xs font-bold text-slate-400 uppercase tracking-widest">You can return to lobby anytime</div>
         <div className="flex gap-2 w-full sm:w-auto">
           <button onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))} disabled={currentQuestionIndex === 0} className="flex-1 px-6 py-3 border-2 border-slate-100 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-slate-50 disabled:opacity-30">Prev</button>
           <button onClick={() => setCurrentQuestionIndex(prev => Math.min(activeSection.questionIds.length - 1, prev + 1))} disabled={currentQuestionIndex === activeSection.questionIds.length - 1} className="flex-1 px-6 py-3 border-2 border-slate-100 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-slate-50 disabled:opacity-30">Next</button>
         </div>
         <div className="sm:hidden grid grid-cols-2 gap-2 w-full">
           <button onClick={returnToLobby} className="px-4 py-3 border-2 border-slate-100 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-slate-50">
             Go To Lobby
           </button>
           <button onClick={handleSectionSubmit} className="px-4 py-3 bg-amber-500 text-slate-950 rounded-xl text-xs font-bold uppercase tracking-widest shadow-md">
             Submit Section
           </button>
         </div>
         <div className="hidden sm:flex gap-2 w-full sm:w-auto">
           <button onClick={exitToDashboard} className="flex-1 sm:flex-none px-6 py-3 border-2 border-red-100 text-red-600 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-red-50">Exit</button>
           <button onClick={returnToLobby} className="flex-1 sm:flex-none px-6 py-3 border-2 border-slate-100 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-slate-50">Lobby</button>
           <button onClick={handleSectionSubmit} className="flex-1 sm:flex-none px-8 py-3 bg-amber-500 text-slate-950 rounded-xl text-xs font-bold uppercase tracking-widest shadow-md">Mark Done</button>
         </div>
      </footer>

      {showCalculator && <Calculator onClose={() => setShowCalculator(false)} />}
      {showNav && <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-30 md:hidden" onClick={() => setShowNav(false)}></div>}
    </div>
  );
};

export default ExamInterface;

