
import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { User, MockTest, ExamResult, Question, TestSection, TestAttempt, DifficultyLevel, SharedQuiz, ViewState, BroadcastNotification, CustomThemeConfig, CommunityProfile, PrepMode } from './types';
import { auth, authPersistenceReady, db } from './firebase';
import { onAuthStateChanged, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, getDoc, getDocFromServer, collection, getDocs, query, where, limit, documentId, updateDoc, addDoc, onSnapshot, setDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import logo from './assets/scholar-main.png';
import { AppTheme } from './theme';
import { clearGlassAccent, syncGlassAccent } from './glassAccent';
import { toast } from './components/ui/Toast';
import { ATTENDANCE_ROUTE, BLACKLIST_ROUTE } from './brainstorm';
import { refreshOwnLeaderboardPublic, toPublicLeaderboardRow } from './lib/leaderboard';
import SplashScreen from './components/SplashScreen';
import PartnershipLogos from './components/PartnershipLogos';
import { DEFAULT_PREP_MODE, PREP_MODE_FEATURES, PREP_MODE_LABELS, getTestPrepMode, hasActivePrepLicense, isPrepFeatureEnabled, normalizePrepMode } from './lib/prepModes';

const Auth = lazy(() => import('./components/Auth'));
const PrepSelector = lazy(() => import('./components/PrepSelector'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const RootAdminDashboard = lazy(() => import('./components/RootAdminDashboard'));
const AttendancePortal = lazy(() => import('./components/AttendancePortal'));
const BlacklistPage = lazy(() => import('./components/BlacklistPage'));
const ExamInterface = lazy(() => import('./components/ExamInterface'));
const ResultScreen = lazy(() => import('./components/ResultScreen'));
const ReviewInterface = lazy(() => import('./components/ReviewInterface'));
const UpdateManual = lazy(() => import('./components/UpdateManual'));
const CoursesHub = lazy(() => import('./components/CoursesHub'));
const VideoLearningHub = lazy(() => import('./components/VideoLearningHub'));
const SocialProfileOnboarding = lazy(() => import('./components/SocialProfileOnboarding'));

const DEFAULT_FREE_ACCESS_ENDS_AT_ISO = '2026-04-01T23:00:00.000Z'; // April 2, 2026 00:00 WAT
const DEADLINE_CONFIG_DOC_ID = 'deadline_config';
const LICENSE_PROMPT_SNOOZE_HOURS = 24;
const WHATSAPP_PHONE = '2348145807650';
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent('Hello, I want to purchase my Scholar annual license key.')}`;
const OFFLINE_PACKAGE_KEY_PREFIX = 'testpkg:offline:';
const PENDING_RESULTS_QUEUE_KEY = 'pendingResultsQueue';
const QUESTION_FETCH_LIMIT = 3000;
const APP_THEME_STORAGE_KEY = 'appTheme';
const APP_CUSTOM_THEME_STORAGE_KEY = 'appThemeCustom';
const APP_THEME_LAST_USED_KEY = 'appTheme:lastUsed';
const APP_UI_MODE_STORAGE_KEY = 'appUiMode';
const UPDATE_MANUAL_VERSION = '3.15.0';
const UPDATE_MANUAL_SEEN_PREFIX = 'updateManualSeen';
const BROADCAST_NOTIFICATIONS_SEEN_AT_PREFIX = 'broadcastSeenAt';
const SOCIAL_PROFILE_PROMPT_DISMISSED_PREFIX = 'socialProfilePromptDismissed';

type MonetizationMode = 'pre-deadline' | 'post-deadline';
type OfflineTestPackage = {
  signature: string;
  questions: Record<string, Question>;
  sections?: TestSection[];
  generationMode?: MockTest['generationMode'];
  createdAt?: number;
};

const DEFAULT_CUSTOM_THEME: CustomThemeConfig = {
  bgStart: '#f8fafc',
  bgEnd: '#e8eef8',
  shellStart: '#0b1224',
  shellMid: '#172554',
  shellEnd: '#1e3a8a',
  accent: '#f59e0b',
  accentSoft: '#ffedd5',
  accentText: '#9a3412',
  card: '#ffffff',
  border: '#cbd5e1'
};

const isValidAppTheme = (value: string | null): value is AppTheme => {
  return value === 'classic' || value === 'neo' || value === 'gold' || value === 'glass' || value === 'neo-black' || value === 'custom';
};

const getThemeStorageKey = (userId: string) => `${APP_THEME_STORAGE_KEY}:${userId}`;
const getCustomThemeStorageKey = (userId: string) => `${APP_CUSTOM_THEME_STORAGE_KEY}:${userId}`;
const getUiModeStorageKey = (userId: string) => `${APP_UI_MODE_STORAGE_KEY}:${userId}`;
const getUpdateManualSeenKey = () => `${UPDATE_MANUAL_SEEN_PREFIX}:${UPDATE_MANUAL_VERSION}:global`;
const getSocialProfilePromptDismissedKey = (userId: string) => `${SOCIAL_PROFILE_PROMPT_DISMISSED_PREFIX}:${userId}`;

const sanitizeHex = (value: string, fallback: string) => {
  const v = String(value || '').trim();
  return /^#([0-9a-fA-F]{6})$/.test(v) ? v : fallback;
};

const verifyTestPassword = (test: MockTest): 'granted' | 'incorrect' | 'cancelled' => {
  const requiredPassword = String(test.accessPassword || '').trim();
  if (!requiredPassword) return 'granted';
  const entered = window.prompt(`Enter password for "${test.name}"`);
  if (entered === null) return 'cancelled';
  return entered.trim() === requiredPassword ? 'granted' : 'incorrect';
};

const normalizeCustomTheme = (value: any): CustomThemeConfig => {
  const source = value && typeof value === 'object' ? value : {};
  return {
    bgStart: sanitizeHex(source.bgStart, DEFAULT_CUSTOM_THEME.bgStart),
    bgEnd: sanitizeHex(source.bgEnd, DEFAULT_CUSTOM_THEME.bgEnd),
    shellStart: sanitizeHex(source.shellStart, DEFAULT_CUSTOM_THEME.shellStart),
    shellMid: sanitizeHex(source.shellMid, DEFAULT_CUSTOM_THEME.shellMid),
    shellEnd: sanitizeHex(source.shellEnd, DEFAULT_CUSTOM_THEME.shellEnd),
    accent: sanitizeHex(source.accent, DEFAULT_CUSTOM_THEME.accent),
    accentSoft: sanitizeHex(source.accentSoft, DEFAULT_CUSTOM_THEME.accentSoft),
    accentText: sanitizeHex(source.accentText, DEFAULT_CUSTOM_THEME.accentText),
    card: sanitizeHex(source.card, DEFAULT_CUSTOM_THEME.card),
    border: sanitizeHex(source.border, DEFAULT_CUSTOM_THEME.border)
  };
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const viewToPath = (view: ViewState) => {
  if (view === 'auth') return '/auth';
  if (view === 'verify-email') return '/verify-email';
  if (view === 'prep-selector') return '/prep';
  if (view === 'dashboard') return '/dashboard';
  if (view === 'courses') return '/courses';
  if (view === 'videos') return '/videos';
  if (view === 'attendance') return ATTENDANCE_ROUTE;
  if (view === 'blacklist') return BLACKLIST_ROUTE;
  if (view === 'admin') return '/admin';
  if (view === 'root-admin') return '/root-admin';
  if (view === 'update-manual') return '/whats-new';
  return null;
};

const pathToView = (path: string): ViewState | null => {
  const normalized = path.toLowerCase();
  if (normalized === '/auth') return 'auth';
  if (normalized === '/verify-email') return 'verify-email';
  if (normalized === '/prep') return 'prep-selector';
  if (normalized === '/dashboard' || normalized === '/') return 'dashboard';
  if (normalized === '/courses') return 'courses';
  if (normalized === '/videos') return 'videos';
  if (normalized === ATTENDANCE_ROUTE) return 'attendance';
  if (normalized === BLACKLIST_ROUTE) return 'blacklist';
  if (normalized === '/admin') return 'admin';
  if (normalized === '/root-admin') return 'root-admin';
  if (normalized === '/whats-new') return 'update-manual';
  return null;
};

interface MonetizationModalProps {
  mode: MonetizationMode;
  isLocked: boolean;
  productLabel: string;
  deadlineLabel: string;
  activationKey: string;
  onActivationKeyChange: (value: string) => void;
  onActivateKey: () => void;
  isActivatingKey: boolean;
  onOpenWhatsApp: () => void;
  onContinueFree?: () => void;
  onClose?: () => void;
  onLogout?: () => void;
}

const MonetizationModal: React.FC<MonetizationModalProps> = ({
  mode,
  isLocked,
  productLabel,
  deadlineLabel,
  activationKey,
  onActivationKeyChange,
  onActivateKey,
  isActivatingKey,
  onOpenWhatsApp,
  onContinueFree,
  onClose,
  onLogout
}) => {
  const isPreDeadline = mode === 'pre-deadline';

  return (
    <div className="fixed inset-0 z-[200] bg-slate-950/75 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto safe-top safe-bottom paywall-backdrop">
      <div className="relative w-full max-w-xl max-h-[90dvh] bg-white rounded-[2rem] border border-slate-100 shadow-2xl overflow-hidden paywall-card v2-panel">
        <div className="absolute -top-5 -left-4 w-8 h-8 bg-amber-300/70 rounded-full blur-sm paywall-float"></div>
        <div className="absolute -bottom-4 -right-3 w-7 h-7 bg-emerald-300/60 rounded-full blur-sm paywall-float-alt"></div>
        <div className="v2-shell bg-slate-950 border-b-4 border-amber-500 px-8 py-7 shrink-0">
          <p className="text-amber-500 text-xs font-black uppercase tracking-[0.3em] mb-2">Platform Update</p>
          <h2 className="text-white text-xl font-black uppercase tracking-tight">
            {isPreDeadline ? 'Free Access Is Ending Soon' : 'Free Access Has Ended'}
          </h2>
        </div>
        <div className="v2-scroll p-6 sm:p-8 space-y-5">
          {isPreDeadline ? (
            <p className="text-slate-600 text-sm leading-relaxed">
              {productLabel} has been running on free resources. To keep service stable for growing usage, free access
              ends on <strong>{deadlineLabel}</strong>. Buy your annual activation key before this date to
              avoid interruption.
            </p>
          ) : (
            <p className="text-slate-600 text-sm leading-relaxed">
              To continue using <strong>{productLabel}</strong>,
              activate your annual license key.
            </p>
          )}

          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">Activation Key</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={activationKey}
                onChange={(e) => onActivationKeyChange(e.target.value.toUpperCase())}
                placeholder="Enter license key"
                className="flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-white font-bold text-xs uppercase tracking-wide outline-none"
              />
              <button
                onClick={onActivateKey}
                disabled={isActivatingKey}
                className="px-5 py-3 bg-slate-950 text-amber-500 rounded-xl font-black uppercase text-xs tracking-widest disabled:opacity-40"
              >
                {isActivatingKey ? 'Activating...' : 'Activate'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={onOpenWhatsApp}
              className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase text-xs tracking-widest shadow-lg"
            >
              DM +2348145807650
            </button>
            {isPreDeadline && onContinueFree && (
              <button
                onClick={onContinueFree}
                className="w-full py-4 bg-white text-slate-600 border border-slate-200 rounded-2xl font-black uppercase text-xs tracking-widest"
              >
                Continue Free For Now
              </button>
            )}
          </div>

          {!isLocked && onClose && (
            <button
              onClick={onClose}
              className="w-full py-3 text-xs font-black text-slate-400 uppercase tracking-widest hover:text-slate-600"
            >
              Continue
            </button>
          )}

          {isLocked && onLogout && (
            <button
              onClick={onLogout}
              className="w-full py-3 text-xs font-black text-red-500 uppercase tracking-widest hover:text-red-600"
            >
              Log Out
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

interface SocialProfilePromptProps {
  onCreateNow: () => void;
  onCreateLater: () => void;
}

const SocialProfilePrompt: React.FC<SocialProfilePromptProps> = ({ onCreateNow, onCreateLater }) => {
  return (
    <div className="fixed inset-0 z-[215] bg-slate-950/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto safe-top safe-bottom">
      <div className="w-full max-w-lg bg-white rounded-[2rem] border border-slate-100 shadow-2xl overflow-hidden">
        <div className="bg-slate-950 border-b-4 border-amber-500 px-6 py-6">
          <p className="text-amber-500 text-xs font-black uppercase tracking-[0.3em] mb-2">Community Profile</p>
          <h2 className="text-white text-xl font-black uppercase tracking-tight">Create Your Chat Profile?</h2>
        </div>
        <div className="p-6 space-y-5">
          <p className="text-sm leading-relaxed text-slate-600">
            A chat profile helps classmates identify you in the community, friend requests, and messages. You can set it up now or continue and do it later.
          </p>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Create it later</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Open <strong>Dashboard</strong>, go to <strong>Profile</strong>, then tap <strong>Edit Social Profile</strong>. You can also open <strong>Community</strong> and tap <strong>Edit Profile</strong>.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onCreateNow}
              className="w-full rounded-2xl bg-slate-950 px-5 py-4 text-xs font-black uppercase tracking-widest text-amber-500 shadow-lg"
            >
              Create Now
            </button>
            <button
              type="button"
              onClick={onCreateLater}
              className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-xs font-black uppercase tracking-widest text-slate-600"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [showSplash, setShowSplash] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<ViewState>('auth');
  const [lastMainView, setLastMainView] = useState<ViewState>('dashboard');
  const [selectedPrepMode, setSelectedPrepMode] = useState<PrepMode>(DEFAULT_PREP_MODE);
  const [adminDefaultTab, setAdminDefaultTab] = useState<string>('questions');
  const [activeTest, setActiveTest] = useState<MockTest | null>(null);
  const [activeResolvedSections, setActiveResolvedSections] = useState<TestSection[] | null>(null);
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);
  const [activeQuizMode, setActiveQuizMode] = useState(false);
  const [reviewResult, setReviewResult] = useState<ExamResult | null>(null);
  const [recentResult, setRecentResult] = useState<ExamResult | null>(null);
  const [packagedQuestions, setPackagedQuestions] = useState<Record<string, Question> | null>(null);
  const [packagingState, setPackagingState] = useState<{ message: string; progress: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showMonetizationModal, setShowMonetizationModal] = useState(false);
  const [monetizationMode, setMonetizationMode] = useState<MonetizationMode>('pre-deadline');
  const [isMonetizationLocked, setIsMonetizationLocked] = useState(false);
  const [activationKey, setActivationKey] = useState('');
  const [isActivatingKey, setIsActivatingKey] = useState(false);
  const [freeAccessEndsAtIso, setFreeAccessEndsAtIso] = useState(DEFAULT_FREE_ACCESS_ENDS_AT_ISO);
  const [theme, setTheme] = useState<AppTheme>('classic');
  const [uiMode, setUiMode] = useState<'light' | 'dark'>('light');
  const [customTheme, setCustomTheme] = useState<CustomThemeConfig>(DEFAULT_CUSTOM_THEME);
  const [broadcastToasts, setBroadcastToasts] = useState<Array<{ id: string; title: string; message: string }>>([]);
  const [communityProfile, setCommunityProfile] = useState<CommunityProfile | null>(null);
  const [isSocialProfileReady, setIsSocialProfileReady] = useState(false);
  const [isSocialProfileEditorOpen, setIsSocialProfileEditorOpen] = useState(false);
  const [isSocialProfilePromptDismissed, setIsSocialProfilePromptDismissed] = useState(false);
  const isFlushingQueueRef = useRef(false);
  const bootFallbackNotifiedRef = useRef(false);

  const getDefaultViewForRole = (role: User['role']) => {
    if (role === 'root-admin') return 'root-admin';
    if (role === 'admin') return 'admin';
    return 'prep-selector';
  };

  const getPostAuthViewForUser = (user: User): ViewState => {
    if (user.role === 'root-admin') return 'root-admin';
    if (user.role === 'admin') return 'admin';
    return user.lastPrepMode ? 'dashboard' : 'prep-selector';
  };

  const getBroadcastSeenStorageKey = (userId: string) => `${BROADCAST_NOTIFICATIONS_SEEN_AT_PREFIX}:${userId}`;

  const notificationsAllowedForUser = (userId: string) => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(`notifications:${userId}`) !== 'off';
  };

  const isDynamicGenerationMode = (mode?: string) => {
    return (mode || 'fixed') === 'dynamic' || mode === 'csv-dynamic';
  };

  const getLinkedTestId = (): string | null => {
    if (typeof window === 'undefined') return null;
    const match = window.location.pathname.match(/^\/test\/([^/?#]+)/i);
    if (match?.[1]) {
      const id = decodeURIComponent(match[1]);
      window.localStorage.setItem('linkedTestId', id);
      return id;
    }
    return window.localStorage.getItem('linkedTestId');
  };

  const getLinkedQuizId = (): string | null => {
    if (typeof window === 'undefined') return null;
    const match = window.location.pathname.match(/^\/quiz\/([^/?#]+)/i);
    if (match?.[1]) {
      const id = decodeURIComponent(match[1]);
      window.localStorage.setItem('linkedQuizId', id);
      return id;
    }
    return window.localStorage.getItem('linkedQuizId');
  };

  const clearLinkedTestId = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem('linkedTestId');
    if (window.location.pathname.startsWith('/test/')) {
      window.history.replaceState({}, '', '/');
    }
  };

  const clearLinkedQuizId = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem('linkedQuizId');
    if (window.location.pathname.startsWith('/quiz/')) {
      window.history.replaceState({}, '', '/');
    }
  };

  const isStaffUser = (user: User | null) => {
    if (!user) return false;
    return user.role === 'root-admin';
  };

  const hasActiveSubscription = (user: User | null) => {
    if (!user) return false;
    if (isStaffUser(user)) return true;
    if (user.subscriptionStatus !== 'active') return false;
    if (!user.subscriptionEndsAt) return true;
    const endsAt = Date.parse(user.subscriptionEndsAt);
    return Number.isFinite(endsAt) && endsAt > Date.now();
  };

  const isReadOnlyForUnactivatedUser = (user: User | null, prepMode: PrepMode = selectedPrepMode) => {
    if (!user) return false;
    if (isStaffUser(user) || hasActivePrepLicense(user, prepMode)) return false;
    if (prepMode !== DEFAULT_PREP_MODE) return true;
    const deadlineMs = Date.parse(freeAccessEndsAtIso);
    return Number.isFinite(deadlineMs) && Date.now() > deadlineMs;
  };

  useEffect(() => {
    let cancelled = false;
    const loadCommunityProfile = async () => {
      if (!currentUser?.id) {
        setCommunityProfile(null);
        setIsSocialProfileReady(false);
        return;
      }
      try {
        const snap: any = await getDoc(doc(db, 'communityProfiles', currentUser.id));
        if (cancelled) return;
        if (snap.exists()) {
          setCommunityProfile({ id: snap.id, ...(snap.data() as Omit<CommunityProfile, 'id'>) });
        } else {
          setCommunityProfile(null);
        }
      } catch {
        if (!cancelled) setCommunityProfile(null);
      } finally {
        if (!cancelled) setIsSocialProfileReady(true);
      }
    };

    void loadCommunityProfile();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (typeof window === 'undefined' || !currentUser?.id) {
      setIsSocialProfilePromptDismissed(false);
      return;
    }
    setIsSocialProfilePromptDismissed(window.localStorage.getItem(getSocialProfilePromptDismissedKey(currentUser.id)) === 'true');
  }, [currentUser?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!currentUser?.id) {
      const lastTheme = window.localStorage.getItem(APP_THEME_LAST_USED_KEY);
      setTheme(isValidAppTheme(lastTheme) ? lastTheme : 'classic');
      setCustomTheme(DEFAULT_CUSTOM_THEME);
      const lastUiMode = window.localStorage.getItem(APP_UI_MODE_STORAGE_KEY);
      setUiMode(lastUiMode === 'dark' ? 'dark' : 'light');
      return;
    }
    const storedTheme = window.localStorage.getItem(getThemeStorageKey(currentUser.id))
      || window.localStorage.getItem(APP_THEME_LAST_USED_KEY);
    if (isValidAppTheme(storedTheme)) {
      setTheme(storedTheme);
    } else {
      setTheme('classic');
    }
    try {
      const rawCustom = window.localStorage.getItem(getCustomThemeStorageKey(currentUser.id));
      if (!rawCustom) {
        setCustomTheme(DEFAULT_CUSTOM_THEME);
      } else {
        setCustomTheme(normalizeCustomTheme(JSON.parse(rawCustom)));
      }
    } catch {
      setCustomTheme(DEFAULT_CUSTOM_THEME);
    }
    const storedUiMode = window.localStorage.getItem(getUiModeStorageKey(currentUser.id))
      || window.localStorage.getItem(APP_UI_MODE_STORAGE_KEY);
    setUiMode(storedUiMode === 'dark' ? 'dark' : 'light');
  }, [currentUser?.id]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
    const customVars = [
      '--v2-bg-start',
      '--v2-bg-end',
      '--v2-shell-start',
      '--v2-shell-mid',
      '--v2-shell-end',
      '--v2-accent',
      '--v2-accent-soft',
      '--v2-accent-text',
      '--v2-card',
      '--v2-border'
    ];
    if (theme === 'custom') {
      document.documentElement.style.setProperty('--v2-bg-start', customTheme.bgStart);
      document.documentElement.style.setProperty('--v2-bg-end', customTheme.bgEnd);
      document.documentElement.style.setProperty('--v2-shell-start', customTheme.shellStart);
      document.documentElement.style.setProperty('--v2-shell-mid', customTheme.shellMid);
      document.documentElement.style.setProperty('--v2-shell-end', customTheme.shellEnd);
      document.documentElement.style.setProperty('--v2-accent', customTheme.accent);
      document.documentElement.style.setProperty('--v2-accent-soft', customTheme.accentSoft);
      document.documentElement.style.setProperty('--v2-accent-text', customTheme.accentText);
      document.documentElement.style.setProperty('--v2-card', customTheme.card);
      document.documentElement.style.setProperty('--v2-border', customTheme.border);
    } else {
      customVars.forEach((varName) => document.documentElement.style.removeProperty(varName));
    }
    if (theme === 'glass') {
      syncGlassAccent();
    } else {
      clearGlassAccent();
    }
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(APP_THEME_LAST_USED_KEY, theme);
    if (!currentUser?.id) return;
    window.localStorage.setItem(getThemeStorageKey(currentUser.id), theme);
    window.localStorage.setItem(getCustomThemeStorageKey(currentUser.id), JSON.stringify(customTheme));
  }, [theme, customTheme, currentUser?.id]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-ui-mode', uiMode);
    document.body.setAttribute('data-ui-mode', uiMode);
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(APP_UI_MODE_STORAGE_KEY, uiMode);
    if (!currentUser?.id) return;
    window.localStorage.setItem(getUiModeStorageKey(currentUser.id), uiMode);
  }, [uiMode, currentUser?.id]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const applyViewportHeight = () => {
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const vh = viewportHeight * 0.01;
      document.documentElement.style.setProperty('--app-vh', `${vh}px`);
    };
    applyViewportHeight();
    window.addEventListener('resize', applyViewportHeight);
    window.addEventListener('orientationchange', applyViewportHeight);
    window.visualViewport?.addEventListener('resize', applyViewportHeight);
    window.visualViewport?.addEventListener('scroll', applyViewportHeight);
    return () => {
      window.removeEventListener('resize', applyViewportHeight);
      window.removeEventListener('orientationchange', applyViewportHeight);
      window.visualViewport?.removeEventListener('resize', applyViewportHeight);
      window.visualViewport?.removeEventListener('scroll', applyViewportHeight);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || isLoading) return;
    const targetPath = viewToPath(currentView);
    if (!targetPath) return;
    if (window.location.pathname !== targetPath) {
      window.history.replaceState({}, '', targetPath);
    }
  }, [currentView, isLoading]);

  useEffect(() => {
    if (typeof window === 'undefined' || !currentUser || isLoading) return;
    if (!['dashboard', 'admin', 'root-admin'].includes(currentView)) return;
    const seenKey = getUpdateManualSeenKey();
    if (window.localStorage.getItem(seenKey) === '1') return;
    window.localStorage.setItem(seenKey, '1');
    setLastMainView(currentView);
    setCurrentView('update-manual');
  }, [currentUser, currentView, isLoading]);

  const getPromptDeferredUntil = (): number | null => {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem('licensePromptDeferredUntil') : null;
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  };

  const deadlineLabel = (() => {
    const ms = Date.parse(freeAccessEndsAtIso);
    if (!Number.isFinite(ms)) return 'April 2, 2026 00:00 WAT';
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Lagos',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(ms));
    return `${formatted} WAT`;
  })();

  const getSectionQuestionIds = (sections: TestSection[]) => {
    return Array.from(new Set(sections.flatMap(section => section.questionIds)));
  };

  const getPackageSignature = (test: MockTest, sections: TestSection[]) => {
    const ids = getSectionQuestionIds(sections).sort();
    return `${ids.length}:${ids.join('|')}`;
  };

  const getOfflinePackage = (test: MockTest, sections?: TestSection[]): OfflineTestPackage | null => {
    if (typeof window === 'undefined') return null;
    try {
      const offlineRaw = window.localStorage.getItem(`${OFFLINE_PACKAGE_KEY_PREFIX}${test.id}`);
      if (!offlineRaw) return null;
      const offlineParsed = JSON.parse(offlineRaw) as OfflineTestPackage;
      const effectiveSections = sections || offlineParsed.sections || test.sections;
      if (offlineParsed.signature !== getPackageSignature(test, effectiveSections)) return null;
      return offlineParsed;
    } catch {
      return null;
    }
  };

  const getCachedPackage = (test: MockTest, sections: TestSection[]): Record<string, Question> | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(`testpkg:${test.id}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { signature: string; questions: Record<string, Question> };
        if (parsed.signature === getPackageSignature(test, sections)) {
          return parsed.questions || null;
        }
      }
      const offlineParsed = getOfflinePackage(test, sections);
      return offlineParsed?.questions || null;
    } catch {
      return null;
    }
  };

  const setCachedPackage = (test: MockTest, sections: TestSection[], questions: Record<string, Question>) => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(
        `testpkg:${test.id}`,
        JSON.stringify({ signature: getPackageSignature(test, sections), questions, createdAt: Date.now() })
      );
    } catch {
      // Ignore cache write failures (quota/private mode restrictions).
    }
  };

  const setOfflinePackage = (test: MockTest, sections: TestSection[], questions: Record<string, Question>) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        `${OFFLINE_PACKAGE_KEY_PREFIX}${test.id}`,
        JSON.stringify({
          signature: getPackageSignature(test, sections),
          questions,
          sections,
          generationMode: test.generationMode || 'fixed',
          createdAt: Date.now()
        } satisfies OfflineTestPackage)
      );
    } catch {
      toast.error('Offline save failed', 'Could not save this test for offline use on this device.');
    }
  };

  const packageQuestionsForTest = async (test: MockTest, sections: TestSection[]): Promise<Record<string, Question>> => {
    const cached = getCachedPackage(test, sections);
    if (cached && Object.keys(cached).length > 0) {
      return cached;
    }

    const ids = getSectionQuestionIds(sections);
    if (ids.length === 0) {
      throw new Error('This test has no questions configured.');
    }

    const chunkSize = 10;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      chunks.push(ids.slice(i, i + chunkSize));
    }

    const map: Record<string, Question> = {};
    for (let i = 0; i < chunks.length; i++) {
      setPackagingState({
        message: 'Questions are being packaged...',
        progress: Math.round((i / chunks.length) * 100)
      });
      const snap = await getDocs(query(collection(db, 'questions'), where(documentId(), 'in', chunks[i])));
      snap.docs.forEach(d => {
        map[d.id] = { ...d.data(), id: d.id } as Question;
      });
    }

    const missing = ids.filter(id => !map[id]);
    if (missing.length > 0) {
      throw new Error(`Missing ${missing.length} question(s) for this test.`);
    }

    setPackagingState({ message: 'Questions are being packaged...', progress: 100 });
    setCachedPackage(test, sections, map);
    return map;
  };

  const hashStringToSeed = (input: string) => {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) || 1;
  };

  const createSeededRng = (seed: number) => {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  };

  const shuffleWithRng = <T,>(arr: T[], rng: () => number) => {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  const normalizeDifficulty = (value?: string): DifficultyLevel => {
    if (value === 'easy' || value === 'hard') return value;
    return 'medium';
  };

  const sampleForDynamicSection = (
    section: TestSection,
    allQuestions: Question[],
    usedIds: Set<string>,
    rng: () => number
  ): string[] => {
    const wanted = Math.max(1, Number(section.questionCount || 0));
    const subjects = new Set((section.sampleFilters?.subjects || []).map(s => s.toLowerCase().trim()).filter(Boolean));
    const topics = new Set((section.sampleFilters?.topics || []).map(s => s.toLowerCase().trim()).filter(Boolean));
    const tags = new Set((section.sampleFilters?.tags || []).map(s => s.toLowerCase().trim()).filter(Boolean));
    const difficulties = new Set((section.sampleFilters?.difficulties || []).map(d => d.toLowerCase().trim()).filter(Boolean));

    const filtered = allQuestions.filter(q => {
      if (q.isActive === false) return false;
      if ((q.status || 'approved') === 'draft') return false;
      if (subjects.size > 0 && !subjects.has((q.subject || '').toLowerCase().trim())) return false;
      if (topics.size > 0 && !topics.has((q.topic || '').toLowerCase().trim())) return false;
      if (difficulties.size > 0 && !difficulties.has(normalizeDifficulty(q.difficulty))) return false;
      if (tags.size > 0) {
        const qTags = (q.tags || []).map(t => t.toLowerCase().trim());
        if (!qTags.some(t => tags.has(t))) return false;
      }
      return true;
    });

    const uniquePool = filtered.filter(q => !usedIds.has(q.id));
    const pool = uniquePool.length >= wanted ? uniquePool : filtered;
    if (pool.length < wanted) {
      throw new Error(`Not enough questions for section "${section.name}". Need ${wanted}, found ${pool.length}.`);
    }

    const mix = section.difficultyMix || {};
    const mixTotal = Number(mix.easy || 0) + Number(mix.medium || 0) + Number(mix.hard || 0);
    const byDifficulty: Record<DifficultyLevel, Question[]> = { easy: [], medium: [], hard: [] };
    pool.forEach(q => byDifficulty[normalizeDifficulty(q.difficulty)].push(q));

    let chosen: Question[] = [];
    if (mixTotal > 0) {
      const normalizedMix = {
        easy: Math.max(0, Number(mix.easy || 0)) / mixTotal,
        medium: Math.max(0, Number(mix.medium || 0)) / mixTotal,
        hard: Math.max(0, Number(mix.hard || 0)) / mixTotal
      };
      const targets: Record<DifficultyLevel, number> = {
        easy: Math.floor(wanted * normalizedMix.easy),
        medium: Math.floor(wanted * normalizedMix.medium),
        hard: Math.floor(wanted * normalizedMix.hard)
      };
      let assigned = targets.easy + targets.medium + targets.hard;
      while (assigned < wanted) {
        const options: DifficultyLevel[] = ['medium', 'easy', 'hard'];
        const next = options.find(d => byDifficulty[d].length > targets[d]);
        if (!next) break;
        targets[next]++;
        assigned++;
      }

      (['easy', 'medium', 'hard'] as DifficultyLevel[]).forEach((d) => {
        const pick = shuffleWithRng(byDifficulty[d], rng).slice(0, targets[d]);
        chosen.push(...pick);
      });
    }

    if (chosen.length < wanted) {
      const chosenSet = new Set(chosen.map(q => q.id));
      const remaining = shuffleWithRng(pool.filter(q => !chosenSet.has(q.id)), rng);
      chosen.push(...remaining.slice(0, wanted - chosen.length));
    }

    const final = shuffleWithRng(chosen, rng).slice(0, wanted).map(q => q.id);
    final.forEach(id => usedIds.add(id));
    return final;
  };

  const buildDynamicSections = async (test: MockTest, seed: number) => {
    const rng = createSeededRng(seed);

    setPackagingState({ message: 'Building your personalized test...', progress: 15 });
    const pooledIds = Array.from(new Set(
      test.sections.flatMap(section => section.questionIds || []).filter(Boolean)
    ));
    const allQuestions: Question[] = [];
    if (pooledIds.length > 0) {
      const chunks: string[][] = [];
      for (let i = 0; i < pooledIds.length; i += 10) chunks.push(pooledIds.slice(i, i + 10));
      for (const chunk of chunks) {
        const snap = await getDocs(query(collection(db, 'questions'), where(documentId(), 'in', chunk)));
        snap.docs.forEach(d => allQuestions.push({ ...d.data(), id: d.id } as Question));
      }
    } else {
      // Backward-compat fallback for older dynamic tests that have no precomputed pools.
      const qSnap = await getDocs(query(collection(db, 'questions'), limit(QUESTION_FETCH_LIMIT)));
      qSnap.docs.forEach(d => allQuestions.push({ ...d.data(), id: d.id } as Question));
    }

    const usedIds = new Set<string>();
    const resolvedSections: TestSection[] = test.sections.map((section) => {
      const sectionPool = section.questionIds?.length
        ? allQuestions.filter(q => section.questionIds.includes(q.id))
        : allQuestions;
      const sampledIds = sampleForDynamicSection(section, sectionPool, usedIds, rng);
      return {
        ...section,
        questionIds: sampledIds
      };
    });

    const allIds = getSectionQuestionIds(resolvedSections);
    return { resolvedSections, allIds };
  };

  const generateDynamicAttempt = async (test: MockTest, userObj: User) => {
    const attemptsSnap = await getDocs(
      query(collection(db, 'results'), where('userId', '==', userObj.id), where('testId', '==', test.id), limit(200))
    );
    const attemptNo = attemptsSnap.size + 1;
    const seed = hashStringToSeed(`${userObj.id}:${test.id}:${attemptNo}`);
    const { resolvedSections, allIds } = await buildDynamicSections(test, seed);
    const attemptPayload: Omit<TestAttempt, 'id'> = {
      testId: test.id,
      userId: userObj.id,
      userName: userObj.name,
      createdAt: new Date().toISOString(),
      seed,
      sections: resolvedSections,
      questionIds: allIds
    };
    setPackagingState({ message: 'Building your personalized test...', progress: 45 });
    try {
      const attemptRef = await addDoc(collection(db, 'testAttempts'), attemptPayload);
      return { attemptId: attemptRef.id, sections: resolvedSections };
    } catch (err: any) {
      if (err?.code === 'permission-denied') {
        // Some deployments do not expose student write access to testAttempts.
        // The dynamic section set is already generated, so continue without persisted attempt metadata.
        return { attemptId: null, sections: resolvedSections };
      }
      throw err;
    }
  };

  const startExamWithPackaging = async (test: MockTest, userObj: User) => {
    setPackagedQuestions(null);
    setActiveResolvedSections(null);
    setActiveAttemptId(null);
    setPackagingState({ message: 'Questions are being packaged...', progress: 0 });
    try {
      let sectionsToUse = test.sections;
      let attemptId: string | null = null;
      let offlineQuestions: Record<string, Question> | null = null;
      if (isDynamicGenerationMode(test.generationMode)) {
        const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
        const offlinePackage = isOffline ? getOfflinePackage(test) : null;
        if (offlinePackage?.sections?.length && offlinePackage.questions) {
          sectionsToUse = offlinePackage.sections;
          offlineQuestions = offlinePackage.questions;
          toast.info('Offline test loaded', 'Using the saved version on this device.');
        } else {
          const generated = await generateDynamicAttempt(test, userObj);
          sectionsToUse = generated.sections;
          attemptId = generated.attemptId;
        }
      }

      const pkg = offlineQuestions || await packageQuestionsForTest(test, sectionsToUse);
      setPackagedQuestions(pkg);
      setActiveResolvedSections(sectionsToUse);
      setActiveAttemptId(attemptId);
      setActiveTest(test);
      setCurrentView('exam');
    } finally {
      setPackagingState(null);
    }
  };

  const saveTestForOffline = async (test: MockTest) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      toast.warning('Offline unavailable', 'Connect to the internet once to save this test for offline use.');
      return;
    }
    try {
      if (isDynamicGenerationMode(test.generationMode)) {
        const seed = hashStringToSeed(`${currentUser?.id || 'offline'}:${test.id}:offline:${Date.now()}`);
        const generated = await buildDynamicSections(test, seed);
        const pkg = await packageQuestionsForTest(test, generated.resolvedSections);
        setOfflinePackage(test, generated.resolvedSections, pkg);
        toast.success('Saved offline', `"${test.name}" saved as a generated offline version on this device.`);
        return;
      }

      const pkg = await packageQuestionsForTest(test, test.sections);
      setOfflinePackage(test, test.sections, pkg);
      toast.success('Saved offline', `"${test.name}" saved for offline use on this device.`);
    } catch (err: any) {
      toast.error('Offline save failed', err?.message || 'Could not save this test offline right now.');
    } finally {
      setPackagingState(null);
    }
  };

  const tryStartTestFromLink = async (userObj: User, testId: string): Promise<boolean> => {
    try {
      const testDoc = await getDocFromServer(doc(db, 'tests', testId));
      if (!testDoc.exists()) {
        toast.error('Invalid test link', 'This test link is invalid or no longer available.');
        clearLinkedTestId();
        return false;
      }

      const test = { ...testDoc.data(), id: testDoc.id } as MockTest & { isPaused?: boolean };
      const testPrepMode = getTestPrepMode(test);
      setSelectedPrepMode(testPrepMode);
      if (isReadOnlyForUnactivatedUser(userObj, testPrepMode)) {
        toast.warning('Activation required', `Activate your ${PREP_MODE_LABELS[testPrepMode]} license key to open shared tests.`);
        setShowMonetizationModal(true);
        clearLinkedTestId();
        return false;
      }
      if (!test.isApproved || test.isPaused) {
        toast.warning('Test unavailable', 'This test is currently unavailable.');
        clearLinkedTestId();
        return false;
      }
      const passwordStatus = verifyTestPassword(test);
      if (passwordStatus !== 'granted') {
        if (passwordStatus === 'incorrect') {
          toast.error('Access denied', 'Incorrect test password.');
        }
        clearLinkedTestId();
        return false;
      }

      const attemptsSnap = await getDocs(
        query(
          collection(db, 'results'),
          where('userId', '==', userObj.id),
          where('testId', '==', test.id),
          limit(200)
        )
      );

      const attempts = attemptsSnap.size;
      const maxAttempts = test.maxAttempts ?? null;
      const retakeBlocked = !test.allowRetake && attempts >= 1;
      const attemptsBlocked = maxAttempts !== null && maxAttempts > 0 && attempts >= maxAttempts;
      if (retakeBlocked || attemptsBlocked) {
        toast.warning('Attempt limit reached', 'You cannot take this test again.');
        clearLinkedTestId();
        return false;
      }

      setActiveQuizMode(false);
      await startExamWithPackaging(test, userObj);
      clearLinkedTestId();
      return true;
    } catch (err) {
      console.error('Linked test open error:', err);
      toast.error('Open failed', 'Unable to open this shared test right now.');
      clearLinkedTestId();
      return false;
    }
  };

  const tryStartQuizFromLink = async (userObj: User, quizId: string): Promise<boolean> => {
    if (isReadOnlyForUnactivatedUser(userObj)) {
      toast.warning('Activation required', 'Activate your license key to open shared quizzes.');
      setShowMonetizationModal(true);
      clearLinkedQuizId();
      return false;
    }
    try {
      const quizDoc = await getDocFromServer(doc(db, 'quizzes', quizId));
      if (!quizDoc.exists()) {
        toast.error('Invalid quiz link', 'This quiz link is invalid or no longer available.');
        clearLinkedQuizId();
        return false;
      }

      const quiz = { ...quizDoc.data(), id: quizDoc.id } as SharedQuiz;
      if (!quiz.isActive) {
        toast.warning('Quiz unavailable', 'This quiz is currently unavailable.');
        clearLinkedQuizId();
        return false;
      }

      const virtualTestId = `quiz:${quiz.id}`;
      const attemptsSnap = await getDocs(
        query(
          collection(db, 'results'),
          where('userId', '==', userObj.id),
          where('testId', '==', virtualTestId),
          limit(200)
        )
      );
      const attempts = attemptsSnap.size;
      const maxAttempts = quiz.maxAttempts ?? null;
      const retakeBlocked = !quiz.allowRetake && attempts >= 1;
      const attemptsBlocked = maxAttempts !== null && maxAttempts > 0 && attempts >= maxAttempts;
      if (retakeBlocked || attemptsBlocked) {
        toast.warning('Attempt limit reached', 'You cannot take this quiz again.');
        clearLinkedQuizId();
        return false;
      }

      const sectionQuestionIds = quiz.questions.map((_, idx) => `quizq_${idx}`);
      const virtualTest: MockTest = {
        id: virtualTestId,
        name: quiz.name,
        description: quiz.description || 'Shared quiz',
        sections: [{
          id: 'quiz_sec_1',
          name: 'Quiz',
          questionIds: sectionQuestionIds,
          marksPerQuestion: 1
        }],
        generationMode: 'fixed',
        totalDurationSeconds: quiz.totalDurationSeconds,
        allowRetake: quiz.allowRetake,
        maxAttempts: quiz.maxAttempts ?? null,
        prepMode: selectedPrepMode,
        createdBy: quiz.createdBy,
        creatorName: quiz.creatorName,
        isApproved: true,
        createdAt: quiz.createdAt
      };

      const packaged: Record<string, Question> = {};
      quiz.questions.forEach((q, idx) => {
        packaged[`quizq_${idx}`] = {
          id: `quizq_${idx}`,
          subject: 'Quiz',
          topic: 'General',
          text: q.text,
          options: q.options,
          correctAnswerIndex: q.correctAnswerIndex,
          explanation: q.explanation || '',
          prepMode: selectedPrepMode,
          createdBy: quiz.createdBy,
          createdAt: quiz.createdAt
        } as Question;
      });

      setPackagedQuestions(packaged);
      setActiveResolvedSections(virtualTest.sections);
      setActiveAttemptId(null);
      setActiveTest(virtualTest);
      setCurrentView('exam');
      clearLinkedQuizId();
      return true;
    } catch (err) {
      console.error('Linked quiz open error:', err);
      toast.error('Open failed', 'Unable to open this shared quiz right now.');
      clearLinkedQuizId();
      return false;
    }
  };

  const checkUserStatus = async (firebaseUser: any) => {
    try {
      await withTimeout(firebaseUser.reload(), 12000, 'Auth refresh');
      const updatedUser = auth.currentUser;
      if (!updatedUser) {
        setIsLoading(false);
        return;
      }

      const userDoc = await withTimeout(getDoc(doc(db, 'users', updatedUser.uid)), 12000, 'User profile load');
      if (userDoc.exists()) {
        const userData = userDoc.data() as User;
        const userPrepMode = normalizePrepMode(userData.lastPrepMode);
        setSelectedPrepMode(userPrepMode);
        const isOfficialEmail = updatedUser.email?.toLowerCase().endsWith('@aureusmedicos.com');
        const isManuallyVerified = userData.emailVerified === true;
        const isVerifiedForAccess = updatedUser.emailVerified || isOfficialEmail || isManuallyVerified;

        if (updatedUser.emailVerified && userData.emailVerified !== true) {
          try {
            await updateDoc(doc(db, 'users', updatedUser.uid), { emailVerified: true });
          } catch {
            // Non-blocking sync; access check already uses Firebase Auth verification.
          }
        }

        if (!isVerifiedForAccess) {
          setCurrentView('verify-email');
          setIsLoading(false);
          return;
        }

        const userObj = { ...userData, id: updatedUser.uid, emailVerified: isVerifiedForAccess, lastPrepMode: userPrepMode };
        setCurrentUser(userObj);

        const linkedTestId = getLinkedTestId();
        const linkedQuizId = getLinkedQuizId();
        if (linkedTestId) {
          const started = await tryStartTestFromLink(userObj, linkedTestId);
          if (!started) {
            setCurrentView(getPostAuthViewForUser(userObj));
          }
        } else if (linkedQuizId) {
          const started = await tryStartQuizFromLink(userObj, linkedQuizId);
          if (!started) {
            setCurrentView(getPostAuthViewForUser(userObj));
          }
        } else {
          const requestedView = typeof window !== 'undefined' ? pathToView(window.location.pathname) : null;
          if (requestedView === 'attendance') {
            setCurrentView('attendance');
          } else if (requestedView === 'blacklist') {
            setCurrentView('blacklist');
          } else if (requestedView === 'courses') {
            setCurrentView('courses');
          } else if (requestedView === 'update-manual') {
            setCurrentView('update-manual');
          } else if (requestedView === 'admin' && (userData.role === 'admin' || userData.role === 'root-admin')) {
            setCurrentView('admin');
          } else if (requestedView === 'root-admin' && userData.role === 'root-admin') {
            setCurrentView('root-admin');
          } else if (requestedView === 'verify-email') {
            // If account is already verified, never route back to verify-email.
            setCurrentView(getPostAuthViewForUser(userObj));
          } else {
            setCurrentView(getPostAuthViewForUser(userObj));
          }
        }
      } else {
        setCurrentUser(null);
        const requestedView = typeof window !== 'undefined' ? pathToView(window.location.pathname) : null;
        setCurrentView(
          requestedView === 'blacklist'
            ? 'blacklist'
            : requestedView === 'attendance'
              ? 'attendance'
              : 'auth'
        );
      }
    } catch (error) {
      console.error("Account check error:", error);
      const requestedView = typeof window !== 'undefined' ? pathToView(window.location.pathname) : null;
      setCurrentView(
        requestedView === 'blacklist'
          ? 'blacklist'
          : requestedView === 'attendance'
            ? 'attendance'
            : 'auth'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    authPersistenceReady.finally(() => {
      if (cancelled) return;
      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        await checkUserStatus(firebaseUser);
        try {
          const configSnap: any = await withTimeout(getDoc(doc(db, 'licenseKeys', DEADLINE_CONFIG_DOC_ID)), 12000, 'Deadline config load');
          const configured = configSnap.exists() ? (configSnap.data() as any)?.freeAccessEndsAt : null;
          if (typeof configured === 'string' && Number.isFinite(Date.parse(configured))) {
            setFreeAccessEndsAtIso(configured);
          } else {
            setFreeAccessEndsAtIso(DEFAULT_FREE_ACCESS_ENDS_AT_ISO);
          }
        } catch {
          setFreeAccessEndsAtIso(DEFAULT_FREE_ACCESS_ENDS_AT_ISO);
        }
      } else {
        setCurrentUser(null);
        const requestedView = typeof window !== 'undefined' ? pathToView(window.location.pathname) : null;
        setCurrentView(
          requestedView === 'blacklist'
            ? 'blacklist'
            : requestedView === 'attendance'
              ? 'attendance'
              : 'auth'
        );
        setIsLoading(false);
        setFreeAccessEndsAtIso(DEFAULT_FREE_ACCESS_ENDS_AT_ISO);
      }
    });
    });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isLoading) {
      bootFallbackNotifiedRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      if (!isLoading) return;
      const requestedView = typeof window !== 'undefined' ? pathToView(window.location.pathname) : null;
      setCurrentView((prev) => {
        if (prev === 'verify-email') return prev;
        if (requestedView === 'blacklist') return 'blacklist';
        if (requestedView === 'attendance') return 'attendance';
        return 'auth';
      });
      setIsLoading(false);
      if (!bootFallbackNotifiedRef.current) {
        toast.warning('Recovered from slow startup', 'Continuing to sign-in screen. You can retry login immediately.');
        bootFallbackNotifiedRef.current = true;
      }
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  useEffect(() => {
    const flushPendingResults = async () => {
      if (typeof window === 'undefined' || !currentUser || !navigator.onLine || isFlushingQueueRef.current) return;
      const raw = window.localStorage.getItem(PENDING_RESULTS_QUEUE_KEY);
      if (!raw) return;

      let queue: Array<{ payload: any; createdAt: string }> = [];
      try {
        queue = JSON.parse(raw);
        if (!Array.isArray(queue) || queue.length === 0) return;
      } catch {
        return;
      }

      isFlushingQueueRef.current = true;
      const remaining: Array<{ payload: any; createdAt: string }> = [];
      for (const item of queue) {
        try {
          const docRef = await addDoc(collection(db, 'results'), item.payload);
          await setDoc(doc(db, 'testLeaderboardPublic', docRef.id), toPublicLeaderboardRow(item.payload)).catch(() => undefined);
          await refreshOwnLeaderboardPublic(currentUser.id, { ...item.payload, id: docRef.id }).catch(() => undefined);
        } catch {
          remaining.push(item);
        }
      }
      window.localStorage.setItem(PENDING_RESULTS_QUEUE_KEY, JSON.stringify(remaining));
      isFlushingQueueRef.current = false;
    };

    const onOnline = () => { flushPendingResults(); };
    window.addEventListener('online', onOnline);
    flushPendingResults();
    return () => window.removeEventListener('online', onOnline);
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setBroadcastToasts([]);
      return;
    }
    if (!notificationsAllowedForUser(currentUser.id)) return;

    const seenKey = getBroadcastSeenStorageKey(currentUser.id);
    const rawSeen = typeof window !== 'undefined' ? window.localStorage.getItem(seenKey) : null;
    const seenMsInitial = Number(rawSeen || 0);
    let seenMs = Number.isFinite(seenMsInitial) ? seenMsInitial : 0;

    const unsub = onSnapshot(
      query(collection(db, 'broadcastNotifications'), limit(50)),
      async (snap) => {
        const notifications = snap.docs
          .map((d) => ({ ...(d.data() as Omit<BroadcastNotification, 'id'>), id: d.id } as BroadcastNotification))
          .sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''));

        const unseen = notifications.filter((item) => {
          const createdMs = Date.parse(item.createdAt || '');
          return Number.isFinite(createdMs) && createdMs > seenMs && item.createdBy !== currentUser.id;
        });
        if (unseen.length === 0) return;

        setBroadcastToasts((prev) => {
          const existing = new Set(prev.map((p) => p.id));
          const nextItems = unseen
            .filter((item) => !existing.has(item.id))
            .map((item) => ({ id: item.id, title: item.title, message: item.message }));
          return [...prev, ...nextItems].slice(-4);
        });

        const maxSeenMs = unseen.reduce((mx, item) => {
          const t = Date.parse(item.createdAt || '');
          return Number.isFinite(t) ? Math.max(mx, t) : mx;
        }, seenMs);
        seenMs = maxSeenMs;
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(seenKey, String(maxSeenMs));
        }

        if (typeof window === 'undefined' || !('Notification' in window)) return;
        if (Notification.permission === 'default') {
          try { await Notification.requestPermission(); } catch { /* noop */ }
        }
        if (Notification.permission !== 'granted') return;

        unseen.forEach((item) => {
          try {
            new Notification(item.title || 'Notification', { body: item.message || '' });
          } catch {
            // Ignore browser notification failures.
          }
        });
      }
    );

    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    if (broadcastToasts.length === 0) return;
    const timer = window.setTimeout(() => {
      setBroadcastToasts((prev) => prev.slice(1));
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [broadcastToasts]);

  useEffect(() => {
    if (isLoading) return;
    if (!currentUser) {
      setShowMonetizationModal(false);
      setIsMonetizationLocked(false);
      return;
    }
    if (!['dashboard', 'courses', 'videos'].includes(currentView)) {
      setShowMonetizationModal(false);
      setIsMonetizationLocked(false);
      return;
    }

    const staff = isStaffUser(currentUser);
    const paidForMode = hasActivePrepLicense(currentUser, selectedPrepMode);

    if (selectedPrepMode !== DEFAULT_PREP_MODE) {
      setMonetizationMode('post-deadline');
      if (!staff && !paidForMode) {
        setIsMonetizationLocked(false);
        setShowMonetizationModal(true);
      } else {
        setIsMonetizationLocked(false);
        setShowMonetizationModal(false);
      }
      return;
    }

    const now = Date.now();
    const deadlineMs = Date.parse(freeAccessEndsAtIso);
    const isAfterDeadline = Number.isFinite(deadlineMs) && now > deadlineMs;
    const paid = paidForMode;

    if (isAfterDeadline) {
      setMonetizationMode('post-deadline');
      if (!staff && !paid) {
        setIsMonetizationLocked(false);
        setShowMonetizationModal(true);
      } else {
        setIsMonetizationLocked(false);
        setShowMonetizationModal(false);
      }
      return;
    }

    setMonetizationMode('pre-deadline');
    if (staff || paid) {
      setIsMonetizationLocked(false);
      setShowMonetizationModal(false);
      return;
    }

    const deferredUntil = getPromptDeferredUntil();
    if (deferredUntil && deferredUntil > now) {
      setIsMonetizationLocked(false);
      setShowMonetizationModal(false);
      return;
    }

    setIsMonetizationLocked(false);
    setShowMonetizationModal(true);
  }, [currentUser, currentView, isLoading, freeAccessEndsAtIso, selectedPrepMode]);

  const handleOpenWhatsApp = () => {
    window.open(WHATSAPP_URL, '_blank', 'noopener,noreferrer');
  };

  const handleSelectPrepMode = async (mode: PrepMode) => {
    const normalizedMode = normalizePrepMode(mode);
    setSelectedPrepMode(normalizedMode);
    setCurrentUser((prev) => prev ? { ...prev, lastPrepMode: normalizedMode } : prev);
    setCurrentView('dashboard');

    if (!currentUser?.id) return;
    try {
      await updateDoc(doc(db, 'users', currentUser.id), { lastPrepMode: normalizedMode });
    } catch (err) {
      console.error('Prep mode save error:', err);
      toast.warning('Prep mode not saved', 'You can continue, but this choice may not be remembered next time.');
    }
  };

  const openPrepFeatureView = (view: 'courses' | 'videos' | 'attendance') => {
    const feature = view === 'courses' ? 'courses' : view === 'videos' ? 'videos' : 'attendance';
    if (!isPrepFeatureEnabled(selectedPrepMode, feature)) {
      toast.info('OAU Prep only', 'Courses, forums, chats, and learning extras are available in OAU Prep.');
      setCurrentView('dashboard');
      return;
    }
    setCurrentView(view);
  };

  useEffect(() => {
    if (!currentUser) return;
    const blocked =
      (currentView === 'courses' && !PREP_MODE_FEATURES[selectedPrepMode].courses)
      || (currentView === 'videos' && !PREP_MODE_FEATURES[selectedPrepMode].videos)
      || (currentView === 'attendance' && !PREP_MODE_FEATURES[selectedPrepMode].attendance);
    if (!blocked) return;
    toast.info('OAU Prep only', 'Courses, forums, chats, and learning extras are available in OAU Prep.');
    setCurrentView('dashboard');
  }, [currentUser, currentView, selectedPrepMode]);

  const handleContinueFree = () => {
    if (typeof window !== 'undefined') {
      const deferUntil = new Date(Date.now() + LICENSE_PROMPT_SNOOZE_HOURS * 60 * 60 * 1000).toISOString();
      window.localStorage.setItem('licensePromptDeferredUntil', deferUntil);
    }
    setShowMonetizationModal(false);
  };

  const activateLicenseKey = async (rawKey: string): Promise<boolean> => {
    if (!currentUser) return false;
    const key = rawKey.trim().toUpperCase();
    if (!key) {
      toast.warning('Missing key', 'Enter your activation key.');
      return false;
    }

    setIsActivatingKey(true);
    try {
      const keyDocRef = doc(db, 'licenseKeys', key);
      const keyDoc = await getDoc(keyDocRef);
      if (!keyDoc.exists()) {
        toast.error('Invalid key', 'Invalid activation key.');
        return false;
      }

      const keyData = keyDoc.data() as any;
      if (keyData?.status !== 'new') {
        toast.error('Invalid key', 'Invalid activation key.');
        return false;
      }
      const alreadyUsed = Boolean(keyData?.isUsed) || keyData?.status === 'used' || Boolean(keyData?.redeemedBy);
      if (alreadyUsed) {
        toast.warning('Key used', 'This activation key has already been used.');
        return false;
      }

      const keyExpiryMs = Date.parse(keyData?.expiresAt || '');
      if (Number.isFinite(keyExpiryMs) && keyExpiryMs < Date.now()) {
        toast.warning('Key expired', 'This activation key has expired.');
        return false;
      }

      const durationDays = Number(keyData?.durationDays) > 0 ? Number(keyData.durationDays) : 365;
      const targetPrepMode = normalizePrepMode(keyData?.prepMode || selectedPrepMode);
      const existingLicense = currentUser.licenses?.[targetPrepMode];
      const currentEndsMs = Date.parse(existingLicense?.endsAt || (targetPrepMode === DEFAULT_PREP_MODE ? currentUser.subscriptionEndsAt || '' : ''));
      const baseMs = Number.isFinite(currentEndsMs) && currentEndsMs > Date.now() ? currentEndsMs : Date.now();
      const nextEndsAt = new Date(baseMs + durationDays * 24 * 60 * 60 * 1000).toISOString();
      const nowIso = new Date().toISOString();
      const licensePatch = {
        status: 'active' as const,
        activatedAt: nowIso,
        endsAt: nextEndsAt,
        key
      };
      const userPatch: Record<string, any> = {
        [`licenses.${targetPrepMode}`]: licensePatch,
        lastPrepMode: targetPrepMode
      };

      if (targetPrepMode === DEFAULT_PREP_MODE) {
        userPatch.subscriptionStatus = 'active';
        userPatch.subscriptionEndsAt = nextEndsAt;
        userPatch.activatedKey = key;
        userPatch.activatedAt = nowIso;
      }

      await updateDoc(doc(db, 'users', currentUser.id), userPatch);

      await updateDoc(keyDocRef, {
        isUsed: true,
        status: 'used',
        prepMode: targetPrepMode,
        redeemedBy: currentUser.id,
        redeemedByEmail: currentUser.email,
        redeemedAt: nowIso
      });

      setSelectedPrepMode(targetPrepMode);
      setCurrentUser(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          lastPrepMode: targetPrepMode,
          licenses: {
            ...(prev.licenses || {}),
            [targetPrepMode]: licensePatch
          },
          ...(targetPrepMode === DEFAULT_PREP_MODE ? { subscriptionStatus: 'active' as const, subscriptionEndsAt: nextEndsAt } : {})
        };
      });
      setShowMonetizationModal(false);
      setIsMonetizationLocked(false);
      toast.success('Activated', `${PREP_MODE_LABELS[targetPrepMode]} license activated successfully.`);
      return true;
    } catch (err) {
      console.error('Activation failed:', err);
      toast.error('Activation failed', 'Please contact admin on WhatsApp.');
      return false;
    } finally {
      setIsActivatingKey(false);
    }
  };

  const handleActivateKey = async () => {
    const activated = await activateLicenseKey(activationKey);
    if (activated) {
      setActivationKey('');
    }
  };

  const handleManualVerifyCheck = async () => {
    if (!auth.currentUser) return;
    setIsLoading(true);
    try {
      await withTimeout(auth.currentUser.reload(), 12000, 'Auth refresh');
      const refreshed = auth.currentUser;
      const isOfficialEmail = refreshed?.email?.toLowerCase().endsWith('@aureusmedicos.com');
      if (!refreshed?.emailVerified && !isOfficialEmail) {
        setIsLoading(false);
        toast.warning('Not verified yet', 'Your email is still unverified. Open the verification link, then try again.');
        return;
      }
      await checkUserStatus(refreshed);
    } catch {
      setIsLoading(false);
      toast.error('Verification check failed', 'Could not refresh your account status right now.');
    }
  };

  const openUpdateManual = () => {
    if (currentView !== 'update-manual') {
      setLastMainView(currentView);
    }
    setCurrentView('update-manual');
  };

  const closeUpdateManual = () => {
    const fallback: ViewState = currentUser ? getDefaultViewForRole(currentUser.role) : 'auth';
    setCurrentView(lastMainView === 'update-manual' ? fallback : lastMainView);
  };

  const needsSocialOnboarding = Boolean(
    currentUser &&
    PREP_MODE_FEATURES[selectedPrepMode].community &&
    isSocialProfileReady &&
    (!currentUser.socialOnboardingCompletedAt || !communityProfile?.onboardingCompletedAt)
  );
  const shouldShowSocialProfilePrompt = needsSocialOnboarding && !isSocialProfileEditorOpen && !isSocialProfilePromptDismissed;

  const handleCreateSocialProfileNow = () => {
    setIsSocialProfileEditorOpen(true);
  };

  const handleCreateSocialProfileLater = () => {
    if (typeof window !== 'undefined' && currentUser?.id) {
      window.localStorage.setItem(getSocialProfilePromptDismissedKey(currentUser.id), 'true');
    }
    setIsSocialProfilePromptDismissed(true);
    toast.info('Profile setup saved for later', 'Open Profile, then Edit Social Profile when you are ready.');
  };

  if (showSplash) {
    return <SplashScreen onDone={() => setShowSplash(false)} />;
  }

  if (isLoading) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-950">
        <img src={logo} className="w-20 h-20 animate-pulse mb-6" alt="Scholar! logo" />
        <div className="flex flex-col items-center">
          <p className="text-amber-500 text-xs font-black uppercase tracking-[0.5em] mb-2">Scholar!</p>
          <div className="w-32 h-1 bg-slate-900 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 w-1/2 animate-shimmer"></div>
          </div>
          <PartnershipLogos className="mt-6" variant="dark" size="compact" />
        </div>
      </div>
    );
  }

  if (packagingState) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-950 p-8 text-center">
        <img src={logo} className="w-16 h-16 animate-pulse mb-6" alt="Scholar! logo" />
        <p className="text-amber-500 text-xs font-black uppercase tracking-[0.4em] mb-4">{packagingState.message}</p>
        <div className="w-64 h-2 bg-slate-900 rounded-full overflow-hidden mb-3">
          <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${packagingState.progress}%` }}></div>
        </div>
        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">{packagingState.progress}%</p>
        <PartnershipLogos className="mt-6" variant="dark" size="compact" />
      </div>
    );
  }

  if (currentView === 'verify-email') {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <img src={logo} className="w-16 h-16 mb-6" alt="Logo" />
        <h2 className="text-2xl font-black text-slate-950 uppercase tracking-tight mb-2">Verify Your Email</h2>
        <PartnershipLogos className="mb-6" size="compact" />
        <p className="text-slate-500 text-sm max-w-sm mb-8 leading-relaxed">
          We sent a verification link to your email. Open it to activate your account, and check spam/junk if you do not see it.
        </p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button onClick={handleManualVerifyCheck} className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase text-xs tracking-widest shadow-lg">I Verified</button>
          <button onClick={() => auth.currentUser && sendEmailVerification(auth.currentUser).then(() => toast.success('Verification email resent'))} className="w-full py-4 bg-white text-slate-600 border border-slate-200 rounded-2xl font-black uppercase text-xs tracking-widest">Resend Link</button>
          <button onClick={() => auth.signOut()} className="mt-4 text-xs font-black text-slate-400 uppercase tracking-widest hover:text-red-500">Log Out</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`v2-app theme-${theme} ui-mode-${uiMode} min-h-[100svh] w-full overflow-x-hidden flex flex-col`}
      style={{ minHeight: 'calc(var(--app-vh, 1vh) * 100)', height: 'calc(var(--app-vh, 1vh) * 100)' }}
    >
      <Suspense
        fallback={
          <div className="h-full w-full flex flex-col items-center justify-center bg-slate-950 p-8 text-center">
            <img src={logo} className="w-16 h-16 animate-pulse mb-6" alt="Scholar! logo" />
            <p className="text-amber-500 text-xs font-black uppercase tracking-[0.4em] mb-2">Loading Screen</p>
            <PartnershipLogos className="mt-5" variant="dark" size="compact" />
          </div>
        }
      >
      {(currentView === 'auth' || (currentView === 'attendance' && !currentUser)) && <Auth onLogin={checkUserStatus} />}
      {currentView === 'prep-selector' && currentUser && (
        <PrepSelector
          selectedPrepMode={selectedPrepMode}
          onSelect={handleSelectPrepMode}
          userName={currentUser.name}
        />
      )}
      {currentView === 'blacklist' && (
        <BlacklistPage
          onOpenAttendance={() => setCurrentView('attendance')}
          onOpenDashboard={currentUser ? () => setCurrentView('dashboard') : undefined}
        />
      )}
      {currentView === 'dashboard' && currentUser && (
        <Dashboard 
          user={currentUser} 
          prepMode={selectedPrepMode}
          onSwitchPrepMode={() => setCurrentView('prep-selector')}
          onLogout={() => auth.signOut()} 
          onStartTest={async (test, options) => {
            if (isReadOnlyForUnactivatedUser(currentUser)) {
              setShowMonetizationModal(true);
              toast.warning('Activation required', 'Activate your license key in Settings before starting a test.');
              return;
            }
            const passwordStatus = verifyTestPassword(test);
            if (passwordStatus !== 'granted') {
              if (passwordStatus === 'incorrect') {
                toast.error('Access denied', 'Incorrect test password.');
              }
              return;
            }
            try {
              setActiveQuizMode(Boolean(options?.quizMode));
              await startExamWithPackaging(test, currentUser);
            } catch (err: any) {
              setActiveQuizMode(false);
              console.error('Test packaging error:', err);
              toast.error('Preparation failed', err?.message || 'Unable to prepare this test right now.');
            }
          }}
          onReviewResult={(result) => {
            if (isReadOnlyForUnactivatedUser(currentUser)) {
              setShowMonetizationModal(true);
              toast.warning('Activation required', 'Activate your license key in Settings before opening review.');
              return;
            }
            setReviewResult(result);
            setCurrentView('review');
          }}
          onReturnToAdmin={() => setCurrentView(currentUser.role === 'root-admin' ? 'root-admin' : 'admin')}
          onOpenCourses={() => openPrepFeatureView('courses')}
          onOpenVideos={() => openPrepFeatureView('videos')}
          onSaveOfflineTest={saveTestForOffline}
          isReadOnly={isReadOnlyForUnactivatedUser(currentUser)}
          deadlineLabel={deadlineLabel}
          isActivatingLicense={isActivatingKey}
          currentTheme={theme}
          onThemeChange={setTheme}
          customTheme={customTheme}
          onCustomThemeChange={setCustomTheme}
          onActivateLicense={async (key) => {
            const activated = await activateLicenseKey(key);
            if (activated) {
              setActivationKey('');
            }
          }}
          onOpenActivationSupport={handleOpenWhatsApp}
          onOpenUpdateManual={openUpdateManual}
          currentUiMode={uiMode}
          onUiModeChange={setUiMode}
          onUserProfileUpdate={(patch) => setCurrentUser((prev) => (prev ? { ...prev, ...patch } : prev))}
          onOpenSocialProfileSetup={() => setIsSocialProfileEditorOpen(true)}
        />
      )}
      {currentView === 'attendance' && currentUser && (
        <AttendancePortal
          user={currentUser}
          onLogout={() => auth.signOut()}
          onOpenBlacklist={() => setCurrentView('blacklist')}
          onOpenDashboard={() => setCurrentView('dashboard')}
        />
      )}
      {currentView === 'courses' && currentUser && (
        <CoursesHub
          user={currentUser}
          isReadOnly={isReadOnlyForUnactivatedUser(currentUser)}
          onBack={() => setCurrentView('dashboard')}
        />
      )}
      {currentView === 'videos' && currentUser && (
        <VideoLearningHub
          user={currentUser}
          isReadOnly={isReadOnlyForUnactivatedUser(currentUser)}
          onBack={() => setCurrentView('dashboard')}
        />
      )}
      {currentView === 'admin' && currentUser && (
        <AdminDashboard 
          user={currentUser} 
          initialTab={adminDefaultTab as any}
          onLogout={() => auth.signOut()} 
          onSwitchToStudent={() => setCurrentView('dashboard')}
          onOpenCourses={() => openPrepFeatureView('courses')}
        />
      )}
      {currentView === 'root-admin' && currentUser && (
        <RootAdminDashboard 
          user={currentUser} 
          onLogout={() => auth.signOut()} 
          onSwitchToStudent={() => setCurrentView('dashboard')}
          onSwitchToAdmin={() => { setAdminDefaultTab('questions'); setCurrentView('admin'); }}
          onGoToImport={() => { setAdminDefaultTab('import'); setCurrentView('admin'); }}
          onGoToAnalytics={() => { setAdminDefaultTab('analytics'); setCurrentView('admin'); }}
        />
      )}
      {currentView === 'exam' && activeTest && currentUser && (
        <ExamInterface 
          test={activeTest} 
          user={currentUser}
          instantFeedback={activeQuizMode}
          resolvedSections={activeResolvedSections || undefined}
          attemptId={activeAttemptId || undefined}
          packagedQuestions={packagedQuestions || undefined}
          onFinish={(res) => { setRecentResult(res); setPackagedQuestions(null); setActiveResolvedSections(null); setActiveAttemptId(null); setActiveQuizMode(false); setCurrentView('results'); }}
          onExit={() => { setPackagedQuestions(null); setActiveResolvedSections(null); setActiveAttemptId(null); setActiveQuizMode(false); setCurrentView('dashboard'); }}
        />
      )}
      {currentView === 'results' && recentResult && (
        <ResultScreen result={recentResult} onClose={() => setCurrentView('dashboard')} onReview={() => { setReviewResult(recentResult); setCurrentView('review'); }} />
      )}
      {currentView === 'review' && reviewResult && (
        <ReviewInterface result={reviewResult} onExit={() => setCurrentView('dashboard')} />
      )}
      {currentView === 'update-manual' && (
        <UpdateManual version={UPDATE_MANUAL_VERSION} onClose={closeUpdateManual} />
      )}
      {showMonetizationModal && (
        <MonetizationModal
          mode={monetizationMode}
          isLocked={isMonetizationLocked}
          productLabel={PREP_MODE_LABELS[selectedPrepMode]}
          deadlineLabel={deadlineLabel}
          activationKey={activationKey}
          onActivationKeyChange={setActivationKey}
          onActivateKey={handleActivateKey}
          isActivatingKey={isActivatingKey}
          onOpenWhatsApp={handleOpenWhatsApp}
          onContinueFree={monetizationMode === 'pre-deadline' ? handleContinueFree : undefined}
          onClose={monetizationMode === 'post-deadline' && !isMonetizationLocked ? () => setShowMonetizationModal(false) : undefined}
          onLogout={isMonetizationLocked ? () => auth.signOut() : undefined}
        />
      )}
      {broadcastToasts.length > 0 && (
        <div className="fixed right-4 top-4 z-[210] space-y-2 w-[min(360px,calc(100vw-2rem))]">
          {broadcastToasts.map((toast) => (
            <button
              key={toast.id}
              type="button"
              onClick={() => setBroadcastToasts((prev) => prev.filter((item) => item.id !== toast.id))}
              className="w-full text-left bg-white border border-slate-200 shadow-xl rounded-2xl p-4"
            >
              <p className="text-xs font-black uppercase tracking-widest text-amber-700 mb-1">{toast.title}</p>
              <p className="text-xs text-slate-700">{toast.message}</p>
            </button>
          ))}
        </div>
      )}
      {currentUser && shouldShowSocialProfilePrompt && (
        <SocialProfilePrompt
          onCreateNow={handleCreateSocialProfileNow}
          onCreateLater={handleCreateSocialProfileLater}
        />
      )}
      {currentUser && isSocialProfileEditorOpen && (
        <SocialProfileOnboarding
          user={currentUser}
          initialProfile={communityProfile}
          canClose
          onClose={() => setIsSocialProfileEditorOpen(false)}
          onComplete={({ userPatch, profile }) => {
            setCurrentUser((prev) => prev ? { ...prev, ...userPatch } : prev);
            setCommunityProfile(profile);
            setIsSocialProfileEditorOpen(false);
            setIsSocialProfilePromptDismissed(true);
          }}
        />
      )}
      </Suspense>
    </div>
  );
};

export default App;

