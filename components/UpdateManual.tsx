import React, { useEffect, useMemo, useState } from 'react';
import logo from '../assets/scholar-main.png';

interface UpdateManualProps {
  version: string;
  onClose: () => void;
}

const sections = [
  {
    title: 'Courses Module (New)',
    items: [
      'New Courses workspace with course library, timed reading sessions, and session history.',
      'Admins can upload HTML course files from Courses -> Manage.',
      'Courses support publish/unpublish state and tag-based search.',
      'Course rendering now uses a sandboxed HTML viewer with modern viewport support.'
    ]
  },
  {
    title: 'Timed Study Sessions',
    items: [
      'Each course starts with a configurable countdown timer.',
      'Sessions auto-complete with timed-out state when timer reaches zero.',
      'Progress checklist tracks heading-level completion during reading.',
      'Session records store duration, progress, and completion status.'
    ]
  },
  {
    title: 'Admin Access + Navigation',
    items: [
      'Direct Courses button added in Admin header for quick access.',
      'Students and admins can open Courses from dashboard entry points.',
      'Firestore rules now include courses and courseSessions collections.'
    ]
  },
  {
    title: 'Update Manual Behavior (V3.15)',
    items: [
      'This manual now displays globally once per app version on login.',
      'It appears for all roles (student, admin, root-admin) once in this browser/device.',
      'Manual remains accessible from Settings -> Open What\'s New.',
      'Clearing app data resets this state and can replay the manual.'
    ]
  }
];

const UpdateManual: React.FC<UpdateManualProps> = ({ version, onClose }) => {
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowIntro(false), 1800);
    return () => window.clearTimeout(timer);
  }, []);

  const headerLabel = useMemo(() => `Version ${version}`, [version]);

  if (showIntro) {
    return (
      <div className="v2-page min-h-[100dvh] bg-slate-950 safe-top safe-bottom flex items-center justify-center p-6">
        <div className="relative w-full max-w-md rounded-[2rem] border border-amber-400/20 bg-slate-900 p-8 overflow-hidden">
          <div className="absolute -top-10 -left-10 w-32 h-32 rounded-full bg-amber-400/20 blur-2xl animate-pulse"></div>
          <div className="absolute -bottom-10 -right-10 w-36 h-36 rounded-full bg-cyan-300/10 blur-2xl animate-pulse"></div>
          <div className="relative flex flex-col items-center text-center">
            <img src={logo} alt="Scholar! logo" className="w-16 h-16 mb-4 animate-pulse" />
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-400 mb-2">Scholar!</p>
            <h1 className="text-2xl font-black text-white uppercase tracking-tight">What&apos;s New</h1>
            <p className="text-xs text-slate-300 mt-2">{headerLabel}</p>
            <div className="mt-5 w-40 h-1 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full w-1/2 bg-amber-400 animate-pulse"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="v2-page min-h-[100dvh] bg-slate-50 safe-top safe-bottom">
      <div className="max-w-5xl mx-auto p-6 md:p-10 space-y-6">
        <div className="v2-surface p-6 md:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="flex items-center gap-4">
            <img src={logo} alt="Scholar! logo" className="w-14 h-14" />
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.25em] text-amber-600">{headerLabel}</p>
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 leading-tight">Update Manual</h1>
              <p className="text-sm text-slate-500 mt-1">Courses release, admin upload workflow, and global one-time update prompt</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3 rounded-xl bg-slate-900 text-amber-400 text-[11px] font-black uppercase tracking-widest"
          >
            Back
          </button>
        </div>

        <section className="v2-surface p-5 md:p-6 border border-amber-100">
          <p className="text-xs font-black uppercase tracking-widest text-amber-700">Release Note</p>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            v{version} introduces the full Courses feature set. Admins can upload HTML courses, learners can run timed study sessions with
            progress tracking, and all sessions are recorded for history and analytics workflows.
          </p>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {sections.map((section) => (
            <section key={section.title} className="v2-surface p-6 md:p-7">
              <h2 className="text-lg font-black text-slate-900 mb-3">{section.title}</h2>
              <ul className="space-y-2 text-sm text-slate-600">
                {section.items.map((item) => (
                  <li key={item} className="leading-relaxed">- {item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default UpdateManual;
