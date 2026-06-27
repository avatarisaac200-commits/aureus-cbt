import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Course, CourseSession, User } from '../types';
import { db } from '../firebase';
import { addDoc, collection, doc, getDoc, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { toast } from './ui/Toast';
import { confirmDialog } from './ui/ConfirmDialog';

interface CoursesHubProps {
  user: User;
  isReadOnly?: boolean;
  onBack: () => void;
}

type CoursesTab = 'library' | 'history' | 'manage';

const ACCEPTED_EXTENSIONS = new Set(['html', 'htm', 'xhtml', 'cbtcourse']);
const NATIVE_COURSE_FORMAT = 'cbtcourse-v1';
const MAX_UPLOAD_SIZE_BYTES = 1024 * 1024 * 2;
const COURSE_SHARE_QUERY_KEY = 'course';
const CBTCOURSE_TEMPLATE = `{
  "format": "cbtcourse-v1",
  "meta": {
    "title": "Trigonometry Crash Course",
    "description": "Year 1 university trigonometry fundamentals to advanced topics.",
    "tags": ["math", "trigonometry", "year-1"],
    "estimatedDurationMinutes": 120
  },
  "content": {
    "headHtml": "<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;line-height:1.6;margin:0;padding:0 16px 48px;} .hero{padding:20px 0;border-bottom:1px solid #ddd;} @media (max-width:768px){body{padding:0 12px 40px;}}</style>",
    "bodyHtml": "<main><section class='hero'><h1>Trigonometry</h1><p>Welcome to the native CBT course format.</p></section><section id='sec-1'><h2>Angles</h2><p>Radians and degrees conversion.</p></section></main>"
  }
}`;

const formatClock = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const parseIsoDateMs = (value?: string) => {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : 0;
};

const formatCompactNumber = (value: number) => {
  try {
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(Math.max(0, value || 0));
  } catch {
    return String(Math.max(0, value || 0));
  }
};

const roundOne = (value: number) => Number(Number(value || 0).toFixed(1));

const toDayStamp = (value?: string) => {
  const ms = parseIsoDateMs(value);
  if (!ms) return '';
  return new Date(ms).toISOString().slice(0, 10);
};

const toDaysAgoLabel = (valueMs?: number) => {
  if (!valueMs || !Number.isFinite(valueMs)) return 'recently';
  const diffDays = Math.max(0, Math.floor((Date.now() - valueMs) / 86400000));
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
};

const getCourseShareUrl = (courseId: string) => {
  if (typeof window === 'undefined') return `/courses?${COURSE_SHARE_QUERY_KEY}=${encodeURIComponent(courseId)}`;
  const url = new URL(window.location.origin + '/courses');
  url.searchParams.set(COURSE_SHARE_QUERY_KEY, courseId);
  return url.toString();
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
  const normalizeHash = (href) => {
    const hashIdx = href.indexOf('#');
    if (hashIdx < 0) return '';
    return href.slice(hashIdx);
  };
  const scrollToHash = (hash) => {
    const id = (hash || '').replace(/^#/, '').trim();
    if (!id) return;
    const target = document.getElementById(id);
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  const hasMathExpressions = () => {
    const text = document.body ? (document.body.innerText || '') : '';
    return /\\\\\\(|\\\\\\)|\\\\\\[|\\\\\\]|\\$\\$[^$]+\\$\\$|\\$[^$]+\\$/.test(text);
  };
  const triggerMathTypeset = () => {
    if (window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise().catch(() => {});
    }
  };
  const ensureMathJax = () => {
    if (!hasMathExpressions()) return;
    if (window.MathJax && window.MathJax.typesetPromise) {
      triggerMathTypeset();
      return;
    }
    const existing = document.querySelector('script[src*="mathjax"]');
    if (existing) {
      existing.addEventListener('load', triggerMathTypeset, { once: true });
      return;
    }
    window.MathJax = window.MathJax || {
      tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']], displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']] },
      svg: { fontCache: 'global' }
    };
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js';
    script.async = true;
    script.onload = () => triggerMathTypeset();
    document.head.appendChild(script);
  };
  document.addEventListener('submit', (event) => {
    event.preventDefault();
  }, true);
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!target || !target.closest) return;
    const anchor = target.closest('a[href]');
    if (!anchor) return;
    const href = (anchor.getAttribute('href') || '').trim();
    const absoluteHref = (anchor.href || '').trim();
    if (!href || href === '#') {
      event.preventDefault();
      return;
    }
    if (href.startsWith('#')) {
      event.preventDefault();
      scrollToHash(href);
      return;
    }
    if (absoluteHref && absoluteHref.includes('#')) {
      const asUrl = new URL(absoluteHref, window.location.href);
      if (asUrl.pathname === window.location.pathname) {
        event.preventDefault();
        scrollToHash(asUrl.hash);
        return;
      }
    }
    if (/^https?:\\/\\//i.test(href)) {
      event.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (/^javascript:/i.test(href)) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
  }, true);
  ensureMathJax();
  const mathObserver = new MutationObserver(() => {
    triggerMathTypeset();
  });
  if (document.body) {
    mathObserver.observe(document.body, { childList: true, subtree: true });
  }
})();
</script>`;

  if (/<\/body>/i.test(withViewport)) {
    return withViewport.replace(/<\/body>/i, `${guardScript}</body>`);
  }
  return `${withViewport}${guardScript}`;
};

const parseNativeCourseFile = (raw: string) => {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid cbtcourse file.');
  }
  if (parsed.format !== NATIVE_COURSE_FORMAT) {
    throw new Error(`Unsupported course format. Expected "${NATIVE_COURSE_FORMAT}".`);
  }

  const meta = parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {};
  const content = parsed.content && typeof parsed.content === 'object' ? parsed.content : {};

  const contentHtml = typeof content.html === 'string'
    ? content.html
    : `<!doctype html><html><head>${typeof content.headHtml === 'string' ? content.headHtml : ''}</head><body>${typeof content.bodyHtml === 'string' ? content.bodyHtml : ''}</body></html>`;

  if (!contentHtml.trim()) {
    throw new Error('cbtcourse content is empty. Provide content.html or content.bodyHtml.');
  }

  return {
    title: typeof meta.title === 'string' ? meta.title.trim() : '',
    description: typeof meta.description === 'string' ? meta.description.trim() : '',
    tags: Array.isArray(meta.tags) ? meta.tags.map((v: any) => String(v || '').trim()).filter(Boolean) : [],
    estimatedDurationMinutes: Math.max(1, Math.min(300, Number(meta.estimatedDurationMinutes) || 30)),
    contentHtml
  };
};

const CoursesHub: React.FC<CoursesHubProps> = ({ user, isReadOnly = false, onBack }) => {
  const [tab, setTab] = useState<CoursesTab>('library');
  const [courses, setCourses] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [publicEnrollments, setPublicEnrollments] = useState<Array<{ id: string; courseId: string; userId: string }>>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadEstimatedMinutes, setUploadEstimatedMinutes] = useState(30);
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadHtml, setUploadHtml] = useState('');
  const [uploadVersion, setUploadVersion] = useState<Course['version']>('html-v1');
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
  const [frameReloadNonce, setFrameReloadNonce] = useState(0);
  const [showOutlineMobile, setShowOutlineMobile] = useState(false);
  const isAdmin = user.role === 'admin' || user.role === 'root-admin';
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endAtRef = useRef<number | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setLoadingCourses(true);
    const primaryQuery = isAdmin
      ? query(collection(db, 'courses'), orderBy('updatedAt', 'desc'), limit(200))
      : query(collection(db, 'courses'), where('isPublished', '==', true), orderBy('updatedAt', 'desc'), limit(200));
    const fallbackQuery = isAdmin
      ? null
      : query(collection(db, 'courses'), where('isPublished', '==', true), limit(200));

    let unsub: (() => void) | null = null;
    const attach = (q: any, withClientSort: boolean, allowFallback: boolean) => {
      unsub = onSnapshot(q, (snap) => {
        const rows = snap.docs
          .map((d) => ({ ...d.data(), id: d.id } as Course))
          .sort((a, b) => (
            withClientSort
              ? parseIsoDateMs(b.updatedAt || b.createdAt) - parseIsoDateMs(a.updatedAt || a.createdAt)
              : 0
          ));
        setCourses(rows);
        setLoadingCourses(false);
      }, (err: any) => {
        if (allowFallback && fallbackQuery && err?.code === 'failed-precondition') {
          unsub?.();
          attach(fallbackQuery, true, false);
          return;
        }
        setLoadingCourses(false);
        toast.error('Courses load failed', err?.code === 'permission-denied' ? 'Permission denied for courses.' : 'Could not load courses right now.');
      });
    };
    attach(primaryQuery, false, true);
    return () => { if (unsub) unsub(); };
  }, [isAdmin]);

  useEffect(() => {
    setLoadingSessions(true);
    const primaryQuery = isAdmin
      ? query(collection(db, 'courseSessions'), orderBy('endedAt', 'desc'), limit(200))
      : query(collection(db, 'courseSessions'), where('userId', '==', user.id), orderBy('endedAt', 'desc'), limit(200));
    const fallbackQuery = isAdmin
      ? null
      : query(collection(db, 'courseSessions'), where('userId', '==', user.id), limit(200));

    let unsub: (() => void) | null = null;
    const attach = (q: any, withClientSort: boolean, allowFallback: boolean) => {
      unsub = onSnapshot(q, (snap) => {
        const rows = snap.docs
          .map((d) => ({ ...d.data(), id: d.id } as CourseSession))
          .sort((a, b) => (withClientSort ? parseIsoDateMs(b.endedAt) - parseIsoDateMs(a.endedAt) : 0));
        setSessions(rows);
        setLoadingSessions(false);
      }, (err: any) => {
        if (allowFallback && fallbackQuery && err?.code === 'failed-precondition') {
          unsub?.();
          attach(fallbackQuery, true, false);
          return;
        }
        setLoadingSessions(false);
        toast.error('Session load failed', err?.code === 'permission-denied' ? 'Permission denied for session history.' : 'Could not load session history.');
      });
    };
    attach(primaryQuery, false, true);
    return () => { if (unsub) unsub(); };
  }, [isAdmin, user.id]);

  useEffect(() => {
    const enrollmentsQuery = query(collection(db, 'courseEnrollmentsPublic'), limit(5000));
    const unsub = onSnapshot(enrollmentsQuery, (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          courseId: String(data.courseId || ''),
          userId: String(data.userId || '')
        };
      }).filter((row) => row.courseId && row.userId);
      setPublicEnrollments(rows);
    }, () => {
      setPublicEnrollments([]);
    });
    return () => unsub();
  }, []);

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

  const personalSessions = useMemo(() => {
    if (!isAdmin) return sessions;
    return sessions.filter((session) => session.userId === user.id);
  }, [isAdmin, sessions, user.id]);

  const loadedSessionStatsByCourse = useMemo(() => {
    const map = new Map<string, {
      sessionCount: number;
      enrollmentCount: number;
      completionRate: number;
      averageProgressPercent: number;
      averageElapsedSeconds: number;
    }>();
    const byCourse = new Map<string, CourseSession[]>();
    sessions.forEach((session) => {
      const list = byCourse.get(session.courseId) || [];
      list.push(session);
      byCourse.set(session.courseId, list);
    });

    byCourse.forEach((rows, courseId) => {
      const learnerIds = new Set(rows.map((row) => row.userId).filter(Boolean));
      const sessionCount = rows.length;
      const completed = rows.filter((row) => row.status === 'completed').length;
      const totalProgress = rows.reduce((sum, row) => sum + Math.max(0, Math.min(100, Number(row.progressPercent) || 0)), 0);
      const totalElapsed = rows.reduce((sum, row) => sum + Math.max(0, Number(row.elapsedSeconds) || 0), 0);
      map.set(courseId, {
        sessionCount,
        enrollmentCount: learnerIds.size,
        completionRate: sessionCount > 0 ? roundOne((completed / sessionCount) * 100) : 0,
        averageProgressPercent: sessionCount > 0 ? roundOne(totalProgress / sessionCount) : 0,
        averageElapsedSeconds: sessionCount > 0 ? Math.round(totalElapsed / sessionCount) : 0
      });
    });
    return map;
  }, [sessions]);

  const publicEnrollmentCountByCourse = useMemo(() => {
    const map = new Map<string, number>();
    publicEnrollments.forEach((row) => {
      map.set(row.courseId, (map.get(row.courseId) || 0) + 1);
    });
    return map;
  }, [publicEnrollments]);

  const courseAnalytics = useMemo(() => {
    const map = new Map<string, {
      enrollmentCount: number;
      sessionCount: number;
      completionRate: number;
      averageProgressPercent: number;
      averageElapsedSeconds: number;
    }>();
    courses.forEach((course) => {
      const fallback = loadedSessionStatsByCourse.get(course.id);
      map.set(course.id, {
        enrollmentCount: Number(course.enrollmentCount ?? publicEnrollmentCountByCourse.get(course.id) ?? fallback?.enrollmentCount ?? 0),
        sessionCount: Number(course.sessionCount ?? fallback?.sessionCount ?? 0),
        completionRate: Number(course.completionRate ?? fallback?.completionRate ?? 0),
        averageProgressPercent: Number(course.averageProgressPercent ?? fallback?.averageProgressPercent ?? 0),
        averageElapsedSeconds: Number(course.averageElapsedSeconds ?? fallback?.averageElapsedSeconds ?? 0)
      });
    });
    return map;
  }, [courses, loadedSessionStatsByCourse, publicEnrollmentCountByCourse]);

  const personalCourseHistory = useMemo(() => {
    const map = new Map<string, {
      attempts: number;
      bestProgress: number;
      lastProgress: number;
      totalElapsedSeconds: number;
      lastEndedAtMs: number;
      completed: boolean;
    }>();
    personalSessions.forEach((session) => {
      const current = map.get(session.courseId) || {
        attempts: 0,
        bestProgress: 0,
        lastProgress: 0,
        totalElapsedSeconds: 0,
        lastEndedAtMs: 0,
        completed: false
      };
      const endedAtMs = parseIsoDateMs(session.endedAt);
      current.attempts += 1;
      current.bestProgress = Math.max(current.bestProgress, Number(session.progressPercent) || 0);
      current.totalElapsedSeconds += Math.max(0, Number(session.elapsedSeconds) || 0);
      current.completed = current.completed || session.status === 'completed' || Number(session.progressPercent) >= 100;
      if (endedAtMs >= current.lastEndedAtMs) {
        current.lastEndedAtMs = endedAtMs;
        current.lastProgress = Number(session.progressPercent) || 0;
      }
      map.set(session.courseId, current);
    });
    return map;
  }, [personalSessions]);

  const userTagAffinity = useMemo(() => {
    const courseById = new Map(courses.map((course) => [course.id, course]));
    const weights = new Map<string, number>();
    personalSessions.forEach((session) => {
      const course = courseById.get(session.courseId);
      const tags = course?.tags || [];
      if (tags.length === 0) return;
      const progressWeight = Math.max(0.4, Math.min(1.8, (Number(session.progressPercent) || 0) / 100 + (session.status === 'completed' ? 0.5 : 0.2)));
      tags.forEach((tagRaw) => {
        const tag = tagRaw.trim().toLowerCase();
        if (!tag) return;
        weights.set(tag, (weights.get(tag) || 0) + progressWeight);
      });
    });
    return weights;
  }, [courses, personalSessions]);

  const personalizedCards = useMemo(() => {
    return filteredCourses
      .map((course) => {
        const history = personalCourseHistory.get(course.id);
        const analytics = courseAnalytics.get(course.id) || {
          enrollmentCount: 0,
          sessionCount: 0,
          completionRate: 0,
          averageProgressPercent: 0,
          averageElapsedSeconds: 0
        };
        const interestScore = (course.tags || [])
          .reduce((sum, tag) => sum + (userTagAffinity.get(tag.trim().toLowerCase()) || 0), 0);
        const continueBoost = history && !history.completed ? Math.max(0, (100 - history.lastProgress) / 35) : 0;
        const noveltyBoost = history ? 0 : 1.6;
        const momentumBoost = analytics.completionRate >= 65 ? 0.8 : 0;
        const socialBoost = Math.min(1.4, analytics.enrollmentCount / 150);
        const score = interestScore * 1.8 + continueBoost + noveltyBoost + momentumBoost + socialBoost;

        let reason = 'Trending with learners';
        if (history && !history.completed) reason = `Continue from ${Math.round(history.lastProgress)}%`;
        else if (!history && interestScore > 0.9) reason = 'Matches your learning interests';
        else if (analytics.completionRate >= 70) reason = 'High completion success rate';

        return { course, history, analytics, score, reason };
      })
      .sort((a, b) => b.score - a.score);
  }, [filteredCourses, personalCourseHistory, courseAnalytics, userTagAffinity]);

  const filterChips = useMemo(() => {
    const tags = new Map<string, number>();
    courses.forEach((course) => {
      (course.tags || []).forEach((tag) => {
        const key = tag.trim();
        if (!key) return;
        tags.set(key, (tags.get(key) || 0) + 1);
      });
    });
    const topTags = Array.from(tags.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([tag]) => tag);
    return ['all', ...topTags, 'in-progress', 'not-started'];
  }, [courses]);

  const visibleCards = useMemo(() => {
    if (activeFilter === 'all') return personalizedCards;
    if (activeFilter === 'in-progress') {
      return personalizedCards.filter((row) => (row.history?.lastProgress || 0) > 0 && (row.history?.completed !== true));
    }
    if (activeFilter === 'not-started') {
      return personalizedCards.filter((row) => !row.history);
    }
    return personalizedCards.filter((row) => (row.course.tags || []).some((tag) => tag.toLowerCase() === activeFilter.toLowerCase()));
  }, [personalizedCards, activeFilter]);

  const recommendedCourses = useMemo(() => visibleCards.slice(0, 4), [visibleCards]);

  const personalAnalytics = useMemo(() => {
    const totalSessions = personalSessions.length;
    const totalLearningSeconds = personalSessions.reduce((sum, session) => sum + Math.max(0, Number(session.elapsedSeconds) || 0), 0);
    const avgProgress = totalSessions > 0
      ? roundOne(personalSessions.reduce((sum, session) => sum + Math.max(0, Math.min(100, Number(session.progressPercent) || 0)), 0) / totalSessions)
      : 0;
    const completedCourses = new Set(
      personalSessions
        .filter((session) => session.status === 'completed' || Number(session.progressPercent) >= 100)
        .map((session) => session.courseId)
    );
    const daySet = new Set(
      personalSessions
        .map((session) => toDayStamp(session.endedAt))
        .filter(Boolean)
    );
    const sortedDays = Array.from(daySet).sort();
    let streakDays = 0;
    if (sortedDays.length > 0) {
      let cursor = new Date(`${sortedDays[sortedDays.length - 1]}T00:00:00.000Z`);
      while (true) {
        const key = cursor.toISOString().slice(0, 10);
        if (!daySet.has(key)) break;
        streakDays += 1;
        cursor = new Date(cursor.getTime() - 86400000);
      }
    }
    return {
      totalSessions,
      totalLearningSeconds,
      avgProgress,
      completedCourses: completedCourses.size,
      streakDays
    };
  }, [personalSessions]);

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
    setUploadVersion('html-v1');
    setUploadPublished(true);
  };

  const copyTemplateToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(CBTCOURSE_TEMPLATE);
      toast.success('Template copied', 'cbtcourse template copied to clipboard.');
    } catch {
      toast.warning('Copy failed', 'Clipboard unavailable. Copy manually from the template block.');
    }
  };

  const downloadTemplateFile = () => {
    try {
      const blob = new Blob([CBTCOURSE_TEMPLATE], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'template.cbtcourse';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed', 'Could not generate template file.');
    }
  };

  const handleUploadFile = async (file: File | null) => {
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ACCEPTED_EXTENSIONS.has(ext)) {
      toast.warning('Invalid file', 'Please upload .html/.htm/.xhtml or .cbtcourse.');
      return;
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      toast.warning('File too large', 'Maximum file size is 2MB.');
      return;
    }
    try {
      const text = await file.text();
      if (ext === 'cbtcourse') {
        const parsed = parseNativeCourseFile(text);
        setUploadHtml(parsed.contentHtml);
        setUploadVersion('cbtcourse-v1');
        setUploadFileName(file.name);
        if (parsed.title) setUploadTitle(parsed.title);
        if (parsed.description) setUploadDescription(parsed.description);
        if (parsed.tags.length > 0) setUploadTags(parsed.tags.join(', '));
        setUploadEstimatedMinutes(parsed.estimatedDurationMinutes);
      } else {
        setUploadHtml(text);
        setUploadVersion('html-v1');
        setUploadFileName(file.name);
        if (!uploadTitle.trim()) {
          setUploadTitle(file.name.replace(/\.[^.]+$/, '').trim());
        }
      }
      toast.success('File loaded', `Detected ${ext === 'cbtcourse' ? 'native cbtcourse-v1' : 'HTML'} course file.`);
    } catch (err: any) {
      toast.error('File parse failed', err?.message || 'Could not parse selected file.');
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
      toast.warning('Invalid file', 'Only .html/.htm/.xhtml/.cbtcourse files are supported.');
      return;
    }

    setIsUploading(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, 'courses'), {
        title,
        description: uploadDescription.trim(),
        version: uploadVersion,
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
    void (async () => {
      try {
        const enrollmentId = `${course.id}_${user.id}`;
        const ref = doc(db, 'courseEnrollmentsPublic', enrollmentId);
        const existing = await getDoc(ref);
        if (!existing.exists()) {
          await setDoc(ref, {
            courseId: course.id,
            userId: user.id,
            userName: user.name,
            createdAt: new Date().toISOString()
          });
        }
      } catch {
        // Non-blocking: course launch should still continue.
      }
    })();
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
    setShowOutlineMobile(false);
    setActiveCourseDoc(buildSafeCourseDocument(course.contentHtml));
    endAtRef.current = null;
    setIsRunning(true);
  };

  const shareCourse = async (course: Course) => {
    const shareUrl = getCourseShareUrl(course.id);
    const sharePayload = {
      title: `Course: ${course.title}`,
      text: `Join this course on Scholar: ${course.title}`,
      url: shareUrl
    };
    try {
      if (navigator.share) {
        await navigator.share(sharePayload);
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Link copied', 'Course share link copied to clipboard.');
    } catch {
      toast.warning('Share unavailable', 'Could not share this course right now.');
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (courses.length === 0 || activeCourse) return;
    const params = new URLSearchParams(window.location.search);
    const courseId = params.get(COURSE_SHARE_QUERY_KEY)?.trim();
    if (!courseId) return;
    const matched = courses.find((course) => course.id === courseId);
    if (!matched) return;
    const clearShareQuery = () => {
      params.delete(COURSE_SHARE_QUERY_KEY);
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
      window.history.replaceState({}, '', nextUrl);
    };
    if (isReadOnly) {
      toast.warning('Activation needed', 'Activate your account to open this shared course.');
      clearShareQuery();
      return;
    }
    startCourse(matched);
    clearShareQuery();
  }, [courses, activeCourse, isReadOnly]);

  const stopActiveTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    endAtRef.current = null;
    setIsRunning(false);
  };

  const handleCourseFrameLoad = () => {
    setFrameLoaded(true);
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    try {
      const href = String(win.location?.href || '');
      const isCourseDoc = href.startsWith('about:srcdoc') || href === 'about:blank';
      if (!isCourseDoc) {
        setFrameLoaded(false);
        setFrameReloadNonce((prev) => prev + 1);
        toast.warning('Blocked navigation', 'This course tried to open another page. Staying inside the course reader.');
      }
    } catch {
      // If access fails, keep current frame state.
    }
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
    setShowOutlineMobile(false);
  };

  return (
    <div className="v2-page min-h-screen bg-slate-50 safe-top safe-bottom">
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-5">
        <section className="bg-white border border-slate-200 rounded-2xl px-5 md:px-7 py-4 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">Learning Portal</p>
            <h1 className="text-lg font-black text-slate-900">Courses Dashboard</h1>
            <p className="text-xs text-slate-500 mt-1">Personalized course library with learner analytics.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full font-semibold">Connection Stable</span>
            <button onClick={onBack} className="px-5 py-3 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-widest text-slate-700 bg-white">
              Back
            </button>
          </div>
        </section>

        {!activeCourse && (
          <section className="bg-white border border-slate-200 rounded-xl px-4 py-2 flex flex-wrap gap-2">
            {(['library', 'history', ...(isAdmin ? ['manage'] : [])] as CoursesTab[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest border-b-2 ${tab === item ? 'text-amber-600 border-amber-500' : 'text-slate-500 border-transparent hover:text-amber-600'}`}
              >
                {item}
              </button>
            ))}
          </section>
        )}

        {!activeCourse && tab === 'library' && (
          <section className="space-y-4">
            <div className="rounded-2xl p-5 md:p-6 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex flex-col md:flex-row md:items-center md:justify-between gap-4 border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-amber-500 text-slate-900 text-base font-black flex items-center justify-center">
                  {(user.name || 'U').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-lg font-black tracking-tight">Welcome back, {user.name.split(' ')[0] || 'Student'}</p>
                  <p className="text-xs text-white/70">
                    {recommendedCourses[0]?.history?.lastProgress
                      ? `Pick up from ${Math.round(recommendedCourses[0].history.lastProgress)}% in ${recommendedCourses[0].course.title}`
                      : 'Pick a course and keep your streak alive today'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 text-right">
                <div>
                  <p className="text-xl font-black text-amber-400">{personalAnalytics.completedCourses}</p>
                  <p className="text-[10px] uppercase tracking-widest text-white/60 font-bold">Courses</p>
                </div>
                <div>
                  <p className="text-xl font-black text-amber-400">{Math.round(personalAnalytics.avgProgress)}%</p>
                  <p className="text-[10px] uppercase tracking-widest text-white/60 font-bold">Avg Score</p>
                </div>
                <div>
                  <p className="text-xl font-black text-amber-400">{personalAnalytics.streakDays}</p>
                  <p className="text-[10px] uppercase tracking-widest text-white/60 font-bold">Day Streak</p>
                </div>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <p className="text-xs md:text-sm font-bold text-amber-900">
                {personalAnalytics.streakDays}-day streak. Study one topic today to keep it going.
              </p>
              <div className="flex items-center gap-1">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, idx) => {
                  const active = idx < Math.min(7, personalAnalytics.streakDays);
                  const isToday = idx === Math.min(6, new Date().getDay() === 0 ? 6 : new Date().getDay() - 1);
                  return (
                    <span
                      key={`${day}-${idx}`}
                      className={`w-7 h-7 rounded-full text-[10px] font-black flex items-center justify-center border ${active ? 'bg-amber-500 border-amber-500 text-white' : isToday ? 'bg-amber-100 border-amber-500 text-amber-700' : 'bg-white border-amber-200 text-amber-400'}`}
                    >
                      {day}
                    </span>
                  );
                })}
              </div>
            </div>
            {recommendedCourses.length > 0 && (
              <div className="bg-white border border-slate-100 rounded-2xl p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Recommended For You</h3>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Personalized picks</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  {recommendedCourses.map(({ course, reason, history, analytics }) => (
                    <div
                      key={`recommended-${course.id}`}
                      className="text-left p-3 rounded-xl border border-slate-200 bg-slate-50"
                    >
                      <p className="text-xs font-black uppercase tracking-widest text-slate-900 line-clamp-1">{course.title}</p>
                      <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 mt-1">{reason}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-2">
                        {formatCompactNumber(analytics.enrollmentCount)} learners - {Math.round(analytics.completionRate)}% complete
                      </p>
                      {history && (
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1">
                          Last session: {Math.round(history.lastProgress)}%
                        </p>
                      )}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => startCourse(course)}
                          disabled={isReadOnly}
                          className="px-3 py-2 rounded-lg bg-amber-500 text-slate-950 text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                        >
                          Start
                        </button>
                        <button
                          type="button"
                          onClick={() => void shareCourse(course)}
                          className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-[10px] font-black uppercase tracking-widest"
                        >
                          Share
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="bg-white border border-slate-100 rounded-2xl p-4">
              <div className="flex flex-col gap-3">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search courses by title, description, or tag"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold"
                />
                <div className="flex flex-wrap gap-2">
                  {filterChips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setActiveFilter(chip)}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-widest border ${activeFilter === chip ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-200 text-slate-600'}`}
                    >
                      {chip.replace('-', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {loadingCourses ? (
              <div className="bg-white border border-slate-100 rounded-2xl p-8 text-xs font-black uppercase tracking-widest text-slate-500">Loading courses...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {visibleCards.map(({ course, history, analytics, reason }) => (
                  <article key={course.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col">
                    <div
                      className="h-2"
                      style={{
                        background: `linear-gradient(90deg, ${history?.lastProgress ? '#f59e0b' : '#cbd5e1'} ${(history?.lastProgress || 0)}%, #e2e8f0 ${(history?.lastProgress || 0)}%)`
                      }}
                    />
                    <div className="p-5 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-black text-slate-900 uppercase">{course.title}</h3>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${course.isPublished ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {course.isPublished ? 'Published' : 'Draft'}
                        </span>
                        <span className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-700">
                          {formatCompactNumber(analytics.enrollmentCount)} learners
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-3">{course.description || 'No description provided.'}</p>
                    <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                      {course.estimatedDurationMinutes} mins - {course.version}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Completion</p>
                        <p className="text-xs font-black text-slate-900 mt-1">{Math.round(analytics.completionRate)}%</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Avg Progress</p>
                        <p className="text-xs font-black text-slate-900 mt-1">{Math.round(analytics.averageProgressPercent)}%</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Avg Time</p>
                        <p className="text-xs font-black text-slate-900 mt-1">{formatClock(analytics.averageElapsedSeconds)}</p>
                      </div>
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-amber-700">{reason}</div>
                    {history && (
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        {Math.round(history.lastProgress)}% complete - last session {toDaysAgoLabel(history.lastEndedAtMs)}
                      </div>
                    )}
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
                      <button
                        type="button"
                        onClick={() => void shareCourse(course)}
                        className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase tracking-widest text-slate-700"
                      >
                        Share
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
                    </div>
                    <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold text-slate-600">{formatCompactNumber(analytics.enrollmentCount)} people took this</p>
                      <p className="text-[11px] font-semibold text-slate-600">Best: {Math.max(Math.round(history?.bestProgress || 0), Math.round(analytics.completionRate))}%</p>
                    </div>
                  </article>
                ))}
                {visibleCards.length === 0 && (
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
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-black text-slate-900 uppercase">Session History</h2>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{sessions.length} sessions</span>
            </div>
            {loadingSessions ? (
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Loading sessions...</p>
            ) : (
              <div className="rounded-2xl border border-slate-200 overflow-hidden">
                <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <p>Course</p>
                  <p>Date</p>
                  <p>Duration</p>
                  <p>Status</p>
                </div>
                <div className="max-h-[70dvh] overflow-y-auto pr-1">
                {sessions.map((session) => (
                  <div key={session.id} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr] gap-2 md:gap-3 px-4 py-3 border-b last:border-b-0 border-slate-200 hover:bg-slate-50">
                    <div>
                      <p className="text-sm font-black uppercase text-slate-900">{session.courseTitle}</p>
                      <p className="text-[11px] text-slate-400 font-semibold">Progress: {session.progressPercent}%</p>
                    </div>
                    <div className="text-xs font-semibold text-slate-600">{new Date(session.endedAt).toLocaleDateString()}</div>
                    <div className="text-xs font-semibold text-slate-600">{formatClock(session.elapsedSeconds)}</div>
                    <div>
                      <span className={`text-[10px] px-2 py-1 rounded-full font-black uppercase tracking-widest ${session.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : session.status === 'timed-out' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                        {session.status}
                      </span>
                    </div>
                  </div>
                ))}
                </div>
                {sessions.length === 0 && <p className="p-5 text-xs font-black uppercase tracking-widest text-slate-400">No course sessions yet.</p>}
              </div>
            )}
          </section>
        )}

        {!activeCourse && tab === 'manage' && isAdmin && (
          <section className="bg-white border border-slate-100 rounded-2xl p-5 space-y-4">
            <h2 className="text-lg font-black text-slate-900 uppercase">Upload Course (HTML + Native)</h2>
            <p className="text-xs text-slate-500">
              Supported files: <strong>.html/.htm/.xhtml</strong> and <strong>.cbtcourse</strong> (native optimized format).
            </p>
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
                Select Course File
                <input
                  type="file"
                  accept=".html,.htm,.xhtml,.cbtcourse,text/html,application/json"
                  className="hidden"
                  onChange={(e) => void handleUploadFile(e.target.files?.[0] || null)}
                />
              </label>
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500 truncate">{uploadFileName || 'No file selected'}</span>
            </div>
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-1">Detected Format</p>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-700">{uploadVersion}</p>
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

            <div className="mt-4 p-4 rounded-2xl border border-amber-100 bg-amber-50 space-y-3">
              <h3 className="text-sm font-black uppercase tracking-widest text-amber-800">cbtcourse File Manual</h3>
              <p className="text-xs text-amber-900 leading-relaxed">
                Use <strong>.cbtcourse</strong> when you want native metadata + predictable rendering in this app. HTML files still work natively.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void copyTemplateToClipboard()}
                  className="px-4 py-2 rounded-xl bg-slate-950 text-amber-500 text-xs font-black uppercase tracking-widest"
                >
                  Copy Template
                </button>
                <button
                  type="button"
                  onClick={downloadTemplateFile}
                  className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-black uppercase tracking-widest"
                >
                  Download .cbtcourse
                </button>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-950 text-amber-400 p-3 text-[11px] font-mono max-h-56 overflow-auto whitespace-pre-wrap">
                {CBTCOURSE_TEMPLATE}
              </div>
              <div className="text-xs text-amber-900 leading-relaxed space-y-1">
                <p><strong>Spec:</strong> `format` must be `cbtcourse-v1`.</p>
                <p><strong>meta.title:</strong> optional but recommended (autofills upload title).</p>
                <p><strong>meta.description/tags/estimatedDurationMinutes:</strong> optional metadata.</p>
                <p><strong>content.html:</strong> full HTML document string, OR use `content.headHtml` + `content.bodyHtml`.</p>
                <p><strong>Navigation links:</strong> use section ids (`href="#sec-topic"`) for smooth in-course scrolling.</p>
                <p><strong>Mobile:</strong> include responsive CSS (`@media (max-width: 768px)`) and a viewport meta tag (app injects one if missing).</p>
              </div>
            </div>
          </section>
        )}

        {activeCourse && (
          <section className="fixed inset-0 z-[160] bg-slate-950 flex flex-col">
            <div className="p-3 md:p-4 border-b border-slate-800 bg-slate-950 text-white flex flex-col md:flex-row md:items-center md:justify-between gap-2 safe-top">
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-amber-400">Active Course</p>
                <h2 className="text-base md:text-lg font-black uppercase">{activeCourse.title}</h2>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-start md:justify-end">
                <span className={`px-3 py-2 rounded-xl text-[11px] md:text-xs font-black uppercase tracking-widest ${timeRemaining <= 60 ? 'bg-red-500 text-white' : 'bg-slate-800 text-amber-400'}`}>
                  {formatClock(timeRemaining)}
                </span>
                <button
                  onClick={() => setShowOutlineMobile((prev) => !prev)}
                  className="lg:hidden px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest bg-slate-800 text-slate-100"
                >
                  {showOutlineMobile ? 'Hide Outline' : 'Outline'}
                </button>
                <button
                  onClick={() => setIsRunning((prev) => !prev)}
                  className="px-3 py-2 rounded-xl text-[11px] md:text-xs font-black uppercase tracking-widest bg-slate-800 text-slate-100"
                >
                  {isRunning ? 'Pause' : 'Resume'}
                </button>
                <button
                  onClick={() => void finishSession('completed')}
                  className="px-3 py-2 rounded-xl text-[11px] md:text-xs font-black uppercase tracking-widest bg-emerald-500 text-white"
                >
                  Complete
                </button>
                <button
                  onClick={() => void closePlayer()}
                  className="px-3 py-2 rounded-xl text-[11px] md:text-xs font-black uppercase tracking-widest bg-red-500 text-white"
                >
                  Exit
                </button>
              </div>
            </div>
            <div className="relative min-h-0 flex-1 lg:grid lg:grid-cols-[300px_1fr]">
              <aside className="hidden lg:block border-r border-slate-200 p-4 bg-slate-50 overflow-y-auto">
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
              <div className="relative min-h-0 h-full">
                {!frameLoaded && (
                  <div className="absolute inset-0 z-10 bg-white/95 flex items-center justify-center">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">Rendering course...</p>
                  </div>
                )}
                <iframe
                  key={frameReloadNonce}
                  ref={frameRef}
                  title={activeCourse.title}
                  srcDoc={activeCourseDoc}
                  onLoad={handleCourseFrameLoad}
                  className="w-full h-full border-0 bg-white"
                  sandbox="allow-scripts allow-forms allow-modals allow-downloads allow-popups allow-same-origin"
                />
              </div>
              {showOutlineMobile && (
                <button
                  type="button"
                  onClick={() => setShowOutlineMobile(false)}
                  className="lg:hidden absolute inset-0 bg-slate-950/45 z-20"
                  aria-label="Close outline"
                />
              )}
              <aside className={`lg:hidden absolute left-0 top-0 bottom-0 w-[86vw] max-w-[340px] border-r border-slate-200 p-4 bg-slate-50 overflow-y-auto z-30 transition-transform duration-200 ${showOutlineMobile ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-black uppercase tracking-widest text-slate-500">Outline Checklist</p>
                  <button
                    type="button"
                    onClick={() => setShowOutlineMobile(false)}
                    className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border border-slate-300 text-slate-600"
                  >
                    Close
                  </button>
                </div>
                <div className="text-xs font-black uppercase tracking-widest text-amber-700 mb-4">{progressPercent}% complete</div>
                <div className="space-y-2 pb-10">
                  {activeOutline.map((heading, idx) => (
                    <label key={`mobile-${heading}-${idx}`} className="flex items-start gap-2 p-2 rounded-lg bg-white border border-slate-200 text-xs">
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
