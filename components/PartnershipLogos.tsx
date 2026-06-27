import partner1 from '../assets/scholar-partner1.png';
import partner2 from '../assets/scholar-partner2.png';

interface PartnershipLogosProps {
  className?: string;
  variant?: 'light' | 'dark';
  size?: 'compact' | 'default';
}

export default function PartnershipLogos({
  className = '',
  variant = 'light',
  size = 'default'
}: PartnershipLogosProps) {
  const isDark = variant === 'dark';
  const labelClass = isDark ? 'text-white/45' : 'text-slate-400';
  const separatorClass = isDark ? 'bg-white/15' : 'bg-slate-200';
  const logoClass = size === 'compact' ? 'h-5 max-w-[72px]' : 'h-7 sm:h-8 max-w-[104px]';
  const gapClass = size === 'compact' ? 'gap-3' : 'gap-4';

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <p className={`text-[9px] sm:text-[10px] font-black uppercase tracking-[0.22em] ${labelClass}`}>
        In partnership with
      </p>
      <div className={`mt-2 flex items-center justify-center ${gapClass}`}>
        <img src={partner1} alt="Partner 1" className={`${logoClass} w-auto object-contain opacity-70`} />
        <span className={`h-6 w-px ${separatorClass}`} aria-hidden="true"></span>
        <img src={partner2} alt="Partner 2" className={`${logoClass} w-auto object-contain opacity-70`} />
      </div>
    </div>
  );
}
