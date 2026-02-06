
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

const logo = '/assets/logo.png';

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
          const userObj = { ...userData, id: firebaseUser.uid };
          setCurrentUser(userObj);
          
          const params = new URLSearchParams(window.location.search);
          const sharedTestId = params.get('testId');
          if (sharedTestId) {
            const testDoc = await getDoc(doc(db, 'tests', sharedTestId));
            if (testDoc.exists()) {
              const testData = { ...testDoc.data(), id: testDoc.id } as MockTest;
              if (testData.isApproved || userObj.role === 'admin' || userObj.role === 'root-admin' || testData.createdBy === userObj.id) {
                setActiveTest(testData);
                setCurrentView('exam');
                setIsLoading(false);
                return;
              }
            }
          }

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

  const handleLogout = async () => {
    await auth.signOut();
    setCurrentUser(null);
    setCurrentView('auth');
    window.history.replaceState({}, '', '/');
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
    window.history.replaceState({}, '', '/');
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-slate-50">
        <img src={logo} className="w-20 h-20 mb-4 animate-pulse" alt="Loading" />
        <h1 className="text-[12px] font-black uppercase tracking-[0.2em] text-slate-900 mb-1">Aureus Medicos</h1>
        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Authenticating...</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden flex flex-col">
      {currentView === 'auth' && <Auth onLogin={handleLogin} />}
      
      {currentView === 'dashboard' && currentUser && (
        <Dashboard 
          user={currentUser} 
          onLogout={handleLogout} 
          onStartTest={startExam}
          onReviewResult={startReview}
          onReturnToAdmin={() => setCurrentView(currentUser.role === 'root-admin' ? 'root-admin' : 'admin')}
        />
      )}

      {currentView === 'admin' && currentUser && (
        <AdminDashboard 
          user={currentUser} 
          onLogout={handleLogout} 
          onSwitchToStudent={() => setCurrentView('dashboard')}
        />
      )}

      {currentView === 'root-admin' && currentUser && (
        <RootAdminDashboard 
          user={currentUser} 
          onLogout={handleLogout} 
          onSwitchToStudent={() => setCurrentView('dashboard')}
          onSwitchToAdmin={() => setCurrentView('admin')}
        />
      )}

      {currentView === 'exam' && activeTest && currentUser && (
        <ExamInterface 
          test={activeTest} 
          user={currentUser}
          onFinish={completeExam}
          onExit={() => {
            const dest = currentUser.role === 'root-admin' ? 'root-admin' : (currentUser.role === 'admin' ? 'admin' : 'dashboard');
            setCurrentView(dest);
            window.history.replaceState({}, '', '/');
          }}
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
