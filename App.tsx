
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User, MockTest, ExamResult, Question, TestSection, TestAttempt, DifficultyLevel, SharedQuiz, ViewState, BroadcastNotification, CustomThemeConfig } from './types';
import { auth, db } from './firebase';
import { onAuthStateChanged, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, getDoc, getDocFromServer, collection, getDocs, query, where, limit, documentId, updateDoc, addDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import AdminDashboard from './components/AdminDashboard';
import RootAdminDashboard from './components/RootAdminDashboard';
import ExamInterface from './components/ExamInterface';
import ResultScreen from './components/ResultScreen';
import ReviewInterface from './components/ReviewInterface';
import UpdateManual from './components/UpdateManual';
import logo from './assets/logo.png';
import { AppTheme } from './theme';
import { clearGlassAccent, syncGlassAccent } from './glassAccent';

const DEFAULT_FREE_ACCESS_ENDS_AT_ISO = '2026-04-01T23:00:00.000Z'; // April 2, 2026 00:00 WAT
const DEADLINE_CONFIG_DOC_ID = 'deadline_config';
const LICENSE_PROMPT_SNOOZE_HOURS = 24;
const WHATSAPP_PHONE = '2348145807650';
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent('Hello, I want to purchase my CBT annual license key.')}`;
const OFFLINE_PACKAGE_KEY_PREFIX = 'testpkg:offline:';
const PENDING_RESULTS_QUEUE_KEY = 'pendingResultsQueue';
const QUESTION_FETCH_LIMIT = 3000;
const APP_THEME_STORAGE_KEY = 'appTheme';
const APP_CUSTOM_THEME_STORAGE_KEY = 'appThemeCustom';
const APP_THEME_LAST_USED_KEY = 'appTheme:lastUsed';
const BROADCAST_NOTIFICATIONS_SEEN_AT_PREFIX = 'broadcastSeenAt';

type MonetizationMode = 'pre-deadline' | 'post-deadline';

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

const sanitizeHex = (value: string, fallback: string) => {
  const v = String(value || '').trim();
  return /^#([0-9a-fA-F]{6})$/.test(v) ? v : fallback;
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

interface MonetizationModalProps {
  mode: MonetizationMode;
  isLocked: boolean;
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
          <p className="text-amber-500 text-[10px] font-black uppercase tracking-[0.3em] mb-2">Platform Update</p>
          <h2 className="text-white text-xl font-black uppercase tracking-tight">
            {isPreDeadline ? 'Free Access Is Ending Soon' : 'Free Access Has Ended'}
          </h2>
        </div>
        <div className="v2-scroll p-6 sm:p-8 space-y-5">
          {isPreDeadline ? (
            <p className="text-slate-600 text-sm leading-relaxed">
              This CBT platform has been running on free resources. To keep service stable for growing usage, free access
              ends on <strong>{deadlineLabel}</strong>. Buy your annual activation key before this date to
              avoid interruption.
            </p>
          ) : (
            <p className="text-slate-600 text-sm leading-relaxed">
              Free access ended on <strong>{deadlineLabel}</strong>. To continue using the CBT simulator,
              activate your annual license key.
            </p>
          )}

          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Activation Key</p>
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
                className="px-5 py-3 bg-slate-950 text-amber-500 rounded-xl font-black uppercase text-[10px] tracking-widest disabled:opacity-40"
              >
                {isActivatingKey ? 'Activating...' : 'Activate'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={onOpenWhatsApp}
              className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg"
            >
              DM +2348145807650
            </button>
            {isPreDeadline && onContinueFree && (
              <button
                onClick={onContinueFree}
                className="w-full py-4 bg-white text-slate-600 border border-slate-200 rounded-2xl font-black uppercase text-[10px] tracking-widest"
              >
                Continue Free For Now
              </button>
            )}
          </div>

          {!isLocked && onClose && (
            <button
              onClick={onClose}
              className="w-full py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600"
            >
              Continue
            </button>
          )}

          {isLocked && onLogout && (
            <button
              onClick={onLogout}
              className="w-full py-3 text-[10px] font-black text-red-500 uppercase tracking-widest hover:text-red-600"
            >
              Log Out
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  type ContextMenuState = {
    x: number;
    y: number;
    selectedText: string;
  } | null;

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<ViewState>('auth');
  const [lastMainView, setLastMainView] = useState<ViewState>('dashboard');
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
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState>(null);
  const [isDesktopRightClickEnabled, setIsDesktopRightClickEnabled] = useState(false);
  const [theme, setTheme] = useState<AppTheme>('classic');
  const [customTheme, setCustomTheme] = useState<CustomThemeConfig>(DEFAULT_CUSTOM_THEME);
  const [broadcastToasts, setBroadcastToasts] = useState<Array<{ id: string; title: string; message: string }>>([]);
  const isFlushingQueueRef = useRef(false);

  const getDefaultViewForRole = (role: User['role']) => {
    if (role === 'root-admin') return 'root-admin';
    if (role === 'admin') return 'admin';
    return 'dashboard';
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

  const isReadOnlyForUnactivatedUser = (user: User | null) => {
    if (!user) return false;
    if (isStaffUser(user) || hasActiveSubscription(user)) return false;
    const deadlineMs = Date.parse(freeAccessEndsAtIso);
    return Number.isFinite(deadlineMs) && Date.now() > deadlineMs;
  };

  const checkDesktopRightClickSupport = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const hasFinePointer = window.matchMedia?.('(pointer: fine)').matches ?? false;
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isMobileUa = /android|iphone|ipad|ipod|mobile/i.test(userAgent);
    const mobileByViewport = window.innerWidth < 820;
    return hasFinePointer && !isMobileUa && !mobileByViewport;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refreshSupport = () => setIsDesktopRightClickEnabled(checkDesktopRightClickSupport());
    refreshSupport();
    window.addEventListener('resize', refreshSupport);
    return () => window.removeEventListener('resize', refreshSupport);
  }, [checkDesktopRightClickSupport]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const closeMenu = () => setContextMenuState(null);

    const onContextMenu = (event: MouseEvent) => {
      if (!isDesktopRightClickEnabled) return;
      event.preventDefault();
      const selectedText = (window.getSelection?.()?.toString() || '').trim();
      const menuWidth = 280;
      const menuHeight = 280;
      const x = Math.min(event.clientX, Math.max(12, window.innerWidth - menuWidth - 12));
      const y = Math.min(event.clientY, Math.max(12, window.innerHeight - menuHeight - 12));
      setContextMenuState({ x: Math.max(12, x), y: Math.max(12, y), selectedText });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('click', closeMenu);
    document.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isDesktopRightClickEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!currentUser?.id) {
      const lastTheme = window.localStorage.getItem(APP_THEME_LAST_USED_KEY);
      setTheme(isValidAppTheme(lastTheme) ? lastTheme : 'classic');
      setCustomTheme(DEFAULT_CUSTOM_THEME);
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

  const runContextAction = async (action: 'copy' | 'paste' | 'reload' | 'back' | 'forward' | 'top' | 'fullscreen') => {
    setContextMenuState(null);
    if (typeof window === 'undefined') return;

    if (action === 'reload') {
      window.location.reload();
      return;
    }
    if (action === 'back') {
      window.history.back();
      return;
    }
    if (action === 'forward') {
      window.history.forward();
      return;
    }
    if (action === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (action === 'fullscreen') {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
      return;
    }
    if (action === 'copy') {
      const text = contextMenuState?.selectedText || window.location.href;
      try {
        await navigator.clipboard?.writeText(text);
      } catch {
        if (document.execCommand) document.execCommand('copy');
      }
      return;
    }
    if (action === 'paste') {
      const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
      const isEditable =
        active &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (!isEditable) return;
      try {
        const clip = await navigator.clipboard?.readText();
        if (typeof clip !== 'string') return;
        if (active.isContentEditable) {
          document.execCommand('insertText', false, clip);
        } else {
          const input = active as HTMLInputElement | HTMLTextAreaElement;
          const start = input.selectionStart ?? input.value.length;
          const end = input.selectionEnd ?? input.value.length;
          input.value = `${input.value.slice(0, start)}${clip}${input.value.slice(end)}`;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch {
        // Clipboard read may be blocked by browser permissions.
      }
    }
  };

  const renderDesktopContextMenu = () => {
    if (!isDesktopRightClickEnabled || !contextMenuState) return null;
    return (
      <div
        className="desktop-context-menu"
        style={{ top: contextMenuState.y, left: contextMenuState.x }}
        role="menu"
        aria-label="Page actions"
      >
        <p className="desktop-context-title">Quick Actions</p>
        <button type="button" onClick={() => runContextAction('copy')}>
          {contextMenuState.selectedText ? 'Copy Selection' : 'Copy Page Link'}
        </button>
        <button type="button" onClick={() => runContextAction('paste')}>Paste</button>
        <button type="button" onClick={() => runContextAction('reload')}>Reload</button>
        <button type="button" onClick={() => runContextAction('back')}>Back</button>
        <button type="button" onClick={() => runContextAction('forward')}>Forward</button>
        <button type="button" onClick={() => runContextAction('top')}>Scroll To Top</button>
        <button type="button" onClick={() => runContextAction('fullscreen')}>Toggle Fullscreen</button>
      </div>
    );
  };

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
      const offlineRaw = window.localStorage.getItem(`${OFFLINE_PACKAGE_KEY_PREFIX}${test.id}`);
      if (!offlineRaw) return null;
      const offlineParsed = JSON.parse(offlineRaw) as { signature: string; questions: Record<string, Question> };
      if (offlineParsed.signature !== getPackageSignature(test, sections)) return null;
      return offlineParsed.questions || null;
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
        JSON.stringify({ signature: getPackageSignature(test, sections), questions, createdAt: Date.now() })
      );
    } catch {
      alert('Could not save this test for offline use on this device.');
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

  const generateDynamicAttempt = async (test: MockTest, userObj: User) => {
    const attemptsSnap = await getDocs(
      query(collection(db, 'results'), where('userId', '==', userObj.id), where('testId', '==', test.id), limit(200))
    );
    const attemptNo = attemptsSnap.size + 1;
    const seed = hashStringToSeed(`${userObj.id}:${test.id}:${attemptNo}`);
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
      if (isDynamicGenerationMode(test.generationMode)) {
        const generated = await generateDynamicAttempt(test, userObj);
        sectionsToUse = generated.sections;
        attemptId = generated.attemptId;
      }

      const pkg = await packageQuestionsForTest(test, sectionsToUse);
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
    if (isDynamicGenerationMode(test.generationMode)) {
      alert('Dynamic tests are generated per attempt and cannot be saved offline as a single fixed package.');
      return;
    }
    try {
      const pkg = await packageQuestionsForTest(test, test.sections);
      setOfflinePackage(test, test.sections, pkg);
      alert(`"${test.name}" saved for offline use on this device.`);
    } catch (err: any) {
      alert(err?.message || 'Could not save this test offline right now.');
    }
  };

  const tryStartTestFromLink = async (userObj: User, testId: string): Promise<boolean> => {
    if (isReadOnlyForUnactivatedUser(userObj)) {
      alert('Activate your license key to open shared tests.');
      setShowMonetizationModal(true);
      clearLinkedTestId();
      return false;
    }
    try {
      const testDoc = await getDocFromServer(doc(db, 'tests', testId));
      if (!testDoc.exists()) {
        alert('This test link is invalid or no longer available.');
        clearLinkedTestId();
        return false;
      }

      const test = { ...testDoc.data(), id: testDoc.id } as MockTest & { isPaused?: boolean };
      if (!test.isApproved || test.isPaused) {
        alert('This test is currently unavailable.');
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
        alert('You cannot take this test again.');
        clearLinkedTestId();
        return false;
      }

      setActiveQuizMode(false);
      await startExamWithPackaging(test, userObj);
      clearLinkedTestId();
      return true;
    } catch (err) {
      console.error('Linked test open error:', err);
      alert('Unable to open this shared test right now.');
      clearLinkedTestId();
      return false;
    }
  };

  const tryStartQuizFromLink = async (userObj: User, quizId: string): Promise<boolean> => {
    if (isReadOnlyForUnactivatedUser(userObj)) {
      alert('Activate your license key to open shared quizzes.');
      setShowMonetizationModal(true);
      clearLinkedQuizId();
      return false;
    }
    try {
      const quizDoc = await getDocFromServer(doc(db, 'quizzes', quizId));
      if (!quizDoc.exists()) {
        alert('This quiz link is invalid or no longer available.');
        clearLinkedQuizId();
        return false;
      }

      const quiz = { ...quizDoc.data(), id: quizDoc.id } as SharedQuiz;
      if (!quiz.isActive) {
        alert('This quiz is currently unavailable.');
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
        alert('You cannot take this quiz again.');
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
      alert('Unable to open this shared quiz right now.');
      clearLinkedQuizId();
      return false;
    }
  };

  const checkUserStatus = async (firebaseUser: any) => {
    try {
      await firebaseUser.reload();
      const updatedUser = auth.currentUser;
      if (!updatedUser) {
        setIsLoading(false);
        return;
      }

      const userDoc = await getDoc(doc(db, 'users', updatedUser.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data() as User;
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

        const userObj = { ...userData, id: updatedUser.uid, emailVerified: isVerifiedForAccess };
        setCurrentUser(userObj);

        const linkedTestId = getLinkedTestId();
        const linkedQuizId = getLinkedQuizId();
        if (linkedTestId) {
          const started = await tryStartTestFromLink(userObj, linkedTestId);
          if (!started) {
            setCurrentView(getDefaultViewForRole(userData.role));
          }
        } else if (linkedQuizId) {
          const started = await tryStartQuizFromLink(userObj, linkedQuizId);
          if (!started) {
            setCurrentView(getDefaultViewForRole(userData.role));
          }
        } else {
          setCurrentView(getDefaultViewForRole(userData.role));
        }
      } else {
        setCurrentUser(null);
        setCurrentView('auth');
      }
    } catch (error) {
      console.error("Account check error:", error);
      setCurrentView('auth');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        await checkUserStatus(firebaseUser);
        try {
          const configSnap = await getDoc(doc(db, 'licenseKeys', DEADLINE_CONFIG_DOC_ID));
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
        setCurrentView('auth');
        setIsLoading(false);
        setFreeAccessEndsAtIso(DEFAULT_FREE_ACCESS_ENDS_AT_ISO);
      }
    });
    return () => unsubscribe();
  }, []);

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
          await addDoc(collection(db, 'results'), item.payload);
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

    const now = Date.now();
    const deadlineMs = Date.parse(freeAccessEndsAtIso);
    const isAfterDeadline = Number.isFinite(deadlineMs) && now > deadlineMs;
    const staff = isStaffUser(currentUser);
    const paid = hasActiveSubscription(currentUser);

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
  }, [currentUser, isLoading, freeAccessEndsAtIso]);

  const handleOpenWhatsApp = () => {
    window.open(WHATSAPP_URL, '_blank', 'noopener,noreferrer');
  };

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
      alert('Enter your activation key.');
      return false;
    }

    setIsActivatingKey(true);
    try {
      const keyDocRef = doc(db, 'licenseKeys', key);
      const keyDoc = await getDoc(keyDocRef);
      if (!keyDoc.exists()) {
        alert('Invalid activation key.');
        return false;
      }

      const keyData = keyDoc.data() as any;
      if (keyData?.status !== 'new') {
        alert('Invalid activation key.');
        return false;
      }
      const alreadyUsed = Boolean(keyData?.isUsed) || keyData?.status === 'used' || Boolean(keyData?.redeemedBy);
      if (alreadyUsed) {
        alert('This activation key has already been used.');
        return false;
      }

      const keyExpiryMs = Date.parse(keyData?.expiresAt || '');
      if (Number.isFinite(keyExpiryMs) && keyExpiryMs < Date.now()) {
        alert('This activation key has expired.');
        return false;
      }

      const durationDays = Number(keyData?.durationDays) > 0 ? Number(keyData.durationDays) : 365;
      const currentEndsMs = Date.parse(currentUser.subscriptionEndsAt || '');
      const baseMs = Number.isFinite(currentEndsMs) && currentEndsMs > Date.now() ? currentEndsMs : Date.now();
      const nextEndsAt = new Date(baseMs + durationDays * 24 * 60 * 60 * 1000).toISOString();
      const nowIso = new Date().toISOString();

      await updateDoc(doc(db, 'users', currentUser.id), {
        subscriptionStatus: 'active',
        subscriptionEndsAt: nextEndsAt,
        activatedKey: key,
        activatedAt: nowIso
      });

      await updateDoc(keyDocRef, {
        isUsed: true,
        status: 'used',
        redeemedBy: currentUser.id,
        redeemedByEmail: currentUser.email,
        redeemedAt: nowIso
      });

      setCurrentUser(prev => (prev ? { ...prev, subscriptionStatus: 'active', subscriptionEndsAt: nextEndsAt } : prev));
      setShowMonetizationModal(false);
      setIsMonetizationLocked(false);
      alert('License activated successfully.');
      return true;
    } catch (err) {
      console.error('Activation failed:', err);
      alert('Activation failed. Please contact admin on WhatsApp.');
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
    if (auth.currentUser) {
      setIsLoading(true);
      await checkUserStatus(auth.currentUser);
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

  if (isLoading) {
    return (
      <>
        <div className="h-full w-full flex flex-col items-center justify-center bg-slate-950">
          <img src={logo} className="w-20 h-20 animate-pulse mb-6" alt="Aureus Medicos CBT Logo" />
          <div className="flex flex-col items-center">
            <p className="text-amber-500 text-[10px] font-black uppercase tracking-[0.5em] mb-2">Aureus Medicos CBT</p>
            <div className="w-32 h-1 bg-slate-900 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 w-1/2 animate-shimmer"></div>
            </div>
          </div>
        </div>
        {renderDesktopContextMenu()}
      </>
    );
  }

  if (packagingState) {
    return (
      <>
        <div className="h-full w-full flex flex-col items-center justify-center bg-slate-950 p-8 text-center">
          <img src={logo} className="w-16 h-16 animate-pulse mb-6" alt="Aureus Medicos CBT Logo" />
          <p className="text-amber-500 text-[10px] font-black uppercase tracking-[0.4em] mb-4">{packagingState.message}</p>
          <div className="w-64 h-2 bg-slate-900 rounded-full overflow-hidden mb-3">
            <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${packagingState.progress}%` }}></div>
          </div>
          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">{packagingState.progress}%</p>
        </div>
        {renderDesktopContextMenu()}
      </>
    );
  }

  if (currentView === 'verify-email') {
    return (
      <>
        <div className="h-full w-full flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
          <img src={logo} className="w-16 h-16 mb-6" alt="Logo" />
          <h2 className="text-2xl font-black text-slate-950 uppercase tracking-tight mb-2">Verify Your Email</h2>
          <p className="text-slate-500 text-sm max-w-sm mb-8 leading-relaxed">
            We sent a verification link to your email. Open it to activate your account, and check spam/junk if you do not see it.
          </p>
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button onClick={handleManualVerifyCheck} className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg">I Verified</button>
            <button onClick={() => auth.currentUser && sendEmailVerification(auth.currentUser).then(() => alert('Verification email resent!'))} className="w-full py-4 bg-white text-slate-600 border border-slate-200 rounded-2xl font-black uppercase text-[10px] tracking-widest">Resend Link</button>
            <button onClick={() => auth.signOut()} className="mt-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-red-500">Log Out</button>
          </div>
        </div>
        {renderDesktopContextMenu()}
      </>
    );
  }

  return (
    <div className={`v2-app theme-${theme} min-h-[100dvh] h-[100dvh] w-full overflow-x-hidden flex flex-col`}>
      {currentView === 'auth' && <Auth onLogin={checkUserStatus} />}
      {currentView === 'dashboard' && currentUser && (
        <Dashboard 
          user={currentUser} 
          onLogout={() => auth.signOut()} 
          onStartTest={async (test, options) => {
            if (isReadOnlyForUnactivatedUser(currentUser)) {
              setShowMonetizationModal(true);
              alert('Activate your license key in Settings before starting a test.');
              return;
            }
            try {
              setActiveQuizMode(Boolean(options?.quizMode));
              await startExamWithPackaging(test, currentUser);
            } catch (err: any) {
              setActiveQuizMode(false);
              console.error('Test packaging error:', err);
              alert(err?.message || 'Unable to prepare this test right now.');
            }
          }}
          onReviewResult={(result) => {
            if (isReadOnlyForUnactivatedUser(currentUser)) {
              setShowMonetizationModal(true);
              alert('Activate your license key in Settings before opening review.');
              return;
            }
            setReviewResult(result);
            setCurrentView('review');
          }}
          onReturnToAdmin={() => setCurrentView(currentUser.role === 'root-admin' ? 'root-admin' : 'admin')}
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
        />
      )}
      {currentView === 'admin' && currentUser && (
        <AdminDashboard 
          user={currentUser} 
          initialTab={adminDefaultTab as any}
          onLogout={() => auth.signOut()} 
          onSwitchToStudent={() => setCurrentView('dashboard')}
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
        <UpdateManual onClose={closeUpdateManual} />
      )}
      {showMonetizationModal && (
        <MonetizationModal
          mode={monetizationMode}
          isLocked={isMonetizationLocked}
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
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-1">{toast.title}</p>
              <p className="text-xs text-slate-700">{toast.message}</p>
            </button>
          ))}
        </div>
      )}
      {renderDesktopContextMenu()}
    </div>
  );
};

export default App;
