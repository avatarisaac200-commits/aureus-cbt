
import React, { useState, useEffect } from 'react';
import { User, MockTest, ExamResult } from './types';
import { auth, db } from './firebase';
import { onAuthStateChanged, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import AdminDashboard from './components/AdminDashboard';
import RootAdminDashboard from './components/RootAdminDashboard';
import ExamInterface from './components/ExamInterface';
import ResultScreen from './components/ResultScreen';
import ReviewInterface from './components/ReviewInterface';
import logo from './assets/logo.png';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState('auth');
  const [adminDefaultTab, setAdminDefaultTab] = useState<string>('questions');
  const [activeTest, setActiveTest] = useState<MockTest | null>(null);
  const [reviewResult, setReviewResult] = useState<ExamResult | null>(null);
  const [recentResult, setRecentResult] = useState<ExamResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkUserStatus = async (firebaseUser: any) => {
    try {
      // Force reload to get latest verification status from Firebase servers
      await firebaseUser.reload();
      const updatedUser = auth.currentUser;
      if (!updatedUser) return;

      const isOfficialEmail = updatedUser.email?.toLowerCase().endsWith('@aureusmedicos.com');

      // Check verification unless it's an official staff email
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
        
        if (userData.role === 'root-admin') {
          setCurrentView('root-admin');
        } else if (userData.role === 'admin') {
          setCurrentView('admin');
        } else {
          setCurrentView('dashboard');
        }
      } else {
        // Document doesn't exist - break the loop and go to auth
        setCurrentUser(null);
        setCurrentView('auth');
      }
    } catch (error) {
      console.error("Error syncing user:", error);
      setCurrentView('auth');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setIsLoading(true);
      if (firebaseUser) {
        await checkUserStatus(firebaseUser);
      } else {
        setCurrentUser(null);
        setCurrentView('auth');
        setIsLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleManualVerifyCheck = async () => {
    if (auth.currentUser) {
      setIsLoading(true);
      await checkUserStatus(auth.currentUser);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-950 safe-top safe-bottom">
        <img src={logo} className="w-20 h-20 animate-pulse mb-6" alt="Loading" />
        <div className="flex flex-col items-center">
          <p className="text-amber-500 text-[10px] font-bold uppercase tracking-[0.5em] mb-2">Aureus Medicos</p>
          <div className="w-32 h-1 bg-slate-900 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 w-1/2 animate-[shimmer_2s_infinite]"></div>
          </div>
        </div>
      </div>
    );
  }

  if (currentView === 'verify-email') {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <img src={logo} className="w-16 h-16 mb-6" alt="Logo" />
        <h2 className="text-2xl font-bold text-slate-900 uppercase tracking-tight mb-2">Verify Your Email</h2>
        <p className="text-slate-500 text-sm max-w-sm mb-8 leading-relaxed">
          We've sent a verification link to your email. Please check your inbox (and spam folder) and click the link to continue.
        </p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button 
            onClick={handleManualVerifyCheck} 
            className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-[10px] tracking-widest shadow-lg"
          >
            I've Verified My Email
          </button>
          <button 
            onClick={() => auth.currentUser && sendEmailVerification(auth.currentUser).then(() => alert('Verification email resent!'))}
            className="w-full py-4 bg-white text-slate-600 border border-slate-200 rounded-2xl font-bold uppercase text-[10px] tracking-widest"
          >
            Resend Email
          </button>
          <button 
            onClick={() => auth.signOut()} 
            className="mt-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:text-red-500"
          >
            Log Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden flex flex-col">
      {currentView === 'auth' && <Auth onLogin={checkUserStatus} />}
      
      {currentView === 'dashboard' && currentUser && (
        <Dashboard 
          user={currentUser} 
          onLogout={() => auth.signOut()} 
          onStartTest={(test) => { setActiveTest(test); setCurrentView('exam'); }}
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
        />
      )}

      {currentView === 'exam' && activeTest && currentUser && (
        <ExamInterface 
          test={activeTest} 
          user={currentUser}
          onFinish={(res) => { setRecentResult(res); setCurrentView('results'); }}
          onExit={() => setCurrentView('dashboard')}
        />
      )}

      {currentView === 'results' && recentResult && (
        <ResultScreen result={recentResult} onClose={() => setCurrentView('dashboard')} onReview={() => { setReviewResult(recentResult); setCurrentView('review'); }} />
      )}

      {currentView === 'review' && reviewResult && (
        <ReviewInterface result={reviewResult} onExit={() => setCurrentView('dashboard')} />
      )}
    </div>
  );
};

export default App;
