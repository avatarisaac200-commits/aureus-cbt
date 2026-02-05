import React, { useState, useEffect } from 'react';
import { User, MockTest, ExamResult, ViewState } from './types';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import AdminDashboard from './components/AdminDashboard';
import ExamInterface from './components/ExamInterface';
import ResultScreen from './components/ResultScreen';
import ReviewInterface from './components/ReviewInterface';
import logo from './assets/logo.png';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<ViewState>('auth');
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
          setCurrentUser({ ...userData, id: firebaseUser.uid });
          setCurrentView(userData.role === 'admin' ? 'admin' : 'dashboard');
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
    setCurrentView(user.role === 'admin' ? 'admin' : 'dashboard');
  };

  const handleLogout = async () => {
    await auth.signOut();
    setCurrentUser(null);
    setCurrentView('auth');
  };

  const startExam = (test: MockTest) => {
    setActiveTest(test);
    setCurrentView('exam');
  };

  const startReview = (result: ExamResult) => {
    setReviewResult(result);
    setCurrentView('review');
  };

  const completeExam = (result: ExamResult) => {
    setRecentResult(result);
    setCurrentView('results');
    setActiveTest(null);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <img src={logo} className="w-20 h-20 mb-4 animate-pulse" alt="Loading" />
        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Authenticating...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {currentView === 'auth' && <Auth onLogin={handleLogin} />}
      
      {currentView === 'dashboard' && currentUser && (
        <Dashboard 
          user={currentUser} 
          onLogout={handleLogout} 
          onStartTest={startExam}
          onReviewResult={startReview}
          onReturnToAdmin={() => setCurrentView('admin')}
        />
      )}

      {currentView === 'admin' && currentUser && (
        <AdminDashboard 
          user={currentUser} 
          onLogout={handleLogout} 
          onSwitchToStudent={() => setCurrentView('dashboard')}
        />
      )}

      {currentView === 'exam' && activeTest && currentUser && (
        <ExamInterface 
          test={activeTest} 
          user={currentUser}
          onFinish={completeExam}
          onExit={() => setCurrentView('dashboard')}
        />
      )}

      {currentView === 'results' && recentResult && (
        <ResultScreen 
          result={recentResult} 
          onClose={() => setCurrentView('dashboard')}
          onReview={() => startReview(recentResult)}
        />
      )}

      {currentView === 'review' && reviewResult && (
        <ReviewInterface 
          result={reviewResult} 
          onExit={() => setCurrentView('dashboard')} 
        />
      )}
    </div>
  );
};

export default App;