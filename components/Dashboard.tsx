import React, { useState, useEffect } from 'react';
import { User, MockTest, ExamResult, QuizQuestion, SharedQuiz, CsvQuestionBundle, CustomThemeConfig, Announcement, AnnouncementRead, AppNotification, ClassSession, Course, NotificationPreference, NotificationType, PrepMode } from '../types';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, getDocs, getDocsFromServer, limit, addDoc, updateDoc, deleteDoc, doc, orderBy, setDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import logo from '../assets/scholar-main.png';
import PartnershipLogos from './PartnershipLogos';
import { PREP_MODE_FEATURES, PREP_MODE_LABELS, getTestPrepMode, hasActivePrepLicense } from '../lib/prepModes';
import factsJson from '../data/facts.json';
import { AppTheme, THEMES } from '../theme';
import { toast } from './ui/Toast';
import { confirmDialog } from './ui/ConfirmDialog';
import CommunityHub from './CommunityHub';
import NotificationBell from './notifications/NotificationBell';
import NotificationPreferences from './notifications/NotificationPreferences';
import AnnouncementFeed from './announcements/AnnouncementFeed';
import AnnouncementComposer from './announcements/AnnouncementComposer';
import ClassCalendar from './schedule/ClassCalendar';
import SessionModal from './schedule/SessionModal';
import { buildAnnouncementReadId, getBodyPreview, getDefaultNotificationPreferences, isTeacherRole, overlaps, sanitizeRichText } from '../lib/classboard';
import { maybeShowBrowserNotification, notify } from '../lib/notify';
import { usePushNotifications } from '../lib/usePushNotifications';

interface DashboardProps {
  user: User;
  prepMode: PrepMode;
  onSwitchPrepMode: () => void;
  onLogout: () => void;
  onStartTest: (test: MockTest, options?: { quizMode?: boolean }) => void;
  onReviewResult: (result: ExamResult) => void;
  onOpenCourses?: () => void;
  onOpenVideos?: () => void;
  onSaveOfflineTest?: (test: MockTest) => void;
  onReturnToAdmin?: () => void;
  isReadOnly?: boolean;
  deadlineLabel?: string;
  isActivatingLicense?: boolean;
  currentTheme?: AppTheme;
  onThemeChange?: (theme: AppTheme) => void;
  customTheme?: CustomThemeConfig;
  onCustomThemeChange?: (theme: CustomThemeConfig) => void;
  onActivateLicense?: (key: string) => Promise<void>;
  onOpenActivationSupport?: () => void;
  onOpenUpdateManual?: () => void;
  currentUiMode?: MobileUiMode;
  onUiModeChange?: (mode: MobileUiMode) => void;
  onUserProfileUpdate?: (patch: Partial<User>) => void;
  onOpenSocialProfileSetup?: () => void;
}

type TestSortMode = 'updated' | 'name' | 'duration' | 'attempts';
type MainTab = 'home' | 'announcements' | 'schedule' | 'community' | 'videos' | 'ranks' | 'create' | 'reviews' | 'settings' | 'profile';
type MobileUiMode = 'dark' | 'light';
type TestShelf = 'all' | 'unfiled' | 'archived' | string;

interface TestFolder {
  id: string;
  name: string;
}

interface RankRow {
  rank: number;
  userId: string;
  userName: string;
  attempts: number;
  averagePercent: number;
  bestPercent: number;
  lastCompletedAt?: string;
}

interface TestLeaderboardRow {
  id: string;
  userId: string;
  userName: string;
  testId: string;
  testName: string;
  score: number;
  maxScore: number;
  scorePercent: number;
  completedAt: string;
}

interface DailyFactEntry {
  id: string;
  text: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
}

const MAX_TEST_FOLDERS = 10;
const DAILY_FACT_DISMISSED_PREFIX = 'dailyFactDismissed';
const DAILY_FACT_NOTIFIED_PREFIX = 'dailyFactNotified';
const DAILY_FACTS = Array.isArray(factsJson) ? factsJson as DailyFactEntry[] : [];
const THEME_COLOR_FIELDS: Array<{ key: keyof CustomThemeConfig; label: string }> = [
  { key: 'bgStart', label: 'Background Start' },
  { key: 'bgEnd', label: 'Background End' },
  { key: 'shellStart', label: 'Header Start' },
  { key: 'shellMid', label: 'Header Mid' },
  { key: 'shellEnd', label: 'Header End' },
  { key: 'accent', label: 'Accent' },
  { key: 'accentSoft', label: 'Accent Soft' },
  { key: 'accentText', label: 'Accent Text' },
  { key: 'card', label: 'Card' },
  { key: 'border', label: 'Border' }
];

const getUtcDateKey = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getUtcDayNumber = (date = new Date()) => {
  const utcMidnightMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor(utcMidnightMs / 86400000);
};

const getDailyFact = (date = new Date()): DailyFactEntry | null => {
  if (DAILY_FACTS.length === 0) return null;
  const index = ((getUtcDayNumber(date) % DAILY_FACTS.length) + DAILY_FACTS.length) % DAILY_FACTS.length;
  return DAILY_FACTS[index] || null;
};

const getDailyFactDismissedKey = (userId: string, dateKey: string) => `${DAILY_FACT_DISMISSED_PREFIX}:${userId}:${dateKey}`;
const getDailyFactNotifiedKey = (userId: string, dateKey: string) => `${DAILY_FACT_NOTIFIED_PREFIX}:${userId}:${dateKey}`;

