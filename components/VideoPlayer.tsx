import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VideoLesson } from '../types';
import { formatVideoDuration, getYoutubeEmbedUrl } from '../lib/videoLearning';

interface VideoPlayerProps {
  lesson: VideoLesson;
  initialPositionSeconds?: number;
  autoPlay?: boolean;
  onProgress?: (positionSeconds: number, durationSeconds: number) => void;
  onComplete?: () => void;
  onNext?: () => void;
  onBackToApp?: () => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  lesson,
  initialPositionSeconds = 0,
  autoPlay = false,
  onProgress,
  onComplete,
  onNext,
  onBackToApp
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isTheater, setIsTheater] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [position, setPosition] = useState(Math.max(0, initialPositionSeconds || 0));
  const [isReady, setIsReady] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);

  const duration = Math.max(lesson.duration || 0, 0);
  const embedUrl = useMemo(() => getYoutubeEmbedUrl(lesson.youtubeVideoId, initialPositionSeconds), [lesson.youtubeVideoId, initialPositionSeconds]);

  const sendCommand = useCallback((func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({
      event: 'command',
      func,
      args
    }), 'https://www.youtube.com');
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const next = Math.max(0, Math.min(seconds, duration || seconds));
    setPosition(next);
    sendCommand('seekTo', [next, true]);
    onProgress?.(next, duration);
  }, [duration, onProgress, sendCommand]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      sendCommand('pauseVideo');
      setIsPlaying(false);
    } else {
      sendCommand('playVideo');
      setIsPlaying(true);
    }
  }, [isPlaying, sendCommand]);

  const unlockOrientation = useCallback(() => {
    const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
    orientation?.unlock?.();
  }, []);

  const lockLandscape = useCallback(async () => {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: OrientationLockType) => Promise<void> };
    await orientation?.lock?.('landscape').catch(() => undefined);
  }, []);

  const requestFullscreen = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined).finally(unlockOrientation);
      return;
    }
    el.requestFullscreen?.()
      .then(() => {
        if (window.matchMedia('(max-width: 768px)').matches) void lockLandscape();
      })
      .catch(() => undefined);
  }, [lockLandscape, unlockOrientation]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) unlockOrientation();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      unlockOrientation();
    };
  }, [unlockOrientation]);

  useEffect(() => {
    setPosition(Math.max(0, initialPositionSeconds || 0));
    setIsPlaying(autoPlay);
    setIsReady(false);
    setHasCompleted(false);
  }, [autoPlay, initialPositionSeconds, lesson.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      }
      if (event.key === 'ArrowRight') seekTo(position + 10);
      if (event.key === 'ArrowLeft') seekTo(position - 10);
      if (event.key.toLowerCase() === 'f') requestFullscreen();
      if (event.key.toLowerCase() === 't') setIsTheater((value) => !value);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [position, requestFullscreen, seekTo, togglePlayback]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const timer = window.setInterval(() => {
      setPosition((prev) => {
        const next = duration > 0 ? Math.min(prev + speed, duration) : prev + speed;
        onProgress?.(next, duration);
        if (duration > 0 && next >= duration * 0.92 && !hasCompleted) {
          setHasCompleted(true);
          onComplete?.();
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [duration, hasCompleted, isPlaying, onComplete, onProgress, speed]);

  useEffect(() => {
    sendCommand('setPlaybackRate', [speed]);
  }, [sendCommand, speed]);

  const percent = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;

  return (
    <div className={isTheater ? 'fixed inset-0 z-[180] bg-black p-0 md:p-6 flex items-center justify-center' : ''}>
      <div ref={wrapperRef} className="relative overflow-hidden bg-black shadow-2xl border border-white/10 rounded-[1.5rem] video-player-shell">
        {onBackToApp && (
          <button
            type="button"
            onClick={onBackToApp}
            className="absolute left-3 top-3 z-20 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/20 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-950 shadow-lg hover:bg-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-300"
            aria-label="Back to main app"
          >
            <span aria-hidden="true">&larr;</span>
            <span>Back to app</span>
          </button>
        )}
        {!isReady && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950">
            <div className="w-12 h-12 rounded-full border-4 border-white/10 border-t-amber-400 animate-spin mb-4"></div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-amber-400">Loading Lecture</p>
          </div>
        )}
        <iframe
          ref={iframeRef}
          key={lesson.id}
          src={embedUrl}
          title={lesson.title}
          className="aspect-video w-full min-h-[220px] md:min-h-[420px]"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          onLoad={() => {
            setIsReady(true);
            if (autoPlay) window.setTimeout(() => sendCommand('playVideo'), 500);
            if (speed !== 1) window.setTimeout(() => sendCommand('setPlaybackRate', [speed]), 500);
          }}
        />
        <div className="bg-slate-950 border-t border-white/10 px-4 py-3 md:px-5 text-white">
          <input
            type="range"
            min={0}
            max={duration || Math.max(position, 1)}
            value={Math.min(position, duration || position)}
            onChange={(event) => seekTo(Number(event.target.value))}
            className="w-full accent-amber-400"
            aria-label="Seek video"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-white">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={togglePlayback} className="w-11 h-11 rounded-xl bg-amber-300 text-slate-950 text-sm font-black shadow-sm hover:bg-amber-200 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-100" aria-label={isPlaying ? 'Pause video' : 'Play video'}>
                {isPlaying ? 'II' : '▶'}
              </button>
              <button onClick={() => seekTo(position - 10)} className="px-3 h-11 rounded-xl border border-white/20 bg-white text-slate-950 text-xs font-black uppercase tracking-widest hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-white">-10s</button>
              <button onClick={() => seekTo(position + 10)} className="px-3 h-11 rounded-xl border border-white/20 bg-white text-slate-950 text-xs font-black uppercase tracking-widest hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-white">+10s</button>
              <span className="text-xs font-bold text-white tabular-nums">{formatVideoDuration(position)} / {duration ? formatVideoDuration(duration) : 'Live'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
                className="h-11 rounded-xl bg-white text-slate-950 border border-white/20 px-3 text-xs font-black uppercase tracking-widest outline-none focus:ring-2 focus:ring-white"
                aria-label="Playback speed"
              >
                {SPEEDS.map((item) => <option key={item} value={item} className="bg-slate-950">{item}x</option>)}
              </select>
              <span className="hidden sm:inline-flex h-11 items-center rounded-xl border border-white/15 bg-slate-800 px-3 text-xs font-black uppercase tracking-widest text-white">Quality Auto</span>
              <button onClick={() => setIsTheater((value) => !value)} className="h-11 px-3 rounded-xl border border-white/20 bg-white text-slate-950 text-xs font-black uppercase tracking-widest hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-white">{isTheater ? 'Exit' : 'Theater'}</button>
              {onNext && <button onClick={onNext} className="h-11 px-3 rounded-xl bg-emerald-300 text-slate-950 text-xs font-black uppercase tracking-widest hover:bg-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-100">Next</button>}
              <button onClick={requestFullscreen} className="h-11 px-3 rounded-xl bg-amber-300 text-slate-950 text-xs font-black uppercase tracking-widest hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-100">Full Screen</button>
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${percent}%` }}></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
