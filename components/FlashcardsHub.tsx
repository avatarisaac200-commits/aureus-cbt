import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import { Flashcard, FlashcardConfidence, FlashcardProgress, FlashcardSession, MockTest, Question, User } from '../types';
import { buildFlashcardsFromQuestions, getFlashcardProgressId, getNextReviewAt, sortFlashcardsForStudy } from '../lib/flashcards';
import { collection, doc, documentId, getDocs, limit, onSnapshot, query, setDoc, where, addDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { toast } from './ui/Toast';

interface FlashcardsHubProps {
  user: User;
  isReadOnly?: boolean;
  onBack: () => void;
}

const CARD_LOAD_LIMIT = 80;
const QUERY_CHUNK_SIZE = 10;

const confidenceLabels: Record<FlashcardConfidence, string> = {
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy'
};

const confidenceStyles: Record<FlashcardConfidence, string> = {
  again: 'bg-red-50 text-red-700 border-red-100',
  hard: 'bg-orange-50 text-orange-700 border-orange-100',
  good: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  easy: 'bg-sky-50 text-sky-700 border-sky-100'
};

const chunk = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const unique = (items: string[]) => Array.from(new Set(items.filter(Boolean)));

const getTestQuestionIds = (test: MockTest) => {
  return unique((test.sections || []).flatMap((section) => section.questionIds || [])).slice(0, CARD_LOAD_LIMIT);
};

const getSessionBreakdown = (session: FlashcardSession | null) => {
  return session?.confidenceBreakdown || { again: 0, hard: 0, good: 0, easy: 0 };
};

const FlashcardsHub: React.FC<FlashcardsHubProps> = ({ user, isReadOnly = false, onBack }) => {
  const [tests, setTests] = useState<MockTest[]>([]);
  const [selectedTestId, setSelectedTestId] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [curatedCards, setCuratedCards] = useState<Flashcard[]>([]);
  const [progressRows, setProgressRows] = useState<FlashcardProgress[]>([]);
  const [loadingTests, setLoadingTests] = useState(true);
  const [loadingCards, setLoadingCards] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [session, setSession] = useState<FlashcardSession | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'tests'), where('isApproved', '==', true), limit(50)),
      (snap) => {
        const rows = snap.docs
          .map((row) => ({ ...row.data(), id: row.id } as MockTest))
          .filter((test) => getTestQuestionIds(test).length > 0)
          .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        setTests(rows);
        setLoadingTests(false);
        setSelectedTestId((current) => current || rows[0]?.id || '');
      },
      (err) => {
        console.error('Flashcard test load error:', err);
        setLoadError('Unable to load flashcard decks.');
        setLoadingTests(false);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'flashcards'), where('isPublished', '==', true), limit(500)),
      (snap) => {
        const rows = snap.docs
          .map((row) => ({ ...row.data(), id: row.id } as Flashcard))
          .filter((card) => card.front && card.back)
          .sort((a, b) => `${a.subject || ''}:${a.topic || ''}:${a.front || ''}`.localeCompare(`${b.subject || ''}:${b.topic || ''}:${b.front || ''}`));
        setCuratedCards(rows);
        setSelectedTestId((current) => current || (rows.length > 0 ? 'curated' : ''));
      },
      () => setCuratedCards([])
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'flashcardProgress'), where('userId', '==', user.id), limit(1000)),
      (snap) => {
        setProgressRows(snap.docs.map((row) => ({ ...row.data(), id: row.id } as FlashcardProgress)));
      },
      () => setProgressRows([])
    );
    return () => unsub();
  }, [user.id]);

  const isCuratedDeck = selectedTestId === 'curated';
  const selectedTest = isCuratedDeck ? null : tests.find((test) => test.id === selectedTestId) || null;

  useEffect(() => {
    let cancelled = false;
    const loadQuestions = async () => {
    if (isCuratedDeck || !selectedTest) {
      setQuestions([]);
      return;
    }

      const ids = getTestQuestionIds(selectedTest);
      if (ids.length === 0) {
        setQuestions([]);
        return;
      }

      setLoadingCards(true);
      setLoadError(null);
      setIndex(0);
      setIsRevealed(false);
      setSession(null);

      try {
        const loaded: Question[] = [];
        for (const idsChunk of chunk(ids, QUERY_CHUNK_SIZE)) {
          const snap = await getDocs(query(collection(db, 'questions'), where(documentId(), 'in', idsChunk)));
          snap.docs.forEach((row) => loaded.push({ ...row.data(), id: row.id } as Question));
        }
        if (cancelled) return;
        const byId = new Map(loaded.map((question) => [question.id, question]));
        setQuestions(ids.map((id) => byId.get(id)).filter((question): question is Question => Boolean(question)));
      } catch (err) {
        console.error('Flashcard question load error:', err);
        if (!cancelled) {
          setQuestions([]);
          setLoadError('Unable to load cards for this deck.');
        }
      } finally {
        if (!cancelled) setLoadingCards(false);
      }
    };

    void loadQuestions();
    return () => {
      cancelled = true;
    };
  }, [selectedTestId, selectedTest, isCuratedDeck]);

  const progressByCardId = useMemo(() => {
    return progressRows.reduce<Record<string, FlashcardProgress>>((acc, row) => {
      acc[row.flashcardId] = row;
      return acc;
    }, {});
  }, [progressRows]);

  const cards = useMemo(() => {
    if (isCuratedDeck) {
      return sortFlashcardsForStudy(curatedCards, progressByCardId);
    }
    const built = buildFlashcardsFromQuestions(questions, selectedTest ? { testId: selectedTest.id, testName: selectedTest.name } : undefined);
    return sortFlashcardsForStudy(built, progressByCardId);
  }, [questions, selectedTest, progressByCardId, isCuratedDeck, curatedCards]);

  const activeCard = cards[index] || null;
  const dueCount = cards.filter((card) => !progressByCardId[card.id]?.nextReviewAt || Date.parse(progressByCardId[card.id].nextReviewAt!) <= Date.now()).length;
  const masteredCount = cards.filter((card) => ['good', 'easy'].includes(progressByCardId[card.id]?.confidence || '')).length;
  const breakdown = getSessionBreakdown(session);

  const startSessionIfNeeded = () => {
    if (session || !selectedTest) return session;
    const started: FlashcardSession = {
      id: `local_${Date.now()}`,
      userId: user.id,
      sourceTestId: selectedTest.id,
      sourceTestName: selectedTest.name,
      cardCount: cards.length,
      reviewedCount: 0,
      startedAt: new Date().toISOString(),
      confidenceBreakdown: { again: 0, hard: 0, good: 0, easy: 0 }
    };
    setSession(started);
    return started;
  };

  const recordConfidence = async (confidence: FlashcardConfidence) => {
    if (!activeCard || isReadOnly) return;
    const now = new Date().toISOString();
    const existing = progressByCardId[activeCard.id];
    const progressId = getFlashcardProgressId(user.id, activeCard.id);
    const payload: FlashcardProgress = {
      id: progressId,
      userId: user.id,
      flashcardId: activeCard.id,
      sourceQuestionId: activeCard.sourceQuestionId || activeCard.id,
      sourceTestId: activeCard.sourceTestId,
      confidence,
      reviewCount: (existing?.reviewCount || 0) + 1,
      lastReviewedAt: now,
      nextReviewAt: getNextReviewAt(confidence, new Date(now))
    };

    try {
      await setDoc(doc(db, 'flashcardProgress', progressId), payload, { merge: true });
      const currentSession = startSessionIfNeeded();
      const nextSession: FlashcardSession = {
        ...(currentSession || {
          id: `local_${Date.now()}`,
          userId: user.id,
          cardCount: cards.length,
          reviewedCount: 0,
          startedAt: now,
          confidenceBreakdown: { again: 0, hard: 0, good: 0, easy: 0 }
        }),
        reviewedCount: (currentSession?.reviewedCount || 0) + 1,
        confidenceBreakdown: {
          ...getSessionBreakdown(currentSession),
          [confidence]: getSessionBreakdown(currentSession)[confidence] + 1
        }
      };
      setSession(nextSession);

      const isLast = index >= cards.length - 1;
      if (isLast) {
        const { id: _localId, ...sessionPayload } = nextSession;
        await addDoc(collection(db, 'flashcardSessions'), {
          ...sessionPayload,
          completedAt: new Date().toISOString()
        });
        toast.success('Session complete', `Reviewed ${nextSession.reviewedCount} card(s).`);
      } else {
        setIndex((value) => Math.min(value + 1, cards.length - 1));
        setIsRevealed(false);
      }
    } catch (err: any) {
      console.error('Flashcard progress save error:', err);
      toast.error('Progress not saved', err?.message || 'Could not save this card review.');
    }
  };

  const resetSession = () => {
    setIndex(0);
    setIsRevealed(false);
    setSession(null);
  };

  return (
    <div className="v2-page flex-1 min-h-0 bg-slate-50 overflow-hidden">
      <div className="v2-shell bg-slate-950 px-5 md:px-8 py-5 border-b border-slate-900 safe-top">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-amber-500">Study System</p>
            <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-white">Flashcards</h1>
          </div>
          <button onClick={onBack} className="px-4 py-3 rounded-xl border border-slate-700 text-slate-200 text-xs font-black uppercase tracking-widest">
            Dashboard
          </button>
        </div>
      </div>

      <div className="v2-scroll h-[calc(100svh-86px)] p-4 md:p-8 safe-bottom">
        <div className="max-w-6xl mx-auto grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-6">
          <aside className="space-y-4">
            <section className="bg-white border border-slate-100 rounded-[2rem] p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Deck Source</p>
              <select
                value={selectedTestId}
                onChange={(event) => setSelectedTestId(event.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm font-bold text-slate-900"
              >
                {curatedCards.length > 0 && <option value="curated">Curated Admin Deck</option>}
                {tests.map((test) => (
                  <option key={test.id} value={test.id}>{test.name}</option>
                ))}
              </select>
              {loadingTests && <p className="mt-4 text-xs font-black uppercase tracking-widest text-slate-400">Loading decks...</p>}
              {loadError && <p className="mt-4 text-xs font-bold text-red-600">{loadError}</p>}
            </section>

            <section className="grid grid-cols-3 gap-2">
              <div className="bg-white border border-slate-100 rounded-2xl p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cards</p>
                <p className="text-2xl font-black text-slate-950">{cards.length}</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-2xl p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Due</p>
                <p className="text-2xl font-black text-amber-600">{dueCount}</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-2xl p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Strong</p>
                <p className="text-2xl font-black text-emerald-600">{masteredCount}</p>
              </div>
            </section>

            <section className="bg-white border border-slate-100 rounded-[2rem] p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">This Session</p>
                <button onClick={resetSession} className="text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-700">Reset</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(confidenceLabels) as FlashcardConfidence[]).map((key) => (
                  <div key={key} className={`rounded-xl border px-3 py-2 ${confidenceStyles[key]}`}>
                    <p className="text-[10px] font-black uppercase tracking-widest">{confidenceLabels[key]}</p>
                    <p className="text-lg font-black">{breakdown[key]}</p>
                  </div>
                ))}
              </div>
            </section>
          </aside>

          <main className="min-w-0">
            <section className="bg-white border border-slate-100 rounded-[2.5rem] p-5 md:p-8 shadow-sm min-h-[620px] flex flex-col">
              {loadingCards ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <div className="w-10 h-10 rounded-full border-4 border-amber-500 border-t-transparent animate-spin mb-4"></div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400">Building cards...</p>
                </div>
              ) : !activeCard ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">No Cards Available</p>
                  <h2 className="text-2xl font-black text-slate-950 uppercase">Choose another deck</h2>
                </div>
              ) : (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-amber-600">{activeCard.subject}</p>
                      <h2 className="text-lg font-black uppercase text-slate-950">{activeCard.topic}</h2>
                    </div>
                    <span className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-black uppercase tracking-widest text-slate-500">
                      {index + 1} / {cards.length}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      startSessionIfNeeded();
                      setIsRevealed(true);
                    }}
                    className="text-left flex-1 rounded-[2rem] border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 md:p-10 shadow-inner min-h-[360px] focus:outline-none focus:ring-4 focus:ring-amber-200"
                    aria-live="polite"
                  >
                    <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-400 mb-5">{isRevealed ? 'Answer' : 'Prompt'}</p>
                    {!isRevealed ? (
                      <p className="text-xl md:text-3xl font-black leading-snug text-slate-950">{activeCard.front}</p>
                    ) : (
                      <div className="space-y-5">
                        <p className="text-2xl md:text-4xl font-black leading-tight text-emerald-700">{activeCard.back}</p>
                        {activeCard.explanation && (
                          <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4">
                            <p className="text-xs font-black uppercase tracking-widest text-amber-700 mb-2">Why</p>
                            <p className="text-sm leading-relaxed text-slate-700">{activeCard.explanation}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </button>

                  <div className="mt-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setIsRevealed((value) => !value)}
                      className="px-5 py-4 rounded-2xl bg-slate-950 text-amber-500 text-xs font-black uppercase tracking-widest"
                    >
                      {isRevealed ? 'Hide Answer' : 'Reveal Answer'}
                    </button>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(Object.keys(confidenceLabels) as FlashcardConfidence[]).map((key) => (
                        <button
                          key={key}
                          type="button"
                          disabled={!isRevealed || isReadOnly}
                          onClick={() => void recordConfidence(key)}
                          className={`px-4 py-4 rounded-2xl border text-xs font-black uppercase tracking-widest disabled:opacity-40 ${confidenceStyles[key]}`}
                        >
                          {confidenceLabels[key]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {isReadOnly && (
                    <p className="mt-4 text-xs font-bold uppercase tracking-widest text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl p-4">
                      Activate your license to save flashcard progress.
                    </p>
                  )}
                </>
              )}
            </section>
          </main>
        </div>
      </div>
    </div>
  );
};

export default FlashcardsHub;
