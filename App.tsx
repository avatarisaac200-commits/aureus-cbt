
import React, { useState, useEffect } from 'react';
import { User, MockTest, ExamResult, ViewState } from './types';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import AdminDashboard from './components/AdminDashboard';
import RootAdminDashboard from './components/RootAdminDashboard';
import ExamInterface from './components/ExamInterface';
import ResultScreen from './components/ResultScreen';
import ReviewInterface from './components/ReviewInterface';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<ViewState>('auth');
  const [adminDefaultTab, setAdminDefaultTab] = useState<string>('questions');
  const [activeTest, setActiveTest] = useState<MockTest | null>(null);
  const [reviewResult, setReviewResult] = useState<ExamResult | null>(null);
  const [recentResult, setRecentResult] = useState<ExamResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setIsLoading(true);
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data() as User;
          const userObj = { ...userData, id: firebaseUser.uid };
          setCurrentUser(userObj);
          
          if (userData.role === 'root-admin') {
            setCurrentView('root-admin');
          } else if (userData.role === 'admin') {
            setCurrentView('admin');
          } else {
            setCurrentView('dashboard');
          }
        }
      } else {
        setCurrentUser(null);
        setCurrentView('auth');
      }
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    if (user.role === 'root-admin') {
      setCurrentView('root-admin');
    } else if (user.role === 'admin') {
      setCurrentView('admin');
    } else {
      setCurrentView('dashboard');
    }
  };

  const navigateToAdminTab = (tab: string) => {
    setAdminDefaultTab(tab);
    setCurrentView('admin');
  };

  if (isLoading) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-950">
        <img src="/assets/logo.png" className="w-20 h-20 animate-pulse mb-6" alt="Aureus Medicos Logo" />
        <div className="flex flex-col items-center">
          <p className="text-amber-500 text-[10px] font-black uppercase tracking-[0.5em] mb-2">Aureus Medicos</p>
          <div className="w-32 h-1 bg-slate-900 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 w-1/2 animate-[shimmer_2s_infinite]"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden flex flex-col">
      {currentView === 'auth' && <Auth onLogin={handleLogin} />}
      
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
          onSwitchToAdmin={() => navigateToAdminTab('questions')}
          onGoToImport={() => navigateToAdminTab('import')}
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
