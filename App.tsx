
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

// High-fidelity Base64 SVG Logo for guaranteed cross-environment display
export const LOGO_URL = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iZ29sZEdyYWQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAlIiBzdHlsZT0ic3RvcC1jb2xvcjojZmJiZjI0O3N0b3Atb3BhY2l0eToxIiAvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiNkOTc3MDY7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0OCIgZmlsbD0iIzBmMTcyYSIgLz4KICA8cGF0aCBkPSJNNTAgMjAgTDI1IDM1IEwyNSA2NSBMNTAgODAgTDc1IDY1IEw3NSAzNSBaIiBmaWxsPSJ1cmwoI2dvbGRHcmFkKSIgLz4KICA8dGV4dCB4PSI1MCIgeT0iNTgiIGZvbnQtZmFtaWx5PSJzeXN0ZW0tdWksIC1hcHBsZS1zeXN0ZW0sIHNhbnMtc2VyaWYiIGZvbnQtd2VpZ2h0PSI5MDAiIGZvbnQtc2l6ZT0iMjgiIGZpbGw9IiMwZjE3MmEiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkE8L3RleHQ+Cjwvc3ZnPg==`;

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
        <img src={LOGO_URL} className="w-20 h-20 mb-4 animate-pulse" alt="Loading" />
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
