import React from 'react';
import logo from '../assets/logo.png';

interface UpdateManualProps {
  onClose: () => void;
}

const sections = [
  {
    title: 'Universal Update Prompt',
    items: [
      'This manual now opens automatically once per user after login.',
      'Students, admins, and root-admins all see the update once for this version.',
      'You can still reopen it anytime from Settings -> Open What\'s New.'
    ]
  },
  {
    title: 'Mobile Experience Refresh',
    items: [
      'Improved safe-area handling for home-screen installs (A2HS/PWA) on iOS and Android.',
      'Top and bottom overlaps were reduced with viewport + notch aware sizing.',
      'Mobile spacing, typography, and controls were compacted for cleaner usability.'
    ]
  },
  {
    title: 'Theme + UI Mode System',
    items: [
      'Light mode is now default for new users.',
      'Dark mode can be toggled from Settings.',
      'Theme palettes now apply consistently across dashboard and review views.'
    ]
  },
  {
    title: 'Review Stability For Dynamic Tests',
    items: [
      'Attempt question sets are now preserved for review using attempt-linked section data.',
      'Legacy results are backfilled during review when possible.',
      'Review now prioritizes stored attempt questions before fallback pool loading.'
    ]
  },
  {
    title: 'Navigation + Profile Upgrades',
    items: [
      'Dedicated Reviews page added for easier access to past attempts.',
      'Bottom navigation was balanced for symmetry with Create centered.',
      'Profile now supports editing name/title and uploading a profile photo.'
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
              <p className="text-[11px] font-black uppercase tracking-[0.25em] text-amber-600">Version 3.0.0</p>
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

