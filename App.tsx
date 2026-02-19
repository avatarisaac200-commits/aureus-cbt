
import React, { useState, useEffect } from 'react';
import { User, MockTest, ExamResult, Question } from './types';
import { auth, db } from './firebase';
import { onAuthStateChanged, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, getDoc, collection, getDocs, query, where, limit, documentId, updateDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import AdminDashboard from './components/AdminDashboard';
import RootAdminDashboard from './components/RootAdminDashboard';
import ExamInterface from './components/ExamInterface';
import ResultScreen from './components/ResultScreen';
import ReviewInterface from './components/ReviewInterface';
import logo from './assets/logo.png';

const DEFAULT_FREE_ACCESS_ENDS_AT_ISO = '2026-04-01T23:00:00.000Z'; // April 2, 2026 00:00 WAT
const DEADLINE_CONFIG_DOC_ID = '__deadline_config__';
const LICENSE_PROMPT_SNOOZE_HOURS = 24;
const WHATSAPP_PHONE = '2348145807650';
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent('Hello, I want to purchase my CBT annual license key.')}`;

type MonetizationMode = 'pre-deadline' | 'post-deadline';

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
    <div className="fixed inset-0 z-[200] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 paywall-backdrop">
      <div className="relative w-full max-w-xl bg-white rounded-[2rem] border border-slate-100 shadow-2xl overflow-hidden paywall-card">
        <div className="absolute -top-5 -left-4 w-8 h-8 bg-amber-300/70 rounded-full blur-sm paywall-float"></div>
        <div className="absolute -bottom-4 -right-3 w-7 h-7 bg-emerald-300/60 rounded-full blur-sm paywall-float-alt"></div>
        <div className="bg-slate-950 border-b-4 border-amber-500 px-8 py-7">
          <p className="text-amber-500 text-[10px] font-black uppercase tracking-[0.3em] mb-2">Platform Update</p>
          <h2 className="text-white text-xl font-black uppercase tracking-tight">
            {isPreDeadline ? 'Free Access Is Ending Soon' : 'Free Access Has Ended'}
          </h2>
        </div>
        <div className="p-8 space-y-5">
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
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState('auth');
  const [adminDefaultTab, setAdminDefaultTab] = useState<string>('questions');
  const [activeTest, setActiveTest] = useState<MockTest | null>(null);
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

  const getDefaultViewForRole = (role: User['role']) => {
    if (role === 'root-admin') return 'root-admin';
    if (role === 'admin') return 'admin';
    return 'dashboard';
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

  const clearLinkedTestId = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem('linkedTestId');
    if (window.location.pathname.startsWith('/test/')) {
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

  const getPackageSignature = (test: MockTest) => {
    const ids = Array.from(new Set(test.sections.flatMap(section => section.questionIds))).sort();
    return `${ids.length}:${ids.join('|')}`;
  };

  const getCachedPackage = (test: MockTest): Record<string, Question> | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(`testpkg:${test.id}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { signature: string; questions: Record<string, Question> };
      if (parsed.signature !== getPackageSignature(test)) return null;
      return parsed.questions || null;
    } catch {
      return null;
    }
  };

  const setCachedPackage = (test: MockTest, questions: Record<string, Question>) => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(
        `testpkg:${test.id}`,
        JSON.stringify({ signature: getPackageSignature(test), questions, createdAt: Date.now() })
      );
    } catch {
      // Ignore cache write failures (quota/private mode restrictions).
    }
  };

  const packageQuestionsForTest = async (test: MockTest): Promise<Record<string, Question>> => {
    const cached = getCachedPackage(test);
    if (cached && Object.keys(cached).length > 0) {
      return cached;
    }

    const ids = Array.from(new Set(test.sections.flatMap(section => section.questionIds)));
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
    setCachedPackage(test, map);
    return map;
  };

  const startExamWithPackaging = async (test: MockTest) => {
    setPackagedQuestions(null);
    setPackagingState({ message: 'Questions are being packaged...', progress: 0 });
    try {
      const pkg = await packageQuestionsForTest(test);
      setPackagedQuestions(pkg);
      setActiveTest(test);
      setCurrentView('exam');
    } finally {
      setPackagingState(null);
    }
  };

  const tryStartTestFromLink = async (userObj: User, testId: string): Promise<boolean> => {
    try {
      const testDoc = await getDoc(doc(db, 'tests', testId));
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

      await startExamWithPackaging(test);
      clearLinkedTestId();
      return true;
    } catch (err) {
      console.error('Linked test open error:', err);
      alert('Unable to open this shared test right now.');
      clearLinkedTestId();
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

      const isOfficialEmail = updatedUser.email?.toLowerCase().endsWith('@aureusmedicos.com');

      if (!updatedUser.emailVerified && !isOfficialEmail) {
        setCurrentView('verify-email');
        setIsLoading(false);
        return;
      }

      const userDoc = await getDoc(doc(db, 'users', updatedUser.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data() as User;
        const userObj = { ...userData, id: updatedUser.uid };
        setCurrentUser(userObj);

        const linkedTestId = getLinkedTestId();
        if (linkedTestId) {
          const started = await tryStartTestFromLink(userObj, linkedTestId);
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
        setIsMonetizationLocked(true);
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

  const handleActivateKey = async () => {
    if (!currentUser) return;
    const key = activationKey.trim().toUpperCase();
    if (!key) {
      alert('Enter your activation key.');
      return;
    }

    setIsActivatingKey(true);
    try {
      const keyDocRef = doc(db, 'licenseKeys', key);
      const keyDoc = await getDoc(keyDocRef);
      if (!keyDoc.exists()) {
        alert('Invalid activation key.');
        return;
      }

      const keyData = keyDoc.data() as any;
      if (keyData?.status !== 'new') {
        alert('Invalid activation key.');
        return;
      }
      const alreadyUsed = Boolean(keyData?.isUsed) || keyData?.status === 'used' || Boolean(keyData?.redeemedBy);
      if (alreadyUsed) {
        alert('This activation key has already been used.');
        return;
      }

      const keyExpiryMs = Date.parse(keyData?.expiresAt || '');
      if (Number.isFinite(keyExpiryMs) && keyExpiryMs < Date.now()) {
        alert('This activation key has expired.');
        return;
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
      setActivationKey('');
      setShowMonetizationModal(false);
      setIsMonetizationLocked(false);
      alert('License activated successfully.');
    } catch (err) {
      console.error('Activation failed:', err);
      alert('Activation failed. Please contact admin on WhatsApp.');
    } finally {
      setIsActivatingKey(false);
    }
  };

  const handleManualVerifyCheck = async () => {
    if (auth.currentUser) {
      setIsLoading(true);
      await checkUserStatus(auth.currentUser);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-950">
        <img src={logo} className="w-20 h-20 animate-pulse mb-6" alt="Aureus Medicos CBT Logo" />
        <div className="flex flex-col items-center">
          <p className="text-amber-500 text-[10px] font-black uppercase tracking-[0.5em] mb-2">Aureus Medicos CBT</p>
          <div className="w-32 h-1 bg-slate-900 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 w-1/2 animate-shimmer"></div>
          </div>
        </div>
      </div>
    );
  }

  if (packagingState) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-950 p-8 text-center">
        <img src={logo} className="w-16 h-16 animate-pulse mb-6" alt="Aureus Medicos CBT Logo" />
        <p className="text-amber-500 text-[10px] font-black uppercase tracking-[0.4em] mb-4">{packagingState.message}</p>
        <div className="w-64 h-2 bg-slate-900 rounded-full overflow-hidden mb-3">
          <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${packagingState.progress}%` }}></div>
        </div>
        <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">{packagingState.progress}%</p>
      </div>
    );
  }

  if (currentView === 'verify-email') {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <img src={logo} className="w-16 h-16 mb-6" alt="Logo" />
        <h2 className="text-2xl font-black text-slate-950 uppercase tracking-tight mb-2">Verify Your Email</h2>
        <p className="text-slate-500 text-sm max-w-sm mb-8 leading-relaxed">
          We sent a verification link to your email. Open it to activate your account.
        </p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button onClick={handleManualVerifyCheck} className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg">I Verified</button>
          <button onClick={() => auth.currentUser && sendEmailVerification(auth.currentUser).then(() => alert('Verification email resent!'))} className="w-full py-4 bg-white text-slate-600 border border-slate-200 rounded-2xl font-black uppercase text-[10px] tracking-widest">Resend Link</button>
          <button onClick={() => auth.signOut()} className="mt-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-red-500">Log Out</button>
        </div>
      </div>
    );
  }

  const isAuthLikeView = currentView === 'auth' || currentView === 'verify-email';

  return (
    <div className={isAuthLikeView ? 'min-h-[100dvh] w-full overflow-x-hidden flex flex-col' : 'h-[100dvh] w-full overflow-hidden flex flex-col'}>
      {currentView === 'auth' && <Auth onLogin={checkUserStatus} />}
      {currentView === 'dashboard' && currentUser && (
        <Dashboard 
          user={currentUser} 
          onLogout={() => auth.signOut()} 
          onStartTest={async (test) => {
            try {
              await startExamWithPackaging(test);
            } catch (err: any) {
              console.error('Test packaging error:', err);
              alert(err?.message || 'Unable to prepare this test right now.');
            }
          }}
          onReviewResult={(result) => { setReviewResult(result); setCurrentView('review'); }}
          onReturnToAdmin={() => setCurrentView(currentUser.role === 'root-admin' ? 'root-admin' : 'admin')}
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
          packagedQuestions={packagedQuestions || undefined}
          onFinish={(res) => { setRecentResult(res); setPackagedQuestions(null); setCurrentView('results'); }}
          onExit={() => { setPackagedQuestions(null); setCurrentView('dashboard'); }}
        />
      )}
      {currentView === 'results' && recentResult && (
        <ResultScreen result={recentResult} onClose={() => setCurrentView('dashboard')} onReview={() => { setReviewResult(recentResult); setCurrentView('review'); }} />
      )}
      {currentView === 'review' && reviewResult && (
        <ReviewInterface result={reviewResult} onExit={() => setCurrentView('dashboard')} />
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
    </div>
  );
};

export default App;
