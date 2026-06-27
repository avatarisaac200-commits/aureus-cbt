import { useCallback, useEffect, useRef } from 'react';
import './SplashScreen.css';
import mainLogo from '../assets/scholar-main.png';
import partner1 from '../assets/scholar-partner1.png';
import partner2 from '../assets/scholar-partner2.png';

interface SplashScreenProps {
  onDone: () => void;
}

export default function SplashScreen({ onDone }: SplashScreenProps) {
  const splashRef = useRef<HTMLDivElement | null>(null);
  const exitingRef = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const exit = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    splashRef.current?.classList.add('exiting');
    window.setTimeout(() => onDoneRef.current(), 800);
  }, []);

  useEffect(() => {
    document.body.classList.add('splash-active');
    const timer = window.setTimeout(exit, 3500);
    return () => {
      window.clearTimeout(timer);
      document.body.classList.remove('splash-active');
    };
  }, [exit]);

  return (
    <div id="splash" ref={splashRef} role="status" aria-label="Loading Scholar!">
      <div className="orbs">
        <div className="orb orb-a"></div>
        <div className="orb orb-b"></div>
        <div className="orb orb-c"></div>
      </div>

      <div className="content">
        <div className="logo-wrap">
          <div className="logo-glow"></div>
          <img className="logo-img" src={mainLogo} alt="Scholar! logo" />
          <div className="tagline">Mindset over matter. Act like a Scholar.</div>
        </div>

        <div className="divider"></div>
        <div className="partner-label">In partnership with</div>

        <div className="partners">
          <div className="partner p1">
            <img className="partner-img" src={partner1} alt="Partner 1" />
          </div>
          <div className="partner-sep"></div>
          <div className="partner p2">
            <img className="partner-img" src={partner2} alt="Partner 2" />
          </div>
        </div>
      </div>

      <div className="progress-track">
        <div className="progress-bar">
          <div className="progress-shimmer"></div>
        </div>
      </div>

      <button id="dismiss" type="button" onClick={exit} aria-label="Skip loading screen">
        Skip
      </button>
    </div>
  );
}
