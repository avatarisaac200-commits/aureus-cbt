import React from 'react';
import logo from '../assets/logo.png';

interface UpdateManualProps {
  onClose: () => void;
}

const sections = [
  {
    title: 'How To Access Updates',
    items: [
      'The floating "What\'s New" button has been removed from the main app shell.',
      'You can now open this page manually from Settings whenever you want.',
      'This keeps exam flow cleaner and avoids extra UI during focused sessions.'
    ]
  },
  {
    title: 'Themes And Readability',
    items: [
      'Theme palettes were refreshed with more modern, complementary colors.',
      'Neo Black readability has been improved with better contrast and accent tuning.',
      'Theme previews remain available in Settings under the Theme section.'
    ]
  },
  {
    title: 'Per-User Theme Memory',
    items: [
      'Theme choice is now saved per user profile on the same browser.',
      'Logging out no longer forces the next user to inherit the previous user\'s theme.',
      'Each account now loads its own saved theme preference after login.'
    ]
  },
  {
    title: 'Admin Test Editing',
    items: [
      'CSV dynamic tests now support inline content editing from Admin > Tests > Edit.',
      'After CSV pool edits are saved, affected stored result scores are recalculated.',
      'CSV per-user count, marks, and bundle settings can be updated while editing.'
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
              <p className="text-[11px] font-black uppercase tracking-[0.25em] text-amber-600">Version 2.0.2</p>
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 leading-tight">Update Manual</h1>
              <p className="text-sm text-slate-500 mt-1">Recent improvements and behavior updates</p>
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
