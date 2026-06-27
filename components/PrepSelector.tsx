import { PrepMode } from '../types';
import logo from '../assets/scholar-main.png';
import PartnershipLogos from './PartnershipLogos';
import { PREP_MODE_DESCRIPTIONS, PREP_MODE_LABELS, PREP_MODES } from '../lib/prepModes';

interface PrepSelectorProps {
  selectedPrepMode: PrepMode;
  onSelect: (mode: PrepMode) => void;
  userName?: string;
}

const modeAccent: Record<PrepMode, string> = {
  utme: 'from-emerald-50 to-white border-emerald-100 text-emerald-700',
  oau: 'from-amber-50 to-white border-amber-100 text-amber-700',
  putme: 'from-sky-50 to-white border-sky-100 text-sky-700'
};

export default function PrepSelector({ selectedPrepMode, onSelect, userName }: PrepSelectorProps) {
  return (
    <div className="v2-page flex-1 min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-center px-4 py-8 safe-top safe-bottom overflow-y-auto">
      <div className="w-full max-w-5xl">
        <div className="flex flex-col items-center text-center mb-8">
          <img src={logo} alt="Scholar! logo" className="w-20 h-20 sm:w-24 sm:h-24 drop-shadow-xl mb-4" />
          <p className="text-amber-600 text-xs font-black uppercase tracking-[0.35em] mb-2">Scholar!</p>
          <h1 className="text-2xl sm:text-4xl font-black uppercase tracking-tight text-slate-950">
            Choose Your Prep
          </h1>
          {userName && (
            <p className="mt-2 text-sm font-bold text-slate-400">
              Welcome, {userName}
            </p>
          )}
          <PartnershipLogos className="mt-5" size="compact" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PREP_MODES.map((mode) => {
            const selected = selectedPrepMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onSelect(mode)}
                className={`text-left rounded-[2rem] border bg-gradient-to-br p-6 sm:p-7 shadow-sm transition-all active:scale-[0.99] hover:-translate-y-1 hover:shadow-xl ${modeAccent[mode]} ${selected ? 'ring-4 ring-slate-950/10' : ''}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.28em] opacity-70">Prep Mode</p>
                    <h2 className="mt-3 text-2xl font-black uppercase tracking-tight text-slate-950">
                      {PREP_MODE_LABELS[mode]}
                    </h2>
                  </div>
                  {selected && (
                    <span className="rounded-full bg-slate-950 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-400">
                      Selected
                    </span>
                  )}
                </div>
                <p className="mt-5 text-sm font-bold leading-relaxed text-slate-500">
                  {PREP_MODE_DESCRIPTIONS[mode]}
                </p>
                <div className="mt-8 text-xs font-black uppercase tracking-[0.22em]">
                  Continue
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
