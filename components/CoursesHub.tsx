import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Course, CourseSession, User } from '../types';
import { db } from '../firebase';
import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { toast } from './ui/Toast';
import { confirmDialog } from './ui/ConfirmDialog';

interface CoursesHubProps {
  user: User;
  isReadOnly?: boolean;
  onBack: () => void;
}

type CoursesTab = 'library' | 'history' | 'manage';

const ACCEPTED_EXTENSIONS = new Set(['html', 'htm', 'xhtml']);

const formatClock = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const parseOutline = (html: string) => {
  if (typeof window === 'undefined') return [] as string[];
  try {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(html, 'text/html');
    const headings = Array.from(parsed.querySelectorAll('h1, h2, h3'))
      .map((node) => (node.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 20);
    return headings.length > 0 ? headings : ['Course completed'];
  } catch {
    return ['Course completed'];
  }
};

const injectViewport = (html: string) => {
  const hasViewport = /<meta[^>]*name=["']viewport["']/i.test(html);
  if (hasViewport) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1><meta name="viewport" content="width=device-width, initial-scale=1" />`);
  }
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body>${html}</body></html>`;
};

const buildSafeCourseDocument = (html: string) => {
  const withViewport = injectViewport(html);
  const guardScript = `
<script>
(() => {
  document.addEventListener('submit', (event) => {
    event.preventDefault();
  }, true);
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!target || !target.closest) return;
    const anchor = target.closest('a[href]');
    if (!anchor) return;
    const href = (anchor.getAttribute('href') || '').trim();
    if (!href || href === '#') {
      event.preventDefault();
      return;
    }
    if (/^https?:\\/\\//i.test(href)) {
      event.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }, true);
})();
</script>`;

  if (/<\/body>/i.test(withViewport)) {
    return withViewport.replace(/<\/body>/i, `${guardScript}</body>`);
  }
  return `${withViewport}${guardScript}`;
};

const CoursesHub: React.FC<CoursesHubProps> = ({ user, isReadOnly = false, onBack }) => {
  const [tab, setTab] = useState<CoursesTab>('library');
  const [courses, setCourses] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [search, setSearch] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadEstimatedMinutes, setUploadEstimatedMinutes] = useState(30);
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadHtml, setUploadHtml] = useState('');
  const [uploadPublished, setUploadPublished] = useState(true);
  const [activeCourse, setActiveCourse] = useState<Course | null>(null);
  const [launchMinutes, setLaunchMinutes] = useState(30);
  const [isRunning, setIsRunning] = useState(false);
  const [startedAtIso, setStartedAtIso] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [checkedSections, setCheckedSections] = useState<Record<number, boolean>>({});
  const [lastSession, setLastSession] = useState<CourseSession | null>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [activeCourseDoc, setActiveCourseDoc] = useState('');
  const isAdmin = user.role === 'admin' || user.role === 'root-admin';
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endAtRef = useRef<number | null>(null);

  useEffect(() => {
    setLoadingCourses(true);
    const courseQuery = isAdmin
      ? query(collection(db, 'courses'), orderBy('updatedAt', 'desc'), limit(200))
      : query(collection(db, 'courses'), where('isPublished', '==', true), orderBy('updatedAt', 'desc'), limit(200));
    const unsub = onSnapshot(courseQuery, (snap) => {
      const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id } as Course));
      setCourses(rows);
      setLoadingCourses(false);
    }, () => {
      setLoadingCourses(false);
      toast.error('Courses load failed', 'Could not load courses right now.');
    });
    return () => unsub();
  }, [isAdmin]);

  useEffect(() => {
    setLoadingSessions(true);
    const sessionQuery = isAdmin
      ? query(collection(db, 'courseSessions'), orderBy('endedAt', 'desc'), limit(200))
      : query(collection(db, 'courseSessions'), where('userId', '==', user.id), orderBy('endedAt', 'desc'), limit(200));
    const unsub = onSnapshot(sessionQuery, (snap) => {
      const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id } as CourseSession));
      setSessions(rows);
      setLoadingSessions(false);
    }, () => {
      setLoadingSessions(false);
      toast.error('Session load failed', 'Could not load session history.');
    });
    return () => unsub();
  }, [isAdmin, user.id]);

  useEffect(() => {
    if (!isRunning || !activeCourse) return;
    if (endAtRef.current === null) {
      endAtRef.current = Date.now() + (timeRemaining * 1000);
    }

    const sync = () => {
      if (!isRunning || endAtRef.current === null) return;
      const remainingMs = Math.max(0, endAtRef.current - Date.now());
      const nextSeconds = Math.ceil(remainingMs / 1000);
      setTimeRemaining(nextSeconds);
      if (remainingMs <= 0) {
        void finishSession('timed-out');
      }
    };

    sync();
    timerRef.current = setInterval(sync, 1000);
    const onWake = () => sync();
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [isRunning, activeCourse]);

  const filteredCourses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((course) => {
      const tags = (course.tags || []).join(' ').toLowerCase();
      return course.title.toLowerCase().includes(q) || (course.description || '').toLowerCase().includes(q) || tags.includes(q);
    });
  }, [courses, search]);

  const activeOutline = useMemo(() => (activeCourse ? parseOutline(activeCourse.contentHtml) : []), [activeCourse]);
  const completedSections = Object.values(checkedSections).filter(Boolean).length;
  const progressPercent = activeOutline.length > 0 ? Math.round((completedSections / activeOutline.length) * 100) : 0;

  const resetUpload = () => {
    setUploadTitle('');
    setUploadDescription('');
    setUploadTags('');
    setUploadEstimatedMinutes(30);
    setUploadFileName('');
    setUploadHtml('');
    setUploadPublished(true);
  };

  const handleUploadFile = async (file: File | null) => {
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ACCEPTED_EXTENSIONS.has(ext)) {
      toast.warning('Invalid file', 'Please upload an HTML file (.html, .htm, .xhtml).');
      return;
    }
    if (file.size > 1024 * 1024 * 2) {
      toast.warning('File too large', 'Maximum file size is 2MB.');
      return;
    }
    const text = await file.text();
    setUploadHtml(text);
    setUploadFileName(file.name);
    if (!uploadTitle.trim()) {
      setUploadTitle(file.name.replace(/\.[^.]+$/, '').trim());
    }
  };

  const publishCourse = async () => {
    if (!isAdmin) return;
    const title = uploadTitle.trim();
    if (!title) {
      toast.warning('Missing title', 'Course title is required.');
      return;
    }
    if (!uploadFileName || !uploadHtml.trim()) {
      toast.warning('Missing file', 'Upload an HTML file for this course.');
      return;
    }
    const ext = (uploadFileName.split('.').pop() || '').toLowerCase();
    if (!ACCEPTED_EXTENSIONS.has(ext)) {
      toast.warning('Invalid file', 'Only HTML files are supported in v3.15.');
      return;
    }

    setIsUploading(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, 'courses'), {
        title,
        description: uploadDescription.trim(),
        version: 'html-v1',
        fileName: uploadFileName,
        fileExtension: ext,
        contentHtml: uploadHtml,
        tags: uploadTags.split(',').map((v) => v.trim()).filter(Boolean),
        estimatedDurationMinutes: Math.max(1, Math.min(300, Number(uploadEstimatedMinutes) || 30)),
        isPublished: uploadPublished,
        createdBy: user.id,
        creatorName: user.name,
        createdAt: now,
        updatedAt: now
      });
      toast.success('Course uploaded', 'Course saved successfully.');
      resetUpload();
    } catch (err: any) {
      toast.error('Upload failed', err?.message || 'Could not upload course.');
    } finally {
      setIsUploading(false);
    }
  };

  const togglePublished = async (course: Course) => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, 'courses', course.id), {
        isPublished: !course.isPublished,
        updatedAt: new Date().toISOString()
      });
    } catch {
      toast.error('Update failed', 'Could not update course visibility.');
    }
  };

  const startCourse = (course: Course) => {
    const mins = Math.max(1, Number(launchMinutes) || course.estimatedDurationMinutes || 30);
    setActiveCourse(course);
    setLaunchMinutes(mins);
    const secs = mins * 60;
    setDurationSeconds(secs);
    setTimeRemaining(secs);
    setStartedAtIso(new Date().toISOString());
    setCheckedSections({});
    setLastSession(null);
    setFrameLoaded(false);
    setActiveCourseDoc(buildSafeCourseDocument(course.contentHtml));
    endAtRef.current = null;
    setIsRunning(true);
  };

  const stopActiveTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    endAtRef.current = null;
    setIsRunning(false);
  };

  const finishSession = async (status: CourseSession['status']) => {
    if (!activeCourse || !startedAtIso) return;
    stopActiveTimer();
    const elapsed = Math.max(0, durationSeconds - timeRemaining);
    const payload: Omit<CourseSession, 'id'> = {
      userId: user.id,
      userName: user.name,
      courseId: activeCourse.id,
      courseTitle: activeCourse.title,
      startedAt: startedAtIso,
      endedAt: new Date().toISOString(),
      durationSeconds,
      elapsedSeconds: elapsed,
      completedSections,
      totalSections: activeOutline.length,
      progressPercent,
      status
    };

    try {
      const saved = await addDoc(collection(db, 'courseSessions'), payload);
      setLastSession({ ...payload, id: saved.id });
    } catch {
      setLastSession({ ...payload, id: `temp-${Date.now()}` });
      toast.warning('Saved locally only', 'Could not sync this course session right now.');
    }
  };

  const closePlayer = async () => {
    if (!activeCourse) return;
    const shouldExit = await confirmDialog({
      title: 'Exit course?',
      message: 'Do you want to exit this course session?',
      confirmText: 'Exit',
      variant: 'danger'
    });
    if (!shouldExit) return;
    if (!lastSession && startedAtIso) {
      await finishSession('abandoned');
    } else {
      stopActiveTimer();
    }
    setActiveCourse(null);
    setStartedAtIso(null);
    setLastSession(null);
    setActiveCourseDoc('');
  };

  return (
    <div className="v2-page min-h-screen bg-slate-50 safe-top safe-bottom">
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-5">
        <section className="bg-white border border-slate-100 rounded-[2rem] p-5 md:p-7 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">V3.15</p>
            <h1 className="text-2xl font-black text-slate-900 uppercase">Courses</h1>
            <p className="text-xs text-slate-500 mt-1">HTML course reader with timer, progress checklist, and session history.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="px-5 py-3 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-widest text-slate-700 bg-white">
              Back
            </button>
          </div>
        </section>

        {!activeCourse && (
          <section className="bg-white border border-slate-100 rounded-2xl p-3 flex flex-wrap gap-2">
            {(['library', 'history', ...(isAdmin ? ['manage'] : [])] as CoursesTab[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${tab === item ? 'bg-slate-950 text-amber-500' : 'bg-slate-100 text-slate-700'}`}
              >
                {item}
              </button>
            ))}
          </section>
        )}

        {!activeCourse && tab === 'library' && (
          <section className="space-y-4">
            <div className="bg-white border border-slate-100 rounded-2xl p-4">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search courses by title, description, or tag"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold"
              />
            </div>
            {loadingCourses ? (
              <div className="bg-white border border-slate-100 rounded-2xl p-8 text-xs font-black uppercase tracking-widest text-slate-500">Loading courses...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredCourses.map((course) => (
                  <article key={course.id} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-black text-slate-900 uppercase">{course.title}</h3>
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${course.isPublished ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {course.isPublished ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-3">{course.description || 'No description provided.'}</p>
                    <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                      {course.estimatedDurationMinutes} mins - {course.version}
                    </div>
                    {(course.tags || []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(course.tags || []).slice(0, 4).map((tag) => (
                          <span key={tag} className="px-2 py-1 rounded-md bg-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-600">{tag}</span>
                        ))}
                      </div>
                    )}
                    <div className="mt-auto flex flex-col gap-2">
                      <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                        Session timer (mins)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={300}
                        value={launchMinutes}
                        onChange={(e) => setLaunchMinutes(Math.max(1, Math.min(300, Number(e.target.value) || course.estimatedDurationMinutes || 30)))}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold"
                      />
                      <button
                        type="button"
                        onClick={() => startCourse(course)}
                        disabled={isReadOnly}
                        className="px-4 py-3 rounded-xl bg-amber-500 text-slate-950 text-xs font-black uppercase tracking-widest disabled:opacity-40"
                      >
                        {isReadOnly ? 'Activation Needed' : 'Start Course'}
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => togglePublished(course)}
                          className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase tracking-widest text-slate-700"
                        >
                          {course.isPublished ? 'Unpublish' : 'Publish'}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {filteredCourses.length === 0 && (
                  <div className="col-span-full bg-white border border-dashed border-slate-200 rounded-2xl p-10 text-center text-xs font-black uppercase tracking-widest text-slate-400">
                    No courses found.
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {!activeCourse && tab === 'history' && (
          <section className="bg-white border border-slate-100 rounded-2xl p-5">
            <h2 className="text-lg font-black text-slate-900 uppercase mb-4">Course Sessions</h2>
            {loadingSessions ? (
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Loading sessions...</p>
            ) : (
              <div className="space-y-3 max-h-[70dvh] overflow-y-auto pr-1">
                {sessions.map((session) => (
                  <div key={session.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black uppercase text-slate-900">{session.courseTitle}</p>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mt-1">
                        {new Date(session.endedAt).toLocaleString()} - {session.status}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-slate-900">{session.progressPercent}%</p>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{formatClock(session.elapsedSeconds)}</p>
                    </div>
                  </div>
                ))}
                {sessions.length === 0 && <p className="text-xs font-black uppercase tracking-widest text-slate-400">No course sessions yet.</p>}
              </div>
            )}
          </section>
        )}

        {!activeCourse && tab === 'manage' && isAdmin && (
          <section className="bg-white border border-slate-100 rounded-2xl p-5 space-y-4">
            <h2 className="text-lg font-black text-slate-900 uppercase">Upload Course (HTML v1)</h2>
            <input
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              placeholder="Course title"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold"
            />
            <textarea
              value={uploadDescription}
              onChange={(e) => setUploadDescription(e.target.value)}
              placeholder="Short description"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm min-h-20"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={uploadTags}
                onChange={(e) => setUploadTags(e.target.value)}
                placeholder="Tags (comma separated)"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm"
              />
              <input
                type="number"
                min={1}
                max={300}
                value={uploadEstimatedMinutes}
                onChange={(e) => setUploadEstimatedMinutes(Math.max(1, Math.min(300, Number(e.target.value) || 30)))}
                placeholder="Estimated duration (mins)"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="px-4 py-3 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase tracking-widest text-slate-700 cursor-pointer">
                Select HTML
                <input
                  type="file"
                  accept=".html,.htm,.xhtml,text/html"
                  className="hidden"
                  onChange={(e) => void handleUploadFile(e.target.files?.[0] || null)}
                />
              </label>
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500 truncate">{uploadFileName || 'No file selected'}</span>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-700">
              <input
                type="checkbox"
                checked={uploadPublished}
                onChange={(e) => setUploadPublished(e.target.checked)}
              />
              Publish immediately
            </label>
            {uploadHtml && (
              <div className="rounded-xl border border-slate-200 bg-slate-950 text-amber-400 p-3 text-xs font-mono max-h-40 overflow-auto">
                HTML loaded. Preview available after publishing.
              </div>
            )}
            <button
              type="button"
              onClick={publishCourse}
              disabled={isUploading || isReadOnly}
              className="px-5 py-3 rounded-xl bg-slate-950 text-amber-500 text-xs font-black uppercase tracking-widest disabled:opacity-40"
            >
              {isUploading ? 'Uploading...' : 'Save Course'}
            </button>
          </section>
        )}

        {activeCourse && (
          <section className="fixed inset-0 z-[160] bg-slate-950 flex flex-col">
            <div className="p-3 md:p-4 border-b border-slate-800 bg-slate-950 text-white flex flex-col md:flex-row md:items-center md:justify-between gap-3 safe-top">
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-amber-400">Active Course</p>
                <h2 className="text-lg font-black uppercase">{activeCourse.title}</h2>
              </div>
              <div className="flex items-center gap-2 md:gap-3">
                <span className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${timeRemaining <= 60 ? 'bg-red-500 text-white' : 'bg-slate-800 text-amber-400'}`}>
                  {formatClock(timeRemaining)}
                </span>
                <button
                  onClick={() => setIsRunning((prev) => !prev)}
                  className="px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest bg-slate-800 text-slate-100"
                >
                  {isRunning ? 'Pause' : 'Resume'}
                </button>
                <button
                  onClick={() => void finishSession('completed')}
                  className="px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest bg-emerald-500 text-white"
                >
                  Complete
                </button>
                <button
                  onClick={() => void closePlayer()}
                  className="px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest bg-red-500 text-white"
                >
                  Exit
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] min-h-0 flex-1">
              <aside className="border-r border-slate-200 p-4 bg-slate-50 overflow-y-auto">
                <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Outline Checklist</p>
                <div className="text-xs font-black uppercase tracking-widest text-amber-700 mb-4">{progressPercent}% complete</div>
                <div className="space-y-2">
                  {activeOutline.map((heading, idx) => (
                    <label key={`${heading}-${idx}`} className="flex items-start gap-2 p-2 rounded-lg bg-white border border-slate-200 text-xs">
                      <input
                        type="checkbox"
                        checked={Boolean(checkedSections[idx])}
                        onChange={(e) => setCheckedSections((prev) => ({ ...prev, [idx]: e.target.checked }))}
                      />
                      <span className="font-semibold text-slate-700">{heading}</span>
                    </label>
                  ))}
                </div>
              </aside>
              <div className="relative min-h-0">
                {!frameLoaded && (
                  <div className="absolute inset-0 z-10 bg-white/95 flex items-center justify-center">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">Rendering course...</p>
                  </div>
                )}
                <iframe
                  title={activeCourse.title}
                  srcDoc={activeCourseDoc}
                  onLoad={() => setFrameLoaded(true)}
                  className="w-full h-full border-0 bg-white"
                  sandbox="allow-scripts allow-forms allow-modals allow-downloads allow-popups"
                />
              </div>
            </div>
            {lastSession && (
              <div className="p-4 border-t border-slate-200 bg-emerald-50 flex items-center justify-between gap-3 safe-bottom">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-emerald-700">Session Saved</p>
                  <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
                    {lastSession.status} - {lastSession.progressPercent}% - {formatClock(lastSession.elapsedSeconds)}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setActiveCourse(null);
                    setStartedAtIso(null);
                    setLastSession(null);
                    setActiveCourseDoc('');
                  }}
                  className="px-4 py-2 rounded-xl bg-white border border-emerald-200 text-xs font-black uppercase tracking-widest text-emerald-700"
                >
                  Close Session
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
};

export default CoursesHub;
