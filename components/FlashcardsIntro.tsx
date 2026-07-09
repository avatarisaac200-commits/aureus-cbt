import React, { useEffect, useState } from 'react';
import { User } from '../types';

interface FlashcardsIntroProps {
  user: User;
  onTryNow: () => void;
}

const INTRO_VERSION = '2026-07-flashcards-v1';

const getSeenKey = (userId: string) => `flashcardsIntroSeen:${INTRO_VERSION}:${userId}`;

const FlashcardsIntro: React.FC<FlashcardsIntroProps> = ({ user, onTryNow }) => {
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<'entering' | 'flipped' | 'leaving'>('entering');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = getSeenKey(user.id);
    if (window.localStorage.getItem(key) === '1') return;
    setVisible(true);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setPhase('flipped');
      return;
    }
    const timer = window.setTimeout(() => setPhase('flipped'), 850);
    return () => window.clearTimeout(timer);
  }, [user.id]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible]);

  const rememberSeen = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(getSeenKey(user.id), '1');
    }
  };

  const dismiss = () => {
    rememberSeen();
    setPhase('leaving');
    window.setTimeout(() => setVisible(false), 220);
  };

  const tryNow = () => {
    rememberSeen();
    setVisible(false);
    onTryNow();
  };

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[260] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-md ${phase === 'leaving' ? 'animate-out fade-out' : 'animate-in fade-in'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="flashcards-intro-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <style>{`
        .flashcard-intro-deck { perspective: 1200px; }
        .flashcard-intro-card { transform-style: preserve-3d; transition: transform .7s cubic-bezier(.2,.8,.2,1), opacity .35s ease; }
        .flashcard-intro-face { backface-visibility: hidden; }
        .flashcard-intro-front { transform: rotateY(180deg); }
        .flashcard-intro-flipped { transform: rotateY(180deg); }
        .flashcard-intro-back-0 { transform: translate(-26px, 13px) rotate(-10deg); }
        .flashcard-intro-back-1 { transform: translate(18px, 9px) rotate(7deg); }
        .flashcard-intro-enter .flashcard-intro-card { opacity: 0; transform: translateY(26px) scale(.94); }
        @media (prefers-reduced-motion: reduce) {
          .flashcard-intro-card { transition: none !important; }
          .flashcard-intro-enter .flashcard-intro-card { opacity: 1; transform: none; }
        }
      `}</style>
      <div className="absolute h-72 w-72 rounded-full bg-amber-500/20 blur-3xl"></div>
      <div className={`flashcard-intro-deck relative h-[390px] w-[min(330px,calc(100vw-2rem))] ${phase === 'entering' ? 'flashcard-intro-enter' : ''}`}>
        <div className="flashcard-intro-card flashcard-intro-back-0 absolute inset-x-5 inset-y-6 rounded-2xl bg-slate-800 border border-slate-700 shadow-2xl"></div>
        <div className="flashcard-intro-card flashcard-intro-back-1 absolute inset-x-5 inset-y-6 rounded-2xl bg-slate-700 border border-slate-600 shadow-2xl"></div>
        <div className={`flashcard-intro-card absolute inset-0 rounded-[1.75rem] shadow-2xl ${phase === 'flipped' ? 'flashcard-intro-flipped' : ''}`}>
          <div className="flashcard-intro-face absolute inset-0 rounded-[1.75rem] bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700"></div>
          <div className="flashcard-intro-face flashcard-intro-front absolute inset-0 rounded-[1.75rem] bg-amber-50 border border-amber-100 p-7 flex flex-col justify-center overflow-hidden">
            <span className="absolute right-0 top-0 h-12 w-12 bg-amber-500 [clip-path:polygon(100%_0,0_0,100%_100%)]"></span>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-teal-700 mb-3">New study tool</p>
            <h2 id="flashcards-intro-title" className="text-3xl font-black leading-tight text-slate-950 uppercase">Introducing Flashcards</h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              Flip through quick recall cards from curated decks or your existing tests.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <button onClick={tryNow} className="px-5 py-3 rounded-2xl bg-slate-950 text-amber-500 text-xs font-black uppercase tracking-widest">
                Try it now
              </button>
              <button onClick={dismiss} className="px-5 py-3 rounded-2xl bg-white border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest">
                Maybe later
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FlashcardsIntro;
