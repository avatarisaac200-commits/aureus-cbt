import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User, VideoLesson, VideoProgress } from '../types';
import { db } from '../firebase';
import { collection, doc, increment, limit, onSnapshot, query, setDoc, updateDoc, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import VideoPlayer from './VideoPlayer';
import { toast } from './ui/Toast';
import {
  formatVideoDuration,
  sortVideoLessons,
  VIDEO_LESSONS_COLLECTION,
  VIDEO_PROGRESS_COLLECTION,
  videoProgressId
} from '../lib/videoLearning';

interface VideoLearningHubProps {
  user: User;
  isReadOnly?: boolean;
  onBack: () => void;
}

const LOCAL_RESUME_PREFIX = 'videoResume';

const VideoLearningHub: React.FC<VideoLearningHubProps> = ({ user, isReadOnly, onBack }) => {
  const [lessons, setLessons] = useState<VideoLesson[]>([]);
  const [progressRows, setProgressRows] = useState<VideoProgress[]>([]);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [loadingLessons, setLoadingLessons] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(true);
  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('all');
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const lastSavedRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const q = query(
      collection(db, VIDEO_LESSONS_COLLECTION),
      where('isPublished', '==', true),
      limit(500)
    );
    const unsub = onSnapshot(q, (snap) => {
      const next = sortVideoLessons(snap.docs.map((item) => ({ ...item.data(), id: item.id } as VideoLesson)));
      setLessons(next);
      setLoadingLessons(false);
      setActiveLessonId((current) => current || next[0]?.id || null);
    }, (err) => {
      setLoadingLessons(false);
      toast.error('Video lessons unavailable', err?.message || 'Could not load lectures.');
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, VIDEO_PROGRESS_COLLECTION),
      where('userId', '==', user.id),
      limit(500)
    );
    const unsub = onSnapshot(q, (snap) => {
      setProgressRows(snap.docs
        .map((item) => ({ ...item.data(), id: item.id } as VideoProgress))
        .sort((a, b) => Date.parse(b.lastWatchedAt || '') - Date.parse(a.lastWatchedAt || '')));
      setLoadingProgress(false);
    }, () => {
      setLoadingProgress(false);
    });
    return () => unsub();
  }, [user.id]);

  const progressByLesson = useMemo(() => {
    const map: Record<string, VideoProgress> = {};
    progressRows.forEach((row) => {
      map[row.lessonId] = row;
    });
    return map;
  }, [progressRows]);

  const courses = useMemo(() => Array.from(new Set(lessons.map((lesson) => lesson.course).filter(Boolean))).sort(), [lessons]);

  const filteredLessons = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return lessons.filter((lesson) => {
      if (courseFilter !== 'all' && lesson.course !== courseFilter) return false;
      if (!needle) return true;
      return [lesson.title, lesson.description, lesson.course, lesson.category, ...(lesson.tags || [])].join(' ').toLowerCase().includes(needle);
    });
  }, [courseFilter, lessons, search]);

  const activeLesson = useMemo(() => {
    return lessons.find((lesson) => lesson.id === activeLessonId) || filteredLessons[0] || lessons[0] || null;
  }, [activeLessonId, filteredLessons, lessons]);

  const activeIndex = activeLesson ? lessons.findIndex((lesson) => lesson.id === activeLesson.id) : -1;
  const previousLesson = activeIndex > 0 ? lessons[activeIndex - 1] : null;
  const nextLesson = activeIndex >= 0 && activeIndex < lessons.length - 1 ? lessons[activeIndex + 1] : null;
  const activeProgress = activeLesson ? progressByLesson[activeLesson.id] : null;

  const totalDuration = useMemo(() => lessons.reduce((sum, lesson) => sum + (lesson.duration || 0), 0), [lessons]);
  const completedCount = useMemo(() => lessons.filter((lesson) => progressByLesson[lesson.id]?.completed).length, [lessons, progressByLesson]);
  const courseProgressPercent = lessons.length > 0 ? Math.round((completedCount / lessons.length) * 100) : 0;
  const recentlyWatched = progressRows
    .map((row) => lessons.find((lesson) => lesson.id === row.lessonId))
    .filter(Boolean)
    .slice(0, 4) as VideoLesson[];

  const getLocalResume = useCallback((lessonId: string) => {
    try {
      const raw = window.localStorage.getItem(`${LOCAL_RESUME_PREFIX}:${user.id}:${lessonId}`);
      const parsed = Number(raw || 0);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  }, [user.id]);

  const saveProgress = useCallback(async (lesson: VideoLesson, positionSeconds: number, durationSeconds: number, options?: { completed?: boolean; bookmarked?: boolean }) => {
    if (isReadOnly) return;
    const nowMs = Date.now();
    const lastSaved = lastSavedRef.current[lesson.id] || 0;
    const completed = Boolean(options?.completed) || (durationSeconds > 0 && positionSeconds >= durationSeconds * 0.92);
    const shouldSave = completed || options?.bookmarked !== undefined || nowMs - lastSaved > 8000;
    try {
      window.localStorage.setItem(`${LOCAL_RESUME_PREFIX}:${user.id}:${lesson.id}`, String(Math.floor(positionSeconds)));
    } catch {}
    if (!shouldSave) return;
    lastSavedRef.current[lesson.id] = nowMs;
    const existing = progressByLesson[lesson.id];
    const progressPercent = durationSeconds > 0 ? Math.min(100, Math.round((positionSeconds / durationSeconds) * 100)) : 0;
    const payload: VideoProgress = {
      id: videoProgressId(user.id, lesson.id),
      userId: user.id,
      userName: user.name,
      lessonId: lesson.id,
      course: lesson.course,
      lastPositionSeconds: Math.floor(positionSeconds),
      durationSeconds: Math.floor(durationSeconds || lesson.duration || 0),
      progressPercent,
      completed,
      bookmarked: options?.bookmarked ?? existing?.bookmarked ?? false,
      firstWatchedAt: existing?.firstWatchedAt || new Date().toISOString(),
      lastWatchedAt: new Date().toISOString()
    };
    await setDoc(doc(db, VIDEO_PROGRESS_COLLECTION, payload.id), payload, { merge: true });
    if (!existing) {
      await updateDoc(doc(db, VIDEO_LESSONS_COLLECTION, lesson.id), { viewCount: increment(1) }).catch(() => undefined);
    }
    if (completed && !existing?.completed) {
      await updateDoc(doc(db, VIDEO_LESSONS_COLLECTION, lesson.id), { completedCount: increment(1) }).catch(() => undefined);
    }
  }, [isReadOnly, progressByLesson, user.id, user.name]);

  const selectLesson = (lesson: VideoLesson) => {
    setActiveLessonId(lesson.id);
    try {
      window.history.replaceState(null, '', `/videos?lesson=${encodeURIComponent(lesson.id)}`);
    } catch {}
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const lessonId = new URLSearchParams(window.location.search).get('lesson');
    if (lessonId) setActiveLessonId(lessonId);
  }, []);

  const initialPosition = activeLesson ? Math.max(activeProgress?.lastPositionSeconds || 0, getLocalResume(activeLesson.id)) : 0;

  const markComplete = async () => {
    if (!activeLesson) return;
    await saveProgress(activeLesson, activeLesson.duration || initialPosition, activeLesson.duration || initialPosition, { completed: true });
    toast.success('Lesson completed');
  };

  const toggleBookmark = async () => {
    if (!activeLesson) return;
    await saveProgress(activeLesson, activeProgress?.lastPositionSeconds || initialPosition, activeLesson.duration || 0, { bookmarked: !activeProgress?.bookmarked });
    toast.success(activeProgress?.bookmarked ? 'Bookmark removed' : 'Lesson bookmarked');
  };

  return (
    <div className="video-learn-shell flex-1 min-h-0 bg-slate-950 text-white overflow-hidden flex flex-col">
      <header className="shrink-0 border-b border-white/10 bg-slate-950/95 safe-top">
        <div className="px-4 md:px-8 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="min-h-[44px] rounded-xl border border-amber-300 bg-amber-300 px-4 text-xs font-black uppercase tracking-widest text-slate-950 shadow-lg hover:bg-amber-200" aria-label="Back to main app">Back to app</button>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-amber-400">Video Academy</p>
              <h1 className="text-lg md:text-2xl font-black tracking-tight">Lecture Library</h1>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 w-full lg:w-auto">
            <div className="rounded-2xl bg-white/5 border border-white/10 p-3 text-center">
              <p className="text-[10px] font-black uppercase text-slate-400">Progress</p>
              <p className="font-black text-amber-300">{courseProgressPercent}%</p>
            </div>
            <div className="rounded-2xl bg-white/5 border border-white/10 p-3 text-center">
              <p className="text-[10px] font-black uppercase text-slate-400">Lessons</p>
              <p className="font-black">{completedCount}/{lessons.length}</p>
            </div>
            <div className="rounded-2xl bg-white/5 border border-white/10 p-3 text-center">
              <p className="text-[10px] font-black uppercase text-slate-400">Runtime</p>
              <p className="font-black">{formatVideoDuration(totalDuration)}</p>
            </div>
          </div>
        </div>
        <div className="h-1 bg-white/10"><div className="h-full bg-amber-400" style={{ width: `${courseProgressPercent}%` }}></div></div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden grid grid-cols-1 xl:grid-cols-[1fr_390px]">
        <section className="min-h-0 overflow-y-auto p-4 md:p-8 space-y-6">
          {loadingLessons || !activeLesson ? (
            <div className="space-y-4">
              <div className="aspect-video rounded-[1.5rem] bg-white/10 animate-pulse"></div>
              <div className="h-28 rounded-[2rem] bg-white/10 animate-pulse"></div>
            </div>
          ) : (
            <>
              <VideoPlayer
                lesson={activeLesson}
                initialPositionSeconds={initialPosition}
                onProgress={(position, duration) => saveProgress(activeLesson, position, duration)}
                onComplete={() => {
                  saveProgress(activeLesson, activeLesson.duration || initialPosition, activeLesson.duration || initialPosition, { completed: true });
                  if (autoPlayNext && nextLesson) window.setTimeout(() => selectLesson(nextLesson), 900);
                }}
                onNext={nextLesson ? () => selectLesson(nextLesson) : undefined}
                onBackToApp={onBack}
              />

              <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 md:p-7">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className="px-3 py-1 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-widest">{activeLesson.course}</span>
                      <span className="px-3 py-1 rounded-full bg-white/10 text-slate-300 text-[10px] font-black uppercase tracking-widest">{activeLesson.category}</span>
                      {Date.now() - Date.parse(activeLesson.createdAt || '') < 1000 * 60 * 60 * 24 * 14 && <span className="px-3 py-1 rounded-full bg-emerald-400 text-slate-950 text-[10px] font-black uppercase tracking-widest">New</span>}
                    </div>
                    <h2 className="text-2xl md:text-3xl font-black tracking-tight">{activeLesson.title}</h2>
                    <p className="mt-3 text-sm leading-relaxed text-slate-300 max-w-3xl">{activeLesson.description || 'No description has been added for this lecture yet.'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button onClick={toggleBookmark} className={`px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-widest ${activeProgress?.bookmarked ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-slate-200'}`}>Bookmark</button>
                    <button onClick={markComplete} className="px-4 py-3 rounded-2xl bg-emerald-400 text-slate-950 text-xs font-black uppercase tracking-widest">Complete</button>
                  </div>
                </div>
                <div className="mt-6 flex flex-col sm:flex-row gap-3">
                  <button disabled={!previousLesson} onClick={() => previousLesson && selectLesson(previousLesson)} className="flex-1 py-4 rounded-2xl bg-white/10 text-xs font-black uppercase tracking-widest disabled:opacity-30">Previous Lesson</button>
                  <button disabled={!nextLesson} onClick={() => nextLesson && selectLesson(nextLesson)} className="flex-1 py-4 rounded-2xl bg-amber-400 text-slate-950 text-xs font-black uppercase tracking-widest disabled:opacity-30">Next Lesson</button>
                </div>
              </section>

              {recentlyWatched.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-black uppercase tracking-[0.25em] text-slate-400">Continue Watching</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {recentlyWatched.map((lesson) => (
                      <button key={lesson.id} onClick={() => selectLesson(lesson)} className="text-left overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] transition-colors flex gap-3 p-3">
                        <img src={lesson.thumbnail} alt="" className="w-28 aspect-video rounded-xl object-cover bg-slate-800" />
                        <div className="min-w-0">
                          <p className="text-sm font-black truncate">{lesson.title}</p>
                          <p className="mt-1 text-xs text-slate-400">{progressByLesson[lesson.id]?.progressPercent || 0}% watched</p>
                          <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-amber-400" style={{ width: `${progressByLesson[lesson.id]?.progressPercent || 0}%` }}></div></div>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </section>

        <aside className="min-h-0 xl:border-l border-white/10 bg-slate-900/70 xl:sticky xl:top-0 flex flex-col">
          <div className="p-4 border-b border-white/10 space-y-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lessons" className="w-full p-3 rounded-2xl bg-white/10 border border-white/10 text-sm font-bold outline-none placeholder:text-slate-500" />
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} className="min-w-0 p-3 rounded-2xl bg-white/10 border border-white/10 text-sm font-black outline-none">
                <option className="bg-slate-950" value="all">All courses</option>
                {courses.map((course) => <option className="bg-slate-950" key={course} value={course}>{course}</option>)}
              </select>
              <button onClick={() => setAutoPlayNext((value) => !value)} className={`px-3 rounded-2xl text-[10px] font-black uppercase tracking-widest ${autoPlayNext ? 'bg-emerald-400 text-slate-950' : 'bg-white/10 text-slate-300'}`}>Auto</button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {loadingLessons || loadingProgress ? (
              [1, 2, 3, 4, 5].map((item) => <div key={item} className="h-24 rounded-2xl bg-white/10 animate-pulse"></div>)
            ) : filteredLessons.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-xs font-black uppercase tracking-widest text-slate-500">No lessons found</div>
            ) : filteredLessons.map((lesson) => {
              const row = progressByLesson[lesson.id];
              const isActive = activeLesson?.id === lesson.id;
              return (
                <button key={lesson.id} onClick={() => selectLesson(lesson)} className={`w-full text-left rounded-2xl border p-3 transition-colors ${isActive ? 'bg-amber-400 text-slate-950 border-amber-300' : 'bg-white/[0.04] text-white border-white/10 hover:bg-white/[0.07]'}`}>
                  <div className="flex gap-3">
                    <img src={lesson.thumbnail} alt="" className="w-24 aspect-video rounded-xl object-cover bg-slate-800" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-black uppercase ${isActive ? 'text-slate-800' : 'text-slate-400'}`}>{lesson.category}</span>
                        {row?.completed && <span className="text-[10px] font-black uppercase">Done</span>}
                        {row?.bookmarked && <span className="text-[10px] font-black uppercase">Saved</span>}
                      </div>
                      <p className="mt-1 text-sm font-black leading-tight line-clamp-2">{lesson.title}</p>
                      <p className={`mt-1 text-xs font-bold ${isActive ? 'text-slate-700' : 'text-slate-400'}`}>{lesson.duration ? formatVideoDuration(lesson.duration) : 'On demand'} / {row?.progressPercent || 0}%</p>
                    </div>
                  </div>
                  <div className={`mt-3 h-1.5 rounded-full overflow-hidden ${isActive ? 'bg-slate-950/20' : 'bg-white/10'}`}>
                    <div className={isActive ? 'h-full bg-slate-950' : 'h-full bg-amber-400'} style={{ width: `${row?.progressPercent || 0}%` }}></div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
      </main>
    </div>
  );
};

export default VideoLearningHub;
