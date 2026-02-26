import React from 'react';
import logo from '../assets/logo.png';

interface UpdateManualProps {
  onClose: () => void;
}

const sections = [
  {
    title: 'Visual Refresh',
    items: [
      'New V2 visual language with cleaner spacing, typography, and modern surfaces.',
      'Consistent shell styling across student, admin, and root-admin pages.',
      'Improved contrast and readability for long sessions.'
    ]
  },
  {
    title: 'Navigation And Usability',
    items: [
      'Added a dedicated update manual page for release notes.',
      'Improved page structure and layout hierarchy for faster scanning.',
      'Desktop context actions remain available on right-click for computer users.'
    ]
  },
  {
    title: 'Question Bank And Dashboard',
    items: [
      'Folder-based test organization on the first page with strict max of 10 folders.',
      'Sorting controls for tighter test discovery (latest, name, duration, popularity).',
      'Per-user persistence for folder assignments and sort preferences.'
    ]
  },
  {
    title: 'Stability And Compatibility',
    items: [
      'No core exam behavior changed, including section-by-section test flow.',
      'All critical workflows preserved: auth, test packaging, attempts, review, analytics.',
      'UI redesign implemented without altering grading logic or data contracts.'
    ]
  }
];

const UpdateManual: React.FC<UpdateManualProps> = ({ onClose }) => {
  return (
    <div className="v2-page min-h-[100dvh] bg-slate-50 safe-top safe-bottom">
      <div className="max-w-5xl mx-auto p-6 md:p-10 space-y-6">
        <div className="v2-surface p-6 md:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="flex items-center gap-4">
            <img src={logo} alt="Aureus Medicos CBT Logo" className="w-14 h-14" />
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.25em] text-amber-600">Version 2.0.1</p>
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 leading-tight">Update Manual</h1>
              <p className="text-sm text-slate-500 mt-1">What is new in the redesigned release</p>
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {sections.map((section) => (
            <section key={section.title} className="v2-surface p-6 md:p-7">
              <h2 className="text-lg font-black text-slate-900 mb-3">{section.title}</h2>
              <ul className="space-y-2 text-sm text-slate-600">
                {section.items.map((item) => (
                  <li key={item} className="leading-relaxed">{item}</li>
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