const LeaderboardModal: React.FC<{ test: MockTest, onClose: () => void }> = ({ test, onClose }) => {
  const [topScores, setTopScores] = useState<TestLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    const q = query(collection(db, 'testLeaderboardPublic'), where('testId', '==', test.id), limit(1000));
    const unsub = onSnapshot(q, (snap) => {
      const results = snap.docs
        .map(d => ({ ...d.data(), id: d.id } as TestLeaderboardRow))
        .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());

      const firstAttempts: Record<string, TestLeaderboardRow> = {};
      results.forEach(res => {
        if (!firstAttempts[res.userId]) firstAttempts[res.userId] = res;
      });

      const sorted = Object.values(firstAttempts)
        .sort((a, b) => b.scorePercent - a.scorePercent)
        .slice(0, 10);

      setTopScores(sorted);
      setLoading(false);
    }, (err: any) => {
      console.error(err);
      if (err?.code === 'permission-denied') {
        setLoadError('Leaderboard unavailable for this account.');
      } else {
        setLoadError('Could not load leaderboard.');
      }
      setLoading(false);
    });

    return () => unsub();
  }, [test.id]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm safe-top safe-bottom">
      <div className="w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 border-b-8 border-amber-500">
        <div className="bg-slate-900 p-8 text-center relative">
          <button onClick={onClose} className="absolute top-6 right-6 text-slate-400 hover:text-white"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
          <p className="text-amber-500 text-xs font-black uppercase tracking-widest mb-1">Leaderboard</p>
          <h2 className="text-xl font-bold text-white uppercase truncate">{test.name}</h2>
          <p className="text-xs text-slate-400 uppercase mt-2 italic">First attempt only</p>
        </div>
        <div className="p-6 max-h-[60vh] overflow-y-auto no-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center py-20"><div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div><p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading...</p></div>
          ) : loadError ? (
            <div className="text-center py-20 text-red-500 font-bold uppercase text-xs">{loadError}</div>
          ) : topScores.length === 0 ? (
            <div className="text-center py-20 text-slate-400 font-bold uppercase text-xs">No attempts yet.</div>
          ) : (
            <div className="space-y-2">
              {topScores.map((res, i) => (
                <div key={res.id} className="flex items-center gap-4 p-5 rounded-2xl bg-slate-50 border border-slate-100 shadow-sm">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black ${i === 0 ? 'bg-amber-500 text-slate-950 shadow-md' : 'bg-slate-100 text-slate-400'}`}>{i + 1}</div>
                  <div className="flex-1 text-sm font-bold text-slate-900 truncate uppercase">{res.userName}</div>
                  <div className="text-xl font-black text-slate-950">{Math.round(res.scorePercent)}%</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Dashboard: React.FC<DashboardProps> = ({
  user,
  prepMode,
  onSwitchPrepMode,
  onLogout,
  onStartTest,
  onReviewResult,
  onOpenCourses,
  onOpenVideos,
  onSaveOfflineTest,
  onReturnToAdmin,
  isReadOnly = false,
  deadlineLabel,
  isActivatingLicense = false,
  currentTheme = 'classic',
  onThemeChange,
  customTheme,
  onCustomThemeChange,
  onActivateLicense,
  onOpenActivationSupport,
  onOpenUpdateManual,
  currentUiMode = 'light',
  onUiModeChange,
  onUserProfileUpdate,
  onOpenSocialProfileSetup
}) => {
  const prepFeatures = PREP_MODE_FEATURES[prepMode];
  const parseIsoDate = (value?: string) => {
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : 0;
  };

  const normalizeTestsForDisplay = (rows: MockTest[], maxRows: number) => {
    return rows
      .filter((t) => !(t as any).isPaused)
      .filter((t) => getTestPrepMode(t) === prepMode)
      .sort((a, b) => parseIsoDate((b as any).updatedAt || b.createdAt) - parseIsoDate((a as any).updatedAt || a.createdAt))
      .slice(0, maxRows);
  };

  const getFolderStorageKey = () => `testFolders:${user.id}`;
  const getFolderAssignmentsStorageKey = () => `testFolderAssignments:${user.id}`;
  const getSortModeStorageKey = () => `testSortMode:${user.id}`;
  const getSelectedFolderStorageKey = () => `selectedTestFolder:${user.id}`;

  const normalizeFolderList = (value: any): TestFolder[] => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const normalized: TestFolder[] = [];
    value.forEach((raw) => {
      const id = String(raw?.id || '').trim();
      const name = String(raw?.name || '').trim();
      if (!id || !name || seen.has(id)) return;
      seen.add(id);
      normalized.push({ id, name });
    });
    return normalized.slice(0, MAX_TEST_FOLDERS);
  };

  const [tests, setTests] = useState<MockTest[]>([]);
  const [history, setHistory] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [testCounts, setTestCounts] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<string | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState<MockTest | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>('home');
  const [testFolders, setTestFolders] = useState<TestFolder[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<TestShelf>('all');
  const [testFolderAssignments, setTestFolderAssignments] = useState<Record<string, string>>({});
  const [sortMode, setSortMode] = useState<TestSortMode>('updated');
  const [activationInput, setActivationInput] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [lowDataMode, setLowDataMode] = useState(false);
  const [quizName, setQuizName] = useState('');
  const [quizDescription, setQuizDescription] = useState('');
  const [quizDurationMins, setQuizDurationMins] = useState(30);
  const [quizAllowRetake, setQuizAllowRetake] = useState(true);
  const [quizMaxAttempts, setQuizMaxAttempts] = useState<number | ''>('');
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([
    { id: 'qq_' + Date.now(), text: '', options: ['', '', '', ''], correctAnswerIndex: 0, explanation: '' }
  ]);
  const [isPublishingQuiz, setIsPublishingQuiz] = useState(false);
  const [myQuizzes, setMyQuizzes] = useState<SharedQuiz[]>([]);
  const [expandedBundleTestId, setExpandedBundleTestId] = useState<string | null>(null);
  const [rankRows, setRankRows] = useState<RankRow[]>([]);
  const [rankLoading, setRankLoading] = useState(false);
  const [rankError, setRankError] = useState<string | null>(null);
  const [profileName, setProfileName] = useState(user.name || '');
  const [profileTitle, setProfileTitle] = useState(user.title || '');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(user.avatarUrl || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [showDailyFact, setShowDailyFact] = useState(false);
  const [classOptions, setClassOptions] = useState<Course[]>([]);
  const [classEnrollments, setClassEnrollments] = useState<Array<{ id: string; courseId: string; userId: string; userName: string }>>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementReads, setAnnouncementReads] = useState<AnnouncementRead[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreference[]>([]);
  const [scheduleSessions, setScheduleSessions] = useState<ClassSession[]>([]);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [selectedSession, setSelectedSession] = useState<ClassSession | null>(null);
  const [showAnnouncementComposer, setShowAnnouncementComposer] = useState(false);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const isStudent = user.role === 'student';
  const isTeacher = isTeacherRole(user);
  const activePrepLicense = user.licenses?.[prepMode];
  const legacyOauActive = prepMode === 'oau' && user.subscriptionStatus === 'active';
  const licenseEndsMs = Date.parse(activePrepLicense?.endsAt || (legacyOauActive ? user.subscriptionEndsAt || '' : ''));
  const licenseEndsLabel = Number.isFinite(licenseEndsMs)
    ? new Date(licenseEndsMs).toLocaleDateString()
    : null;
  const licenseStatusLabel = hasActivePrepLicense(user, prepMode)
    ? `${PREP_MODE_LABELS[prepMode]} active${licenseEndsLabel ? ` (until: ${licenseEndsLabel})` : ''}`
    : `${PREP_MODE_LABELS[prepMode]} inactive`;
  const dailyFactDateKey = getUtcDateKey();
  const dailyFact = getDailyFact();
  const dailyFactBadge = dailyFact?.category?.replace(/-/g, ' ') || 'daily fact';
  const enrolledClassIds = Array.from(new Set(classEnrollments.filter((row) => row.userId === user.id).map((row) => row.courseId)));
  const visibleClassIds = isTeacher ? classOptions.map((item) => item.id) : enrolledClassIds;
  const unreadAnnouncementIds = new Set(
    announcements
      .filter((item) => !announcementReads.some((read) => read.announcementId === item.id && read.userId === user.id))
      .map((item) => item.id)
  );
  const studentsForComposer = classEnrollments
    .filter((row) => visibleClassIds.includes(row.courseId))
    .map((row) => ({ id: row.userId, name: row.userName || 'Student' }));
  const readCountsByAnnouncement = announcementReads.reduce<Record<string, number>>((acc, item) => {
    acc[item.announcementId] = (acc[item.announcementId] || 0) + 1;
    return acc;
  }, {});
  const totalRecipientsByAnnouncement = announcements.reduce<Record<string, number>>((acc, item) => {
    const classRecipients = classEnrollments.filter((row) => row.courseId === item.classId);
    acc[item.id] = item.targetAudience === 'all'
      ? classRecipients.length
      : classRecipients.filter((row) => (item.targetIds || []).includes(row.userId)).length;
    return acc;
  }, {});

  usePushNotifications(user, notificationsEnabled);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(`notifications:${user.id}`);
    setNotificationsEnabled(stored !== 'off');
    const lowDataStored = window.localStorage.getItem(`lowDataMode:${user.id}`);
    setLowDataMode(lowDataStored === 'on');
    try {
      const folderRaw = window.localStorage.getItem(getFolderStorageKey());
      if (folderRaw) setTestFolders(normalizeFolderList(JSON.parse(folderRaw)));
    } catch {
      setTestFolders([]);
    }
    try {
      const assignmentRaw = window.localStorage.getItem(getFolderAssignmentsStorageKey());
      if (assignmentRaw) {
        const parsed = JSON.parse(assignmentRaw);
        if (parsed && typeof parsed === 'object') {
          setTestFolderAssignments(parsed as Record<string, string>);
        }
      }
    } catch {
      setTestFolderAssignments({});
    }
    const storedSortMode = window.localStorage.getItem(getSortModeStorageKey()) as TestSortMode | null;
    if (storedSortMode && ['updated', 'name', 'duration', 'attempts'].includes(storedSortMode)) {
      setSortMode(storedSortMode);
    }
    const storedSelectedFolder = window.localStorage.getItem(getSelectedFolderStorageKey());
    if (storedSelectedFolder) {
      setSelectedFolderId(storedSelectedFolder as 'all' | 'unfiled' | string);
    }
    setPreferencesHydrated(true);
  }, [user.id]);

  useEffect(() => {
    if (typeof window === 'undefined' || !dailyFact) {
      setShowDailyFact(false);
      return;
    }
    const dismissed = window.localStorage.getItem(getDailyFactDismissedKey(user.id, dailyFactDateKey)) === '1';
    setShowDailyFact(!dismissed);
  }, [dailyFact, dailyFactDateKey, user.id]);

  useEffect(() => {
    if (typeof window === 'undefined' || !preferencesHydrated || !dailyFact || !notificationsEnabled) return;
    const notifyKey = getDailyFactNotifiedKey(user.id, dailyFactDateKey);
    if (window.localStorage.getItem(notifyKey) === '1') return;

    toast.info('Fact of the Day', dailyFact.text);
    window.localStorage.setItem(notifyKey, '1');

    if (!('Notification' in window)) return;
    const sendBrowserNotification = () => {
      try {
        new Notification('Fact of the Day', { body: dailyFact.text });
      } catch {
        // Ignore browser notification failures.
      }
    };

    if (Notification.permission === 'granted') {
      sendBrowserNotification();
      return;
    }
    if (Notification.permission !== 'default') return;

    Notification.requestPermission()
      .then((permission) => {
        if (permission === 'granted') sendBrowserNotification();
      })
      .catch(() => {
        // Ignore browser notification failures.
      });
  }, [dailyFact, dailyFactDateKey, notificationsEnabled, preferencesHydrated, user.id]);

  useEffect(() => {
    setProfileName(user.name || '');
    setProfileTitle(user.title || '');
    setProfileAvatarUrl(user.avatarUrl || '');
  }, [user.name, user.title, user.avatarUrl]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(getFolderStorageKey(), JSON.stringify(testFolders));
  }, [testFolders, user.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(getFolderAssignmentsStorageKey(), JSON.stringify(testFolderAssignments));
  }, [testFolderAssignments, user.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(getSortModeStorageKey(), sortMode);
  }, [sortMode, user.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(getSelectedFolderStorageKey(), selectedFolderId);
  }, [selectedFolderId, user.id]);

  const copyTestLink = async (test: MockTest) => {
    if (isReadOnly) return;
    const link = `${window.location.origin}/test/${test.id}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const temp = document.createElement('input');
        temp.value = link;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      toast.success('Link copied', 'Test link copied to clipboard.');
    } catch {
      toast.error('Copy failed', `Could not copy link. ${link}`);
    }
  };

  const handleToggleNotifications = () => {
    const next = !notificationsEnabled;
    setNotificationsEnabled(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`notifications:${user.id}`, next ? 'on' : 'off');
    }
  };

  const dismissDailyFact = () => {
    setShowDailyFact(false);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(getDailyFactDismissedKey(user.id, dailyFactDateKey), '1');
    }
  };

  const handleToggleLowDataMode = () => {
    const next = !lowDataMode;
    setLowDataMode(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`lowDataMode:${user.id}`, next ? 'on' : 'off');
    }
  };

  const handleActivateFromSettings = async () => {
    const key = activationInput.trim().toUpperCase();
    if (!key) {
      toast.warning('Missing key', 'Enter your activation key.');
      return;
    }
    if (!onActivateLicense) return;
    await onActivateLicense(key);
    setActivationInput('');
  };

  const addQuizQuestion = () => {
    setQuizQuestions(prev => [...prev, {
      id: 'qq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      text: '',
      options: ['', '', '', ''],
      correctAnswerIndex: 0,
      explanation: ''
    }]);
  };

  const removeQuizQuestion = (id: string) => {
    setQuizQuestions(prev => prev.length > 1 ? prev.filter(q => q.id !== id) : prev);
  };

  const updateQuizQuestion = (id: string, updater: (q: QuizQuestion) => QuizQuestion) => {
    setQuizQuestions(prev => prev.map(q => q.id === id ? updater(q) : q));
  };

  const copyText = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const temp = document.createElement('input');
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
  };

  const publishQuiz = async () => {
    const trimmedName = quizName.trim();
    if (!trimmedName) {
      toast.warning('Missing name', 'Quiz name is required.');
      return;
    }
    if (!quizAllowRetake && quizMaxAttempts !== '' && Number(quizMaxAttempts) > 1) {
      toast.warning('Invalid attempts', 'Retake is off, so max attempts must be 1.');
      return;
    }

    const normalizedQuestions = quizQuestions.map((q) => ({
      ...q,
      text: q.text.trim(),
      options: q.options.map(opt => opt.trim()),
      explanation: (q.explanation || '').trim()
    }));

    const invalidQuestion = normalizedQuestions.find((q) =>
      !q.text || q.options.some(opt => !opt) || q.correctAnswerIndex < 0 || q.correctAnswerIndex > 3
    );
    if (invalidQuestion) {
      toast.warning('Invalid questions', 'Each question must have text, 4 options, and a valid correct answer.');
      return;
    }

    setIsPublishingQuiz(true);
    try {
      const quizDoc = await addDoc(collection(db, 'quizzes'), {
        name: trimmedName,
        description: quizDescription.trim(),
        totalDurationSeconds: Math.max(1, Number(quizDurationMins) || 1) * 60,
        allowRetake: quizAllowRetake,
        maxAttempts: quizAllowRetake ? (quizMaxAttempts === '' ? null : Number(quizMaxAttempts)) : 1,
        isActive: true,
        createdBy: user.id,
        creatorName: user.name,
        createdAt: new Date().toISOString(),
        questions: normalizedQuestions
      });
      const link = `${window.location.origin}/quiz/${quizDoc.id}`;
      await copyText(link);
      toast.success('Quiz published', 'Share link copied.');
      setQuizName('');
      setQuizDescription('');
      setQuizDurationMins(30);
      setQuizAllowRetake(true);
      setQuizMaxAttempts('');
      setQuizQuestions([{ id: 'qq_' + Date.now(), text: '', options: ['', '', '', ''], correctAnswerIndex: 0, explanation: '' }]);
      setActiveTab('home');
    } catch (err: any) {
      toast.error('Publish failed', err?.message || 'Could not publish quiz.');
    } finally {
      setIsPublishingQuiz(false);
    }
  };

  useEffect(() => {
    const testsLimit = lowDataMode ? 12 : 30;
    const historyLimit = lowDataMode ? 25 : 100;
    let hasFreshServerSnapshot = false;
    let allowCacheFallback = false;
    const testsQuery = query(collection(db, 'tests'), where('isApproved', '==', true));

    const hydrateTestsFromServer = async () => {
      try {
        const snap = await getDocsFromServer(testsQuery);
        hasFreshServerSnapshot = true;
        const loaded = normalizeTestsForDisplay(
          snap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest)),
          testsLimit
        );
        setTests(loaded);
        setErrors(null);
        setLoading(false);
      } catch {
        allowCacheFallback = true;
        // If server fetch fails, realtime listener fallback below can still hydrate from cache/offline.
      }
    };
    hydrateTestsFromServer();

    const unsubTests = onSnapshot(
      testsQuery,
      { includeMetadataChanges: true },
      (snap) => {
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        if (snap.metadata.fromCache && isOnline && !hasFreshServerSnapshot && !allowCacheFallback) {
          return;
        }
        if (!snap.metadata.fromCache) {
          hasFreshServerSnapshot = true;
        }
        const loaded = normalizeTestsForDisplay(
          snap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest)),
          testsLimit
        );
        setTests(loaded);
        setErrors(null);
        setLoading(false);
      },
      (err) => {
        console.error('Test load error:', err);
        setErrors('Unable to load tests. Please check your connection.');
        setLoading(false);
      }
    );
    const unsubHistory = onSnapshot(
      query(collection(db, 'results'), where('userId', '==', user.id), limit(historyLimit)),
      (snap) => {
        const sorted = snap.docs
          .map(d => ({ ...d.data(), id: d.id } as ExamResult))
          .filter((result) => ((result.prepMode as PrepMode) || 'oau') === prepMode)
          .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
          .slice(0, lowDataMode ? 20 : 50);
        setHistory(sorted);
      },
      (err) => {
        console.error('History load error:', err);
        setErrors('Unable to load history right now.');
      }
    );
    return () => { unsubTests(); unsubHistory(); };
  }, [user.id, lowDataMode, prepMode]);

  useEffect(() => {
    const fetchCounts = async () => {
      if (lowDataMode) {
        const fallbackCounts: Record<string, number> = {};
        tests.forEach((test) => {
          fallbackCounts[test.id] = (test as any).attemptCount || 0;
        });
        setTestCounts(fallbackCounts);
        return;
      }
      const counts: Record<string, number> = {};
      for (const test of tests) {
        try {
          const q = query(collection(db, 'testLeaderboardPublic'), where('testId', '==', test.id), limit(1000));
          const snap = await getDocs(q);
          const unique = new Set<string>();
          snap.docs.forEach(d => unique.add((d.data() as TestLeaderboardRow).userId));
          counts[test.id] = unique.size;
        } catch (err: any) {
          console.error('Count error:', err);
          counts[test.id] = (test as any).attemptCount || 0;
        }
      }
      setTestCounts(counts);
    };
    if (tests.length > 0) fetchCounts();
  }, [tests, lowDataMode]);

  useEffect(() => {
    if (activeTab !== 'create') return;
    const unsub = onSnapshot(
      query(collection(db, 'quizzes'), where('createdBy', '==', user.id), limit(100)),
      (snap) => {
        const rows = snap.docs
          .map(d => ({ ...d.data(), id: d.id } as SharedQuiz))
          .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        setMyQuizzes(rows);
      },
      () => {
        setMyQuizzes([]);
      }
    );
    return () => unsub();
  }, [activeTab, user.id]);

  useEffect(() => {
    if (activeTab !== 'ranks') return;
    setRankLoading(true);
    setRankError(null);
    const unsub = onSnapshot(
      query(collection(db, 'leaderboardPublic'), orderBy('sortKey', 'desc'), limit(100)),
      (snap) => {
        const rows: RankRow[] = snap.docs
          .map((d, index) => {
            const data = d.data() as any;
            return {
              rank: index + 1,
              userId: String(data.userId || d.id),
              userName: String(data.userName || 'Unknown User'),
              attempts: Math.max(0, Number(data.attempts || 0)),
              averagePercent: Math.max(0, Math.min(100, Number(data.averagePercent || 0))),
              bestPercent: Math.max(0, Math.min(100, Number(data.bestPercent || 0))),
              lastCompletedAt: typeof data.lastCompletedAt === 'string' ? data.lastCompletedAt : ''
            } as RankRow;
          });

        setRankRows(rows);
        setRankLoading(false);
      },
      (err: any) => {
        console.error('Ranks load error:', err);
        setRankError(err?.code === 'permission-denied'
          ? 'Ranks unavailable. Ask admin to allow leaderboard reads.'
          : 'Could not load ranks right now.');
        setRankRows([]);
        setRankLoading(false);
      }
    );
    return () => unsub();
  }, [activeTab]);

  useEffect(() => {
    if (!prepFeatures.courses && !prepFeatures.attendance && !prepFeatures.community) {
      setClassOptions([]);
      return;
    }
    const coursesQuery = isTeacher
      ? query(collection(db, 'courses'), orderBy('updatedAt', 'desc'), limit(200))
      : query(collection(db, 'courses'), where('isPublished', '==', true), orderBy('updatedAt', 'desc'), limit(200));
    const unsub = onSnapshot(coursesQuery, (snap) => {
      const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id } as Course));
      setClassOptions(rows);
    }, () => {
      setClassOptions([]);
    });
    return () => unsub();
  }, [isTeacher, prepFeatures.courses, prepFeatures.attendance, prepFeatures.community]);

  useEffect(() => {
    if (!prepFeatures.attendance && !prepFeatures.community) {
      setClassEnrollments([]);
      return;
    }
    const unsub = onSnapshot(query(collection(db, 'courseEnrollmentsPublic'), limit(5000)), (snap) => {
      const baseRows = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          courseId: String(data.courseId || ''),
          userId: String(data.userId || ''),
          userName: String(data.userName || data.userId || 'Student')
        };
      }).filter((row) => row.courseId && row.userId);
      setClassEnrollments(baseRows);
    }, () => {
      setClassEnrollments([]);
    });
    return () => unsub();
  }, [prepFeatures.attendance, prepFeatures.community]);

  useEffect(() => {
    if (!prepFeatures.attendance) {
      setAnnouncements([]);
      return;
    }
    if (visibleClassIds.length === 0 && !isTeacher) {
      setAnnouncements([]);
      return;
    }
    const unsub = onSnapshot(query(collection(db, 'announcements'), limit(300)), (snap) => {
      const rows = snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as Announcement))
        .filter((item) => item.published !== false)
        .filter((item) => visibleClassIds.includes(item.classId))
        .filter((item) => {
          if (isTeacher) return true;
          if (item.targetAudience === 'all') return true;
          return (item.targetIds || []).includes(user.id);
        });
      setAnnouncements(rows);
    }, () => {
      setAnnouncements([]);
    });
    return () => unsub();
  }, [isTeacher, user.id, visibleClassIds.join('|'), prepFeatures.attendance]);

  useEffect(() => {
    if (!prepFeatures.attendance) {
      setAnnouncementReads([]);
      return;
    }
    const unsub = onSnapshot(query(collection(db, 'announcementReads'), limit(5000)), (snap) => {
      const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id } as AnnouncementRead));
      setAnnouncementReads(rows);
    }, () => {
      setAnnouncementReads([]);
    });
    return () => unsub();
  }, [prepFeatures.attendance]);

  useEffect(() => {
    if (!prepFeatures.attendance) {
      setScheduleSessions([]);
      return;
    }
    if (visibleClassIds.length === 0 && !isTeacher) {
      setScheduleSessions([]);
      return;
    }
    const unsub = onSnapshot(query(collection(db, 'classSessions'), limit(300)), (snap) => {
      const rows = snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as ClassSession))
        .filter((item) => visibleClassIds.includes(item.classId));
      setScheduleSessions(rows);
    }, () => {
      setScheduleSessions([]);
    });
    return () => unsub();
  }, [isTeacher, visibleClassIds.join('|'), prepFeatures.attendance]);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'notifications'), where('userId', '==', user.id), limit(100)),
      async (snap) => {
        const rows = snap.docs
          .map((d) => ({ ...d.data(), id: d.id } as AppNotification))
          .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
        setNotifications(rows);

        const unreadRows = rows.filter((item) => !item.isRead).slice(0, 1);
        if (unreadRows.length === 0) return;
        const pref = notificationPreferences.find((item) => item.notificationType === unreadRows[0].type);
        maybeShowBrowserNotification(unreadRows[0], pref, user);
      },
      () => setNotifications([])
    );
    return () => unsub();
  }, [notificationPreferences, user]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'notificationPreferences'), where('userId', '==', user.id), limit(50)), async (snap) => {
      if (snap.empty) {
        const defaults = getDefaultNotificationPreferences(user.id);
        await Promise.all(defaults.map((row) => setDoc(doc(db, 'notificationPreferences', row.id), row).catch(() => undefined)));
        setNotificationPreferences(defaults);
        return;
      }
      const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id } as NotificationPreference));
      setNotificationPreferences(rows);
    }, () => {
      setNotificationPreferences([]);
    });
    return () => unsub();
  }, [user.id]);

  if (loading) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-50"><img src={logo} className="w-12 h-12 animate-pulse mb-4" alt="Loading" /><p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Opening Portal...</p></div>
    );
  }

  const copyQuizLink = async (quizId: string) => {
    const link = `${window.location.origin}/quiz/${quizId}`;
    try {
      await copyText(link);
      toast.success('Link copied', 'Quiz link copied.');
    } catch {
      toast.error('Copy failed', `Could not copy link. ${link}`);
    }
  };

  const toggleQuizActive = async (quiz: SharedQuiz) => {
    try {
      await updateDoc(doc(db, 'quizzes', quiz.id), {
        isActive: !quiz.isActive,
        updatedAt: new Date().toISOString()
      });
    } catch (err: any) {
      toast.error('Update failed', err?.message || 'Failed to update quiz status.');
    }
  };

  const removeQuiz = async (quiz: SharedQuiz) => {
    const confirmed = await confirmDialog({
      title: 'Delete quiz?',
      message: `Delete quiz "${quiz.name}"?`,
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;
    try {
      await deleteDoc(doc(db, 'quizzes', quiz.id));
    } catch (err: any) {
      toast.error('Delete failed', err?.message || 'Failed to delete quiz.');
    }
  };

  const recipientsForClass = (classId: string, targetIds?: string[]) => {
    const classRows = classEnrollments.filter((row) => row.courseId === classId);
    if (!targetIds || targetIds.length === 0) return classRows.map((row) => row.userId);
    return classRows.filter((row) => targetIds.includes(row.userId)).map((row) => row.userId);
  };

  const markNotificationRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), {
        isRead: true,
        readAt: new Date().toISOString()
      });
    } catch {
      // Ignore transient notification read errors.
    }
  };

  const markAllNotificationsRead = async () => {
    await Promise.all(
      notifications
        .filter((item) => !item.isRead)
        .map((item) => markNotificationRead(item.id))
    );
  };

  const toggleNotificationPreference = async (type: NotificationType, key: 'inApp' | 'push' | 'email') => {
    const match = notificationPreferences.find((item) => item.notificationType === type);
    if (!match) return;
    try {
      await updateDoc(doc(db, 'notificationPreferences', match.id), {
        [key]: !match[key]
      });
    } catch {
      toast.error('Update failed', 'Could not update notification preferences.');
    }
  };

  const markAnnouncementRead = async (announcementId: string) => {
    if (isTeacher) return;
    const existing = announcementReads.find((item) => item.announcementId === announcementId && item.userId === user.id);
    if (existing) return;
    try {
      await setDoc(doc(db, 'announcementReads', buildAnnouncementReadId(announcementId, user.id)), {
        announcementId,
        userId: user.id,
        readAt: new Date().toISOString()
      });
    } catch {
      // Ignore read receipt failures.
    }
  };

  const saveAnnouncement = async (payload: {
    classId: string;
    classTitle: string;
    title: string;
    body: string;
    targetAudience: 'all' | 'group' | 'individual';
    targetIds: string[];
    isPinned: boolean;
    scheduledAt?: string;
    attachments: string[];
  }) => {
    try {
      const now = new Date().toISOString();
      const published = !payload.scheduledAt || Date.parse(payload.scheduledAt) <= Date.now();
      const base = {
        classId: payload.classId,
        classTitle: payload.classTitle,
        authorId: user.id,
        authorName: user.name,
        title: payload.title,
        body: sanitizeRichText(payload.body),
        bodyPreview: getBodyPreview(payload.body),
        targetAudience: payload.targetAudience,
        targetIds: payload.targetIds,
        isPinned: payload.isPinned,
        attachments: payload.attachments,
        scheduledAt: payload.scheduledAt || '',
        published,
        publishedAt: published ? now : '',
        createdAt: selectedAnnouncement?.createdAt || now,
        updatedAt: now,
        editedAt: selectedAnnouncement && selectedAnnouncement.published ? now : ''
      };

      if (selectedAnnouncement) {
        await updateDoc(doc(db, 'announcements', selectedAnnouncement.id), base);
      } else {
        await addDoc(collection(db, 'announcements'), base);
      }

      if (published) {
        const recipients = recipientsForClass(payload.classId, payload.targetAudience === 'all' ? undefined : payload.targetIds);
        await notify(recipients, 'announcement_posted', payload.title, getBodyPreview(payload.body, 120), {
          classId: payload.classId,
          type: 'announcement'
        });
      }

      setShowAnnouncementComposer(false);
      setSelectedAnnouncement(null);
      toast.success('Announcement saved', 'Your class notice has been saved.');
    } catch (err: any) {
      toast.error('Save failed', err?.message || 'Could not save announcement.');
    }
  };

  const deleteAnnouncement = async (announcement: Announcement) => {
    const confirmed = await confirmDialog({
      title: 'Delete announcement?',
      message: `Delete "${announcement.title}"?`,
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;
    try {
      await deleteDoc(doc(db, 'announcements', announcement.id));
      toast.success('Deleted', 'Announcement removed.');
    } catch {
      toast.error('Delete failed', 'Could not delete announcement.');
    }
  };

  const saveSession = async (payload: {
    classId: string;
    classTitle: string;
    title: string;
    description?: string;
    location?: string;
    lessonPlan?: string;
    startTime: string;
    endTime: string;
    recurrence: 'none' | 'weekly' | 'custom';
    recurrenceDays: number[];
    recurrenceEndDate?: string;
    color: string;
  }) => {
    if (!payload.startTime || !payload.endTime) {
      toast.warning('Missing time', 'Choose a valid date and time.');
      return;
    }
    if (Date.parse(payload.endTime) <= Date.parse(payload.startTime)) {
      toast.warning('Invalid time', 'End time must be after start time.');
      return;
    }
    const conflicting = scheduleSessions.find((item) => item.teacherId === user.id && item.id !== selectedSession?.id && overlaps(item.startTime, item.endTime, payload.startTime, payload.endTime));
    if (conflicting) {
      toast.error('Conflict detected', `This overlaps with "${conflicting.title}".`);
      return;
    }
    const now = new Date().toISOString();
    const nextData = {
      classId: payload.classId,
      classTitle: payload.classTitle,
      teacherId: user.id,
      teacherName: user.name,
      title: payload.title,
      description: payload.description || '',
      location: payload.location || '',
      lessonPlan: payload.lessonPlan || '',
      startTime: payload.startTime,
      endTime: payload.endTime,
      recurrence: payload.recurrence,
      recurrenceDays: payload.recurrenceDays,
      recurrenceEndDate: payload.recurrenceEndDate || '',
      color: payload.color,
      isCancelled: false,
      cancelledOccurrences: selectedSession?.cancelledOccurrences || [],
      createdAt: selectedSession?.createdAt || now,
      updatedAt: now
    };
    try {
      if (selectedSession) {
        await updateDoc(doc(db, 'classSessions', selectedSession.id), nextData);
      } else {
        await addDoc(collection(db, 'classSessions'), nextData);
      }
      const recipients = recipientsForClass(payload.classId);
      await notify(recipients, 'schedule_updated', payload.title, `Schedule updated for ${payload.classTitle}`, {
        classId: payload.classId,
        startTime: payload.startTime
      });
      setShowSessionModal(false);
      setSelectedSession(null);
      toast.success('Session saved', 'Class schedule updated.');
    } catch (err: any) {
      toast.error('Save failed', err?.message || 'Could not save session.');
    }
  };

  const deleteSession = async (session: ClassSession, mode: 'single' | 'all' = 'all') => {
    const confirmed = await confirmDialog({
      title: mode === 'all' ? 'Delete session series?' : 'Cancel this occurrence?',
      message: mode === 'all' ? `Delete "${session.title}" and all recurrences?` : `Cancel one occurrence of "${session.title}"?`,
      confirmText: mode === 'all' ? 'Delete' : 'Cancel occurrence',
      variant: 'danger'
    });
    if (!confirmed) return;
    try {
      if (mode === 'all' || session.recurrence === 'none') {
        await deleteDoc(doc(db, 'classSessions', session.id));
      } else {
        const dayKey = new Date(session.startTime).toISOString().slice(0, 10);
        await updateDoc(doc(db, 'classSessions', session.id), {
          cancelledOccurrences: Array.from(new Set([...(session.cancelledOccurrences || []), dayKey])),
          updatedAt: new Date().toISOString()
        });
      }
      toast.success('Schedule updated', 'Session updated successfully.');
    } catch {
      toast.error('Delete failed', 'Could not update this session.');
    }
  };

  const handleProfilePhotoUpload = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.warning('Invalid file', 'Please upload an image file.');
      return;
    }
    if (file.size > 1024 * 1024) {
      toast.warning('Image too large', 'Please use an image smaller than 1MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const next = String(reader.result || '');
      if (!next) return;
      setProfileAvatarUrl(next);
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = async () => {
    const nextName = profileName.trim();
    if (!nextName) {
      toast.warning('Missing name', 'Name cannot be empty.');
      return;
    }
    setIsSavingProfile(true);
    try {
      const now = new Date().toISOString();
      const patch = {
        name: nextName,
        title: profileTitle.trim(),
        avatarUrl: profileAvatarUrl.trim()
      };
      await updateDoc(doc(db, 'users', user.id), patch);
      await setDoc(doc(db, 'communityProfiles', user.id), {
        userId: user.id,
        displayName: nextName,
        title: profileTitle.trim(),
        avatarUrl: profileAvatarUrl.trim(),
        lastActiveAt: now
      }, { merge: true });
      onUserProfileUpdate?.(patch);
      toast.success('Profile updated', 'Your profile changes were saved.');
    } catch (err: any) {
      toast.error('Save failed', err?.message || 'Could not update profile.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const getTestBundles = (test: MockTest): CsvQuestionBundle[] => {
    if (!Array.isArray(test.csvBundles)) return [];
    return test.csvBundles.filter(bundle => Array.isArray(bundle.questionIds) && bundle.questionIds.length > 0);
  };

  const isBundledCsvDynamicTest = (test: MockTest) => {
    return (test.generationMode || 'fixed') === 'csv-dynamic' && getTestBundles(test).length > 0;
  };

  const startBundleTest = (test: MockTest, bundle: CsvQuestionBundle) => {
    if (!test.sections?.length) return;
    const baseSection = test.sections[0];
    const maxFromBundle = bundle.questionIds.length;
    const targetCount = Math.max(1, Number(baseSection.questionCount || maxFromBundle) || maxFromBundle);
    const sectionForBundle = {
      ...baseSection,
      name: `${baseSection.name} - ${bundle.name}`,
      questionIds: bundle.questionIds,
      questionCount: Math.min(targetCount, maxFromBundle)
    };
    onStartTest({
      ...test,
      name: `${test.name} - ${bundle.name}`,
      sections: [sectionForBundle]
    });
  };

  const startBundleInQuizMode = (test: MockTest, bundle: CsvQuestionBundle) => {
    if (!test.sections?.length) return;
    const baseSection = test.sections[0];
    const maxFromBundle = bundle.questionIds.length;
    const targetCount = Math.max(1, Number(baseSection.questionCount || maxFromBundle) || maxFromBundle);
    const sectionForBundle = {
      ...baseSection,
      name: `${baseSection.name} - ${bundle.name}`,
      questionIds: bundle.questionIds,
      questionCount: Math.min(targetCount, maxFromBundle)
    };
    onStartTest({
      ...test,
      name: `${test.name} - ${bundle.name}`,
      sections: [sectionForBundle]
    }, { quizMode: true });
  };

  const createFolder = () => {
    const name = newFolderName.trim();
    if (!name) {
      toast.warning('Missing folder name', 'Enter a folder name.');
      return;
    }
    if (testFolders.length >= MAX_TEST_FOLDERS) {
      toast.warning('Folder limit reached', `You can only create up to ${MAX_TEST_FOLDERS} folders.`);
      return;
    }
    const normalized = name.toLowerCase();
    if (testFolders.some(folder => folder.name.toLowerCase() === normalized)) {
      toast.warning('Duplicate folder', 'A folder with this name already exists.');
      return;
    }
    const id = `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setTestFolders(prev => [...prev, { id, name }]);
    setNewFolderName('');
  };

  const removeFolder = (folderId: string) => {
    confirmDialog({
      title: 'Remove folder?',
      message: 'Remove this folder? Tests in it will become unfiled.',
      confirmText: 'Remove',
      variant: 'danger'
    }).then((ok) => {
      if (!ok) return;
      setTestFolders(prev => prev.filter(folder => folder.id !== folderId));
      setTestFolderAssignments(prev => {
        const next: Record<string, string> = {};
        Object.entries(prev).forEach(([testId, assignedFolderId]) => {
          if (assignedFolderId !== folderId) next[testId] = assignedFolderId;
        });
        return next;
      });
      if (selectedFolderId === folderId) {
        setSelectedFolderId('all');
      }
    });
  };

  const assignTestFolder = (testId: string, folderId: string) => {
    setTestFolderAssignments(prev => {
      const next = { ...prev };
      if (!folderId) {
        delete next[testId];
      } else {
        next[testId] = folderId;
      }
      return next;
    });
  };

  const activeFolderIds = new Set(testFolders.map(folder => folder.id));
  const viewableTests = tests
    .filter(test => {
      const folderId = testFolderAssignments[test.id];
      const isArchived = Boolean(test.isArchived);
      if (selectedFolderId === 'archived') return isArchived;
      if (isArchived) return false;
      if (selectedFolderId === 'all') return true;
      if (selectedFolderId === 'unfiled') return !folderId || !activeFolderIds.has(folderId);
      return folderId === selectedFolderId;
    })
    .sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      if (sortMode === 'duration') return (a.totalDurationSeconds || 0) - (b.totalDurationSeconds || 0);
      if (sortMode === 'attempts') return (testCounts[b.id] || 0) - (testCounts[a.id] || 0);
      return parseIsoDate(((b as any).updatedAt || b.createdAt)) - parseIsoDate(((a as any).updatedAt || a.createdAt));
    });

  const navTabs: Array<{ id: MainTab; label: string }> = [
    { id: 'home', label: 'Home' },
    ...(prepFeatures.attendance ? [{ id: 'announcements' as MainTab, label: 'Announcements' }] : []),
    ...(prepFeatures.attendance ? [{ id: 'schedule' as MainTab, label: 'Schedule' }] : []),
    ...(prepFeatures.community ? [{ id: 'community' as MainTab, label: 'Community' }] : []),
    ...(prepFeatures.videos ? [{ id: 'videos' as MainTab, label: 'Videos' }] : []),
    { id: 'ranks', label: 'Ranks' },
    { id: 'create', label: 'Create' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'profile', label: 'Profile' }
  ];
  const mobileNavTabs = navTabs.filter((tab) => tab.id !== 'ranks');

  useEffect(() => {
    if (!navTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab('home');
    }
  }, [activeTab, navTabs]);

  const renderTabIcon = (tabId: MainTab) => {
    if (tabId === 'home') {
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 10.5L12 3l9 7.5" />
          <path d="M5.5 9.5V20h13V9.5" />
        </svg>
      );
    }
    if (tabId === 'ranks') {
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 20h16" />
          <rect x="6" y="11" width="3" height="7" />
          <rect x="11" y="7" width="3" height="11" />
          <rect x="16" y="4" width="3" height="14" />
        </svg>
      );
    }
    if (tabId === 'announcements') {
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16v10H7l-3 3V6z" />
          <path d="M8 10h8" />
          <path d="M8 13h5" />
        </svg>
      );
    }
    if (tabId === 'schedule') {
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
      );
    }
    if (tabId === 'community') {
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 10h8" />
          <path d="M8 14h5" />
          <path d="M5 19l1.5-3H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-8L5 19z" />
        </svg>
      );
    }
    if (tabId === 'videos') {
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M10 9l5 3-5 3V9z" />
        </svg>
      );
    }
    if (tabId === 'create') {
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    }
    if (tabId === 'reviews') {
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 5h14v14H5z" />
          <path d="M8 9h8M8 12h8M8 15h5" />
        </svg>
      );
    }
    if (tabId === 'settings') {
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z" />
          <path d="M19.4 15a1 1 0 00.2 1.1l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1 1 0 00-1.1-.2 1 1 0 00-.6.9V20a2 2 0 01-4 0v-.2a1 1 0 00-.6-.9 1 1 0 00-1.1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1 1 0 00.2-1.1 1 1 0 00-.9-.6H4a2 2 0 010-4h.2a1 1 0 00.9-.6 1 1 0 00-.2-1.1l-.1-.1a2 2 0 112.8-2.8l.1.1a1 1 0 001.1.2h.1a1 1 0 00.6-.9V4a2 2 0 014 0v.2a1 1 0 00.6.9 1 1 0 001.1-.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1 1 0 00-.2 1.1v.1a1 1 0 00.9.6H20a2 2 0 010 4h-.2a1 1 0 00-.9.6z" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4 20c1.8-3.2 5-5 8-5s6.2 1.8 8 5" />
      </svg>
    );
  };

  return (
    <div className={`v2-page v3-mobile-shell ui-mode-${currentUiMode} flex-1 w-full bg-slate-50 overflow-hidden min-h-0 relative shell md:grid md:grid-cols-[72px_1fr]`}>
      <aside className="sidebar hidden md:flex flex-col items-center justify-between py-5 px-3 bg-[var(--surface)] border-r border-[var(--edge)] sticky top-0 h-screen">
        <div className="w-10 h-10 rounded-xl bg-[var(--gold)] text-[var(--ink)] font-display text-lg font-black flex items-center justify-center shadow-[var(--shadow-gold)]">A</div>
        <div className="flex flex-col gap-3">
          {navTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
              aria-label={tab.label}
              className={`w-11 h-11 min-h-[44px] rounded-xl border ${activeTab === tab.id ? 'bg-[var(--gold-dim)] text-[var(--gold)] border-[var(--gold)]' : 'bg-transparent text-[var(--muted)] border-[var(--edge)] hover:bg-[var(--panel)]'}`}
            >
              <span className="inline-flex items-center justify-center">{renderTabIcon(tab.id)}</span>
            </button>
          ))}
        </div>
        <button onClick={onLogout} title="Log Out" aria-label="Log Out" className="w-11 h-11 min-h-[44px] rounded-xl border border-[var(--edge)] text-[var(--rose)] hover:bg-[var(--rose-dim)] inline-flex items-center justify-center">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 17l5-5-5-5" />
            <path d="M20 12H9" />
            <path d="M11 4H6a2 2 0 00-2 2v12a2 2 0 002 2h5" />
          </svg>
        </button>
      </aside>
      <div className="flex flex-col min-h-0 overflow-hidden">
      <div className="v2-shell v3-topbar topbar bg-slate-950 py-[14px] px-[18px] md:px-8 flex justify-between items-center shrink-0 border-b border-slate-900 shadow-xl z-50 safe-top sticky top-0">
         <div>
           <p className="text-xs text-amber-500 uppercase tracking-widest font-semibold">Learning Portal</p>
           <h1 className="font-display text-lg font-bold text-slate-100">{isTeacher ? 'Classboard Dashboard' : 'Student Dashboard'}</h1>
         </div>
         <div className="flex items-center gap-3">
           <NotificationBell items={notifications} onMarkRead={markNotificationRead} onMarkAllRead={markAllNotificationsRead} />
           <div className="connection-badge">
             <span className="connection-dot"></span>
             <span className="hidden md:inline">Connection Stable</span>
           </div>
           <button
             type="button"
             onClick={() => setActiveTab('profile')}
             title="Open Profile"
             aria-label="Open Profile"
             className="w-9 h-9 rounded-full bg-[var(--panel-2)] border border-[var(--edge)] text-xs font-bold flex items-center justify-center text-[var(--gold)] overflow-hidden"
           >
             {user.avatarUrl ? (
               <img src={user.avatarUrl} alt="Profile" className="w-full h-full rounded-full object-cover" />
             ) : (
               String(user.name || 'U').slice(0, 2).toUpperCase()
             )}
           </button>
         </div>
      </div>

      {showDailyFact && dailyFact && (
        <div className="sticky top-[72px] z-40 px-4 md:px-6 pt-3">
          <div className="mx-auto max-w-6xl rounded-[1.75rem] border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-sky-50 shadow-sm">
            <div className="flex items-start gap-3 px-4 py-4 md:px-6 md:py-5">
              <div className="shrink-0 w-11 h-11 rounded-2xl bg-amber-500 text-slate-950 flex items-center justify-center font-black shadow-sm">F</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-700">Fact of the Day</p>
                  <span className="px-2 py-1 rounded-full bg-slate-950 text-[10px] font-black uppercase tracking-widest text-amber-400">{dailyFactBadge}</span>
                  <span className="px-2 py-1 rounded-full bg-white border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">{dailyFact.difficulty}</span>
                </div>
                <p className="text-sm md:text-[15px] leading-relaxed text-slate-700">{dailyFact.text}</p>
                {dailyFact.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {dailyFact.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="px-2 py-1 rounded-full bg-white border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={dismissDailyFact}
                aria-label="Dismiss fact of the day"
                className="shrink-0 w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:border-slate-300"
              >
                <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {errors && (
        <div className="mx-6 mt-6 p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 font-bold text-xs uppercase tracking-widest">
          {errors}
        </div>
      )}

      {isReadOnly && (
        <div className="mx-6 mt-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-700 font-bold text-xs uppercase tracking-widest">
          License required. You can browse the app, but actions are disabled until activation.{deadlineLabel ? ` Deadline passed: ${deadlineLabel}.` : ''}
        </div>
      )}
      {lowDataMode && (
        <div className="mx-6 mt-6 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-700 font-bold text-xs uppercase tracking-widest">
          Low-data mode is ON. Reduced sync and lighter queries are active.
        </div>
      )}

      {showLeaderboard && <LeaderboardModal test={showLeaderboard} onClose={() => setShowLeaderboard(null)} />}

      <div className="flex-1 v2-scroll p-4 md:p-12 pb-[110px] md:pb-24 safe-bottom">
        <div className="max-w-6xl mx-auto">
          <div className="v3-hero-strip flex flex-col lg:flex-row justify-between items-center mb-6 gap-4 bg-white p-5 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
            <div className="flex items-center gap-6">
              <img src={logo} alt="Scholar! logo" className="w-16 h-16" />
              <div>
                <h1 className="text-2xl font-bold text-slate-950 uppercase tracking-tight leading-none">Student Dashboard</h1>
                <p className="text-amber-600 text-xs font-black uppercase mt-1">{PREP_MODE_LABELS[prepMode]}</p>
                <PartnershipLogos className="mt-2 items-start" size="compact" />
              </div>
            </div>
            <button
              onClick={onSwitchPrepMode}
              className="px-6 py-3 text-xs font-black text-slate-700 bg-slate-50 border border-slate-200 rounded-2xl hover:bg-slate-100 uppercase tracking-widest shadow-sm"
            >
              Switch Prep
            </button>
            {(user.role === 'admin' || user.role === 'root-admin') && onReturnToAdmin && (
              <button onClick={onReturnToAdmin} className="px-10 py-4 text-xs font-black text-amber-600 bg-amber-50 border border-amber-100 rounded-2xl hover:bg-amber-100 uppercase tracking-widest shadow-sm">Staff Settings</button>
            )}
            <button
              onClick={() => setActiveTab('reviews')}
              className="px-6 py-3 text-xs font-black text-sky-700 bg-sky-50 border border-sky-100 rounded-2xl hover:bg-sky-100 uppercase tracking-widest shadow-sm"
            >
              Open Reviews
            </button>
            {onOpenCourses && prepFeatures.courses && (
              <button
                onClick={onOpenCourses}
                className="px-6 py-3 text-xs font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-2xl hover:bg-emerald-100 uppercase tracking-widest shadow-sm"
              >
                Open Courses
              </button>
            )}
            {onOpenVideos && prepFeatures.videos && (
              <button
                onClick={onOpenVideos}
                className="px-6 py-3 text-xs font-black text-violet-700 bg-violet-50 border border-violet-100 rounded-2xl hover:bg-violet-100 uppercase tracking-widest shadow-sm"
              >
                Watch Videos
              </button>
            )}
          </div>

          <div className="mb-8 bg-white rounded-2xl border border-slate-100 p-2 hidden md:inline-flex gap-2">
            {navTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest ${activeTab === tab.id ? 'bg-slate-950 text-amber-500' : 'text-slate-500 bg-slate-50'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'home' && (
            <div className="space-y-6">
              <section className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm">
                <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 mb-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">Test Folders</p>
                    <h3 className="text-lg font-bold text-slate-900">Focused Sorting</h3>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="New folder name"
                      className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                    />
                    <button
                      type="button"
                      onClick={createFolder}
                      disabled={testFolders.length >= MAX_TEST_FOLDERS}
                      className="px-4 py-3 bg-slate-900 text-amber-500 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-40"
                    >
                      Add Folder ({testFolders.length}/{MAX_TEST_FOLDERS})
                    </button>
                  </div>
                </div>
                <div className="v3-filter-scroll flex gap-2 mb-4 overflow-x-auto no-scrollbar whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId('all')}
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${selectedFolderId === 'all' ? 'bg-slate-900 text-amber-500' : 'bg-slate-100 text-slate-600'}`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId('unfiled')}
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${selectedFolderId === 'unfiled' ? 'bg-slate-900 text-amber-500' : 'bg-slate-100 text-slate-600'}`}
                  >
                    Unfiled
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId('archived')}
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${selectedFolderId === 'archived' ? 'bg-slate-900 text-amber-500' : 'bg-slate-100 text-slate-600'}`}
                  >
                    Archived Tests
                  </button>
                  {testFolders.map(folder => (
                    <div key={folder.id} className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl pr-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSelectedFolderId(folder.id)}
                        className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${selectedFolderId === folder.id ? 'bg-slate-900 text-amber-500' : 'text-slate-700'}`}
                      >
                        {folder.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFolder(folder.id)}
                        className="px-2 py-2 text-xs font-black text-red-500 uppercase"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <p className="text-xs font-black uppercase tracking-widest text-slate-500">Sort by:</p>
                  <div className="v3-sort-scroll flex gap-2 overflow-x-auto no-scrollbar whitespace-nowrap">
                    {[
                      { key: 'updated', label: 'Latest' },
                      { key: 'name', label: 'Name' },
                      { key: 'duration', label: 'Duration' },
                      { key: 'attempts', label: 'Popularity' }
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setSortMode(item.key as TestSortMode)}
                        className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${sortMode === item.key ? 'bg-amber-500 text-slate-950' : 'bg-slate-100 text-slate-600'}`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
              <div className="v3-layout-split grid grid-cols-1 xl:grid-cols-3 gap-10">
              <div className="xl:col-span-2 space-y-10">
                <section>
                  <div className="flex items-center justify-between mb-8">
                    <h2 className="text-xl font-bold text-slate-950 uppercase">{selectedFolderId === 'archived' ? 'Archived Tests' : 'Active Tests'}</h2>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">{viewableTests.length} visible</p>
                  </div>
                  <div className="v3-test-grid grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {viewableTests.map(test => (
                      (() => {
                        const attempts = history.filter(h => h.testId === test.id).length;
                        const maxAttempts = test.maxAttempts ?? null;
                        const retakeBlocked = !test.allowRetake && attempts >= 1;
                        const attemptsBlocked = maxAttempts !== null && maxAttempts > 0 && attempts >= maxAttempts;
                        const isBlocked = retakeBlocked || attemptsBlocked || isReadOnly;
                        const bundles = getTestBundles(test);
                        const hasBundles = isBundledCsvDynamicTest(test);
                        return (
                      <div key={test.id} className={`bg-white p-[18px] sm:p-8 rounded-[2.5rem] shadow-sm border transition-all flex flex-col h-full group min-w-0 ${isReadOnly ? 'border-slate-100 opacity-60' : 'border-slate-100 hover:border-amber-400'}`}>
                        <div className="flex justify-between items-start mb-4 min-w-0">
                          <h3 className="font-bold text-xl text-slate-950 uppercase truncate leading-tight mr-2 min-w-0">{test.name}</h3>
                          <span className="bg-slate-50 text-slate-500 text-xs font-black px-3 py-1.5 rounded-lg uppercase whitespace-nowrap">{test.totalDurationSeconds / 60}m</span>
                        </div>
                        <p className="text-xs text-slate-400 mb-6 font-medium italic line-clamp-3 leading-relaxed">{test.description || 'Start this test.'}</p>
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">
                          Taken by {testCounts[test.id] ?? 0} people
                        </div>
                        <div className="flex flex-wrap gap-2 mb-4">
                          {test.accessPassword && (
                            <span className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest bg-indigo-50 text-indigo-700 border border-indigo-100">
                              Password Required
                            </span>
                          )}
                          {test.isArchived && (
                            <span className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest bg-slate-100 text-slate-700 border border-slate-200">
                              Archived
                            </span>
                          )}
                        </div>
                        <div className="mb-4">
                          <label className="text-xs font-black uppercase tracking-widest text-slate-500 block mb-2">Folder</label>
                          <select
                            value={testFolderAssignments[test.id] || ''}
                            onChange={(e) => assignTestFolder(test.id, e.target.value)}
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold uppercase text-slate-700"
                          >
                            <option value="">Unfiled</option>
                            {testFolders.map(folder => (
                              <option key={folder.id} value={folder.id}>{folder.name}</option>
                            ))}
                          </select>
                        </div>
                        {hasBundles && (
                          <div className="mb-4 p-4 rounded-xl border border-sky-100 bg-sky-50">
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <p className="text-xs font-bold uppercase tracking-widest text-sky-700">
                                Test Bundles ({bundles.length})
                              </p>
                              <button
                                disabled={isBlocked}
                                onClick={() => setExpandedBundleTestId(prev => prev === test.id ? null : test.id)}
                                className="disabled:opacity-40 px-3 py-1.5 bg-white border border-sky-200 rounded-lg text-xs font-bold uppercase tracking-widest text-sky-700 hover:bg-sky-100"
                              >
                                {expandedBundleTestId === test.id ? 'Hide' : 'Open'}
                              </button>
                            </div>
                            {expandedBundleTestId === test.id && (
                              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                {bundles.map((bundle) => (
                                  <div key={bundle.id} className="p-3 rounded-lg bg-white border border-sky-100 flex items-center justify-between gap-2">
                                    <div>
                                      <p className="text-xs font-bold uppercase text-slate-800">{bundle.name}</p>
                                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                        {bundle.categoryField}: {bundle.category}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        disabled={isBlocked}
                                        onClick={() => startBundleTest(test, bundle)}
                                        className="disabled:opacity-40 px-3 py-2 bg-amber-500 text-slate-950 rounded-lg text-xs font-bold uppercase tracking-widest whitespace-nowrap"
                                      >
                                        Start
                                      </button>
                                      {attempts >= 1 && (
                                        <button
                                          disabled={isReadOnly}
                                          onClick={() => startBundleInQuizMode(test, bundle)}
                                          className="disabled:opacity-40 px-3 py-2 bg-slate-900 text-amber-500 rounded-lg text-xs font-bold uppercase tracking-widest whitespace-nowrap"
                                        >
                                          Quiz Mode
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="mt-auto flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <button disabled={isReadOnly || lowDataMode} onClick={() => setShowLeaderboard(test)} className="v3-card-action disabled:opacity-40 text-xs font-bold text-amber-600 uppercase tracking-widest hover:underline flex items-center gap-1">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>Leaderboard
                            </button>
                            <button disabled={isReadOnly} onClick={() => copyTestLink(test)} className="v3-card-action disabled:opacity-40 px-3 py-2 bg-emerald-50 rounded-xl text-xs font-bold uppercase tracking-widest text-emerald-700 hover:bg-emerald-100">
                              Copy Link
                            </button>
                            <button disabled={isReadOnly} onClick={() => onSaveOfflineTest && onSaveOfflineTest(test)} className="v3-card-action disabled:opacity-40 px-3 py-2 bg-sky-50 rounded-xl text-xs font-bold uppercase tracking-widest text-sky-700 hover:bg-sky-100">
                              Save Offline
                            </button>
                          </div>
                          {!hasBundles && (
                            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                              {attempts >= 1 && (
                                <button
                                  onClick={() => onStartTest(test, { quizMode: true })}
                                  disabled={isReadOnly}
                                  className="v3-card-action px-5 py-3 bg-slate-900 text-amber-500 rounded-xl font-bold uppercase tracking-widest text-xs shadow-lg active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap text-center"
                                >
                                  Quiz Mode
                                </button>
                              )}
                              <button onClick={() => onStartTest(test)} disabled={isBlocked} className="v3-card-action px-8 py-3 bg-amber-500 text-slate-950 rounded-xl font-bold uppercase tracking-widest text-xs shadow-lg active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap text-center">
                              {isReadOnly ? 'Activate First' : isBlocked ? 'Not Available' : 'Start Test'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                        );
                      })()
                    ))}
                    {viewableTests.length === 0 && (
                      <div className="col-span-full py-16 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
                        <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                          {selectedFolderId === 'archived' ? 'No archived tests available.' : 'No tests in this folder.'}
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <aside className={`hidden xl:block bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 h-fit sticky top-12 transition-all ${isReadOnly ? 'opacity-60' : ''}`}>
                <h2 className="text-lg font-bold mb-5 text-slate-950 uppercase text-center">Quick Actions</h2>
                <div className="space-y-3">
                  <button
                    onClick={() => setActiveTab('reviews')}
                    className="w-full py-4 bg-sky-50 border border-sky-100 text-sky-700 rounded-2xl text-xs font-black uppercase tracking-widest"
                  >
                    Go To Reviews
                  </button>
                  <button
                    onClick={() => setActiveTab('profile')}
                    className="w-full py-4 bg-slate-50 border border-slate-200 text-slate-700 rounded-2xl text-xs font-black uppercase tracking-widest"
                  >
                    Edit Profile
                  </button>
                  {onOpenCourses && prepFeatures.courses && (
                    <button
                      onClick={onOpenCourses}
                      className="w-full py-4 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-2xl text-xs font-black uppercase tracking-widest"
                    >
                      Open Courses
                    </button>
                  )}
                  {onOpenVideos && prepFeatures.videos && (
                    <button
                      onClick={onOpenVideos}
                      className="w-full py-4 bg-violet-50 border border-violet-100 text-violet-700 rounded-2xl text-xs font-black uppercase tracking-widest"
                    >
                      Watch Videos
                    </button>
                  )}
                </div>
              </aside>
            </div>
            </div>
          )}

          {activeTab === 'announcements' && (
            <div className="space-y-6">
              <section className="bg-white rounded-[2rem] border border-slate-100 p-6 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-500">Announcements</p>
                  <h2 className="text-lg font-black uppercase text-slate-950">Class-wide notices and read receipts</h2>
                </div>
                {isTeacher && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAnnouncement(null);
                      setShowAnnouncementComposer(true);
                    }}
                    className="px-5 py-3 rounded-2xl bg-slate-950 text-amber-500 text-xs font-black uppercase tracking-widest"
                  >
                    New Announcement
                  </button>
                )}
              </section>
              <AnnouncementFeed
                user={user}
                items={announcements}
                unreadIds={unreadAnnouncementIds}
                readCounts={readCountsByAnnouncement}
                totalRecipientsByAnnouncement={totalRecipientsByAnnouncement}
                onMarkRead={markAnnouncementRead}
                onEdit={(announcement) => {
                  setSelectedAnnouncement(announcement);
                  setShowAnnouncementComposer(true);
                }}
                onDelete={(announcement) => void deleteAnnouncement(announcement)}
              />
            </div>
          )}

          {activeTab === 'schedule' && (
            <div className="space-y-6">
              <ClassCalendar
                user={user}
                sessions={scheduleSessions}
                canEdit={isTeacher}
                onNewSession={() => {
                  setSelectedSession(null);
                  setShowSessionModal(true);
                }}
                onSelectSession={(session) => {
                  setSelectedSession(session);
                  setShowSessionModal(true);
                }}
              />
              {selectedSession && (
                <section className="bg-white rounded-[2rem] border border-slate-100 p-6 shadow-sm">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-slate-500">{selectedSession.classTitle}</p>
                      <h3 className="text-lg font-black uppercase text-slate-950">{selectedSession.title}</h3>
                      <p className="mt-2 text-sm text-slate-600">
                        {selectedSession.description || 'No session description provided.'}
                      </p>
                      <p className="mt-3 text-xs font-black uppercase tracking-widest text-slate-400">
                        {new Date(selectedSession.startTime).toLocaleString()} - {new Date(selectedSession.endTime).toLocaleTimeString()}
                      </p>
                    </div>
                    {isTeacher && (
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setShowSessionModal(true)} className="px-4 py-3 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-widest text-slate-700">
                          Edit
                        </button>
                        <button type="button" onClick={() => void deleteSession(selectedSession, selectedSession.recurrence === 'none' ? 'all' : 'single')} className="px-4 py-3 rounded-xl border border-red-200 text-xs font-black uppercase tracking-widest text-red-600">
                          Cancel Once
                        </button>
                        <button type="button" onClick={() => void deleteSession(selectedSession, 'all')} className="px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-xs font-black uppercase tracking-widest text-red-700">
                          Delete Series
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === 'reviews' && (
            <div className="space-y-4">
              <section className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-950 uppercase">Review Attempts</h2>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">All your completed tests in one place</p>
                  </div>
                  <span className="text-xs font-black uppercase tracking-widest text-amber-700 bg-amber-50 px-3 py-1 rounded-full">
                    {history.length} attempt(s)
                  </span>
                </div>
                <div className="space-y-3 max-h-[65dvh] v2-scroll pr-1">
                  {history.map(item => (
                    <div key={item.id} className="p-4 rounded-xl border border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-black uppercase text-slate-900 truncate">{item.testName}</p>
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mt-1">
                          {new Date(item.completedAt).toLocaleDateString()} - {item.status}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-black text-slate-900 whitespace-nowrap">{Math.round((item.score / (item.maxScore || 1)) * 100)}%</span>
                        <button disabled={isReadOnly} onClick={() => onReviewResult(item)} className="disabled:opacity-40 px-4 py-2 bg-amber-50 border border-amber-100 text-amber-700 rounded-xl text-xs font-black uppercase tracking-widest">
                          Review
                        </button>
                      </div>
                    </div>
                  ))}
                  {history.length === 0 && (
                    <p className="py-16 text-center text-xs font-black uppercase tracking-widest text-slate-400">No attempts yet.</p>
                  )}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'create' && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
              <div className="xl:col-span-1">
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-xl space-y-6">
                  <h3 className="text-lg font-bold">Create Quiz</h3>
                  <input placeholder="Quiz name" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold" value={quizName} onChange={e => setQuizName(e.target.value)} />
                  <textarea placeholder="Quiz instructions" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs h-20" value={quizDescription} onChange={e => setQuizDescription(e.target.value)} />
                  <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                    <span className="text-xs font-bold uppercase text-slate-400">Time (mins)</span>
                    <input type="number" min={1} className="bg-transparent font-bold w-full text-center text-xl outline-none" value={quizDurationMins} onChange={e => setQuizDurationMins(Math.max(1, parseInt(e.target.value) || 1))} />
                  </div>
                  <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl">
                    <span className="text-xs font-bold uppercase text-slate-400">Allow Retake</span>
                    <button type="button" onClick={() => setQuizAllowRetake(!quizAllowRetake)} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest ${quizAllowRetake ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                      {quizAllowRetake ? 'Yes' : 'No'}
                    </button>
                  </div>
                  <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                    <span className="text-xs font-bold uppercase text-slate-400">Max Attempts</span>
                    <input
                      type="number"
                      min={1}
                      disabled={!quizAllowRetake}
                      className="bg-transparent font-bold w-full text-center text-xl outline-none disabled:text-slate-300"
                      value={quizMaxAttempts}
                      onChange={e => setQuizMaxAttempts(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="Unlimited"
                    />
                  </div>
                  <button onClick={publishQuiz} disabled={isPublishingQuiz || isReadOnly} className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-xs tracking-widest shadow-xl active:scale-95 transition-all disabled:opacity-40">
                    {isPublishingQuiz ? 'Publishing...' : 'Publish Quiz'}
                  </button>
                </div>
              </div>
              <div className="xl:col-span-2 space-y-4">
                <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-bold uppercase tracking-widest text-slate-900">My Created Quizzes</h4>
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-400">{myQuizzes.length} quiz(es)</span>
                  </div>
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {myQuizzes.map((quiz) => (
                      <div key={quiz.id} className="p-4 rounded-xl border border-slate-100 bg-slate-50 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{quiz.name}</p>
                          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                            {Math.round((quiz.totalDurationSeconds || 0) / 60)} mins - {quiz.questions?.length || 0} questions - {quiz.isActive ? 'active' : 'paused'}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => copyQuizLink(quiz.id)} className="px-3 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold uppercase tracking-widest">Copy Link</button>
                          <button onClick={() => toggleQuizActive(quiz)} className="px-3 py-2 bg-amber-50 text-amber-700 rounded-xl text-xs font-bold uppercase tracking-widest">
                            {quiz.isActive ? 'Pause' : 'Activate'}
                          </button>
                          <button onClick={() => removeQuiz(quiz)} className="px-3 py-2 bg-red-50 text-red-700 rounded-xl text-xs font-bold uppercase tracking-widest">Delete</button>
                        </div>
                      </div>
                    ))}
                    {myQuizzes.length === 0 && (
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">No quizzes created yet.</p>
                    )}
                  </div>
                </div>
                <div className="bg-slate-900 text-white p-6 rounded-[2rem] flex justify-between items-center shadow-lg">
                  <div>
                    <h4 className="text-sm font-bold uppercase tracking-widest text-amber-500">Manual Questions</h4>
                    <p className="text-xs text-slate-400 mt-1">These questions are private to this quiz link and are not added to the bank.</p>
                  </div>
                  <button onClick={addQuizQuestion} className="px-4 py-3 bg-amber-500 text-slate-950 rounded-xl text-xs font-bold uppercase tracking-widest">Add Question</button>
                </div>
                <div className="space-y-4">
                  {quizQuestions.map((q, qIdx) => (
                    <div key={q.id} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
                      <div className="flex justify-between items-center">
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Question {qIdx + 1}</p>
                        <button onClick={() => removeQuizQuestion(q.id)} disabled={quizQuestions.length <= 1} className="text-xs font-bold uppercase tracking-widest text-red-500 disabled:opacity-30">Remove</button>
                      </div>
                      <textarea
                        value={q.text}
                        onChange={(e) => updateQuizQuestion(q.id, prev => ({ ...prev, text: e.target.value }))}
                        className="w-full p-4 bg-slate-50 border rounded-2xl text-sm font-bold min-h-24"
                        placeholder="Enter question text"
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {q.options.map((opt, oIdx) => (
                          <input
                            key={`${q.id}_${oIdx}`}
                            value={opt}
                            onChange={(e) => updateQuizQuestion(q.id, prev => {
                              const next = [...prev.options];
                              next[oIdx] = e.target.value;
                              return { ...prev, options: next };
                            })}
                            className="w-full p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                            placeholder={`Option ${String.fromCharCode(65 + oIdx)}`}
                          />
                        ))}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="text-xs font-bold uppercase text-slate-400">
                          Correct Answer
                          <select
                            value={q.correctAnswerIndex}
                            onChange={(e) => updateQuizQuestion(q.id, prev => ({ ...prev, correctAnswerIndex: Number(e.target.value) }))}
                            className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                          >
                            <option value={0}>Option A</option>
                            <option value={1}>Option B</option>
                            <option value={2}>Option C</option>
                            <option value={3}>Option D</option>
                          </select>
                        </label>
                        <label className="text-xs font-bold uppercase text-slate-400">
                          Explanation (optional)
                          <input
                            value={q.explanation || ''}
                            onChange={(e) => updateQuizQuestion(q.id, prev => ({ ...prev, explanation: e.target.value }))}
                            className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs"
                            placeholder="Optional explanation"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'community' && (
            <CommunityHub user={user} isReadOnly={isReadOnly} onOpenSocialProfileSetup={onOpenSocialProfileSetup} />
          )}

          {activeTab === 'videos' && (
            <section className="bg-slate-950 rounded-[2rem] border border-slate-900 p-8 md:p-10 shadow-sm text-white overflow-hidden">
              <div className="max-w-2xl">
                <p className="text-xs font-black uppercase tracking-[0.3em] text-amber-400">Video Academy</p>
                <h2 className="mt-3 text-2xl md:text-4xl font-black tracking-tight">Continue learning with embedded lecture videos.</h2>
                <p className="mt-4 text-sm md:text-base leading-relaxed text-slate-300">
                  Watch published YouTube lectures inside the app, resume where you stopped, bookmark important lessons, and track completion across modules.
                </p>
                <button
                  type="button"
                  onClick={onOpenVideos}
                  disabled={!onOpenVideos}
                  className="mt-6 px-7 py-4 rounded-2xl bg-amber-400 text-slate-950 text-xs font-black uppercase tracking-widest disabled:opacity-40"
                >
                  Open Video Academy
                </button>
              </div>
            </section>
          )}

          {activeTab === 'ranks' && (
            <div className="space-y-4">
              <section className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-950 uppercase">Ranks</h2>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">Community performance leaderboard</p>
                  </div>
                  <span className="text-xs font-black uppercase tracking-widest text-amber-700 bg-amber-50 px-3 py-1 rounded-full">
                    Top {Math.max(rankRows.length, 0)}
                  </span>
                </div>
                {rankLoading ? (
                  <p className="py-16 text-center text-xs font-black uppercase tracking-widest text-slate-400">Loading ranks...</p>
                ) : rankError ? (
                  <p className="py-16 text-center text-xs font-black uppercase tracking-widest text-red-600">{rankError}</p>
                ) : rankRows.length === 0 ? (
                  <p className="py-16 text-center text-xs font-black uppercase tracking-widest text-slate-400">No rank data yet.</p>
                ) : (
                  <div className="space-y-2 max-h-[60dvh] v2-scroll pr-1">
                    {rankRows.map((row, idx) => (
                      <div key={row.userId} className={`rounded-2xl border px-4 py-3 flex items-center gap-3 ${row.userId === user.id ? 'border-amber-300 bg-amber-50' : 'border-slate-100 bg-slate-50'}`}>
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black ${idx < 3 ? 'bg-amber-500 text-slate-950' : 'bg-white text-slate-500 border border-slate-200'}`}>{row.rank}</div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black uppercase text-slate-900 truncate">{row.userName}{row.userId === user.id ? ' (You)' : ''}</p>
                          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{row.attempts} attempts</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-black text-slate-900">{Math.round(row.averagePercent)}%</p>
                          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Best {Math.round(row.bestPercent)}%</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950 uppercase mb-5">Profile</h2>
                <div className="space-y-4 text-sm">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center">
                      {profileAvatarUrl ? (
                        <img src={profileAvatarUrl} alt="Profile" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-slate-500 font-black">{String(profileName || user.name || 'U').slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                    <label className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest text-slate-700 cursor-pointer">
                      Upload Photo
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleProfilePhotoUpload(e.target.files?.[0] || null)}
                      />
                    </label>
                  </div>
                  <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
                    Full Name
                    <input
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="mt-2 w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold"
                    />
                  </label>
                  <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
                    Title
                    <input
                      value={profileTitle}
                      onChange={(e) => setProfileTitle(e.target.value)}
                      className="mt-2 w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold"
                      placeholder="e.g. Medical Student"
                    />
                  </label>
                  <div className="flex justify-between"><span className="text-slate-400">Email</span><span className="font-bold text-slate-900">{user.email}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Role</span><span className="font-bold uppercase text-slate-900">{user.role}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">License</span><span className="font-bold text-slate-900">{licenseStatusLabel}</span></div>
                </div>
                {onOpenSocialProfileSetup && prepFeatures.community ? (
                  <button onClick={onOpenSocialProfileSetup} className="mt-4 w-full py-4 bg-sky-50 border border-sky-100 text-sky-700 rounded-2xl text-xs font-black uppercase tracking-widest">
                    Edit Social Profile
                  </button>
                ) : null}
                <button
                  onClick={saveProfile}
                  disabled={isSavingProfile}
                  className="mt-6 w-full py-4 bg-slate-950 text-amber-500 rounded-2xl text-xs font-black uppercase tracking-widest disabled:opacity-40"
                >
                  {isSavingProfile ? 'Saving...' : 'Save Profile'}
                </button>
                <button onClick={onLogout} className="mt-6 w-full py-4 bg-red-50 border border-red-100 text-red-700 rounded-2xl text-xs font-black uppercase tracking-widest">
                  Sign Out
                </button>
              </section>
              <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950 uppercase mb-5">Quick Access</h2>
                <div className="space-y-3">
                  <button onClick={() => setActiveTab('reviews')} className="w-full py-4 bg-sky-50 border border-sky-100 text-sky-700 rounded-2xl text-xs font-black uppercase tracking-widest">
                    Open Reviews
                  </button>
                  <button onClick={() => setActiveTab('settings')} className="w-full py-4 bg-slate-50 border border-slate-200 text-slate-700 rounded-2xl text-xs font-black uppercase tracking-widest">
                    Open Settings
                  </button>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950 uppercase mb-5">Account</h2>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between"><span className="text-slate-400">Name</span><span className="font-bold text-slate-900">{user.name}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Email</span><span className="font-bold text-slate-900">{user.email}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Role</span><span className="font-bold uppercase text-slate-900">{user.role}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">License</span><span className="font-bold text-slate-900">{licenseStatusLabel}</span></div>
                </div>
              </section>

              <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950 uppercase mb-5">Activate</h2>
                <p className="text-xs text-slate-500 mb-5">Enter your license key to activate your account.</p>
                <div className="flex flex-col sm:flex-row gap-2 mb-3">
                  <input
                    value={activationInput}
                    onChange={(e) => setActivationInput(e.target.value.toUpperCase())}
                    placeholder="Enter activation key"
                    className="flex-1 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none uppercase"
                  />
                  <button
                    onClick={handleActivateFromSettings}
                    disabled={isActivatingLicense}
                    className="px-6 py-4 bg-slate-950 text-amber-500 rounded-2xl text-xs font-black uppercase tracking-widest disabled:opacity-40"
                  >
                    {isActivatingLicense ? 'Activating...' : 'Activate'}
                  </button>
                </div>
                <button
                  onClick={onOpenActivationSupport}
                  className="w-full py-3 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-2xl text-xs font-black uppercase tracking-widest"
                >
                  Contact Support on WhatsApp
                </button>
              </section>

              <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950 uppercase mb-5">Preferences</h2>
                <div className="space-y-3">
                  <div className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-2xl p-4">
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Email Alerts</span>
                    <button onClick={handleToggleNotifications} className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${notificationsEnabled ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-700'}`}>
                      {notificationsEnabled ? 'On' : 'Off'}
                    </button>
                  </div>
                  <div className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-2xl p-4">
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Low-data Mode</span>
                    <button onClick={handleToggleLowDataMode} className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${lowDataMode ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-700'}`}>
                      {lowDataMode ? 'On' : 'Off'}
                    </button>
                  </div>
                  <div className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-2xl p-4">
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Mobile UI Mode</span>
                    <button
                      onClick={() => onUiModeChange?.(currentUiMode === 'dark' ? 'light' : 'dark')}
                      className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest bg-slate-200 text-slate-700"
                    >
                      {currentUiMode === 'dark' ? 'Dark Mode' : 'Light Mode'}
                    </button>
                  </div>
                </div>
              </section>

              <NotificationPreferences
                user={user}
                preferences={notificationPreferences}
                onToggle={toggleNotificationPreference}
              />

              <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950 uppercase mb-2">Theme</h2>
                <p className="text-xs text-slate-500 mb-5">Pick the app look for this device.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {THEMES.map((theme) => {
                    const isActive = currentTheme === theme.id;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => onThemeChange?.(theme.id)}
                        className={`text-left p-4 rounded-2xl border-2 transition-all ${
                          isActive ? 'border-amber-500 bg-amber-50' : 'border-slate-100 bg-slate-50 hover:border-slate-300'
                        }`}
                      >
                        <div className={`h-16 rounded-xl bg-gradient-to-br ${theme.previewClass} mb-4 shadow-sm`}></div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-black uppercase text-slate-900">{theme.name}</span>
                          {isActive && <span className="text-xs font-black uppercase tracking-widest text-amber-700">Active</span>}
                        </div>
                        <p className="mt-2 text-xs font-bold uppercase tracking-widest text-slate-400 leading-relaxed">
                          {theme.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
                {currentTheme === 'custom' && customTheme && onCustomThemeChange && (
                  <div className="mt-6 p-5 bg-slate-50 border border-slate-200 rounded-2xl">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-4">Custom Theme Designer</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {THEME_COLOR_FIELDS.map((field) => (
                        <label key={field.key} className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-widest text-slate-500">
                          <span>{field.label}</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={customTheme[field.key]}
                              onChange={(e) => onCustomThemeChange({ ...customTheme, [field.key]: e.target.value })}
                              className="w-9 h-9 rounded-lg border border-slate-300 bg-white p-0.5"
                            />
                            <span className="font-mono text-xs text-slate-700">{customTheme[field.key]}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950 uppercase mb-5">App Data</h2>
                <button
                  onClick={onOpenUpdateManual}
                  className="w-full py-4 mb-3 bg-sky-50 border border-sky-100 text-sky-700 rounded-2xl text-xs font-black uppercase tracking-widest"
                >
                  Open What's New
                </button>
                <button
                  onClick={async () => {
                    if (typeof window !== 'undefined') {
                      window.sessionStorage.clear();
                      window.localStorage.removeItem(`notifications:${user.id}`);
                      window.localStorage.removeItem(`lowDataMode:${user.id}`);
                      window.localStorage.removeItem(`appTheme:${user.id}`);
                      window.localStorage.removeItem(`appThemeCustom:${user.id}`);
                      Object.keys(window.localStorage).forEach((key) => {
                        if (key.startsWith('testpkg:offline:') || key === 'pendingResultsQueue' || key.startsWith('updateManualSeen:')) {
                          window.localStorage.removeItem(key);
                        }
                      });
                      if ('serviceWorker' in navigator) {
                        const registrations = await navigator.serviceWorker.getRegistrations();
                        await Promise.all(registrations.map((registration) => registration.unregister()));
                      }
                      if ('caches' in window) {
                        const cacheNames = await caches.keys();
                        await Promise.all(cacheNames.map((name) => caches.delete(name)));
                      }
                    }
                    toast.success('Cache cleared', 'Local cache cleared. Reloading...');
                    window.location.reload();
                  }}
                  className="w-full py-4 bg-slate-50 border border-slate-200 text-slate-700 rounded-2xl text-xs font-black uppercase tracking-widest"
                >
                  Clear Local Cache
                </button>
              </section>
            </div>
          )}
        </div>
      </div>
      <AnnouncementComposer
        open={showAnnouncementComposer}
        user={user}
        classes={classOptions.filter((item) => isTeacher || enrolledClassIds.includes(item.id))}
        students={studentsForComposer}
        initialValue={selectedAnnouncement}
        onClose={() => {
          setShowAnnouncementComposer(false);
          setSelectedAnnouncement(null);
        }}
        onSave={saveAnnouncement}
      />
      <SessionModal
        open={showSessionModal}
        classes={classOptions.filter((item) => isTeacher || enrolledClassIds.includes(item.id))}
        initialValue={selectedSession}
        canEdit={isTeacher}
        onClose={() => {
          setShowSessionModal(false);
          setSelectedSession(null);
        }}
        onSave={saveSession}
      />
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-between items-center bg-[var(--surface)] backdrop-blur-xl border-t border-[var(--edge)] py-2 pb-safe px-1 md:hidden">
        {mobileNavTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
            aria-label={tab.label}
            className={`flex-1 max-w-[64px] flex items-center justify-center py-2 rounded-xl min-h-[46px] transition-all ${activeTab === tab.id ? 'text-[var(--gold)]' : 'text-[var(--muted)]'}`}
          >
            <span className="inline-flex items-center justify-center leading-none">{renderTabIcon(tab.id)}</span>
          </button>
        ))}
      </nav>
      </div>
    </div>
  );
};

export default Dashboard;

