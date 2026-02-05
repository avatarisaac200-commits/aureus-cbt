import React, { useState, useEffect } from 'react';
import { User, MockTest, ExamResult } from '../types';
import { db } from '../firebase';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import logo from '../assets/logo.png';

interface DashboardProps {
  user: User;
  onLogout: () => void;
  onStartTest: (test: MockTest) => void;
  onReviewResult: (result: ExamResult) => void;
  onReturnToAdmin?: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ user, onLogout, onStartTest, onReviewResult, onReturnToAdmin }) => {
  const [tests, setTests] = useState<MockTest[]>([]);
  const [history, setHistory] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleStatusChange = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);

    const fetchData = async () => {
      try {
        setLoading(true);
        const testsSnap = await getDocs(collection(db, 'tests'));
        setTests(testsSnap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest)));

        // Removed order by to avoid composite index requirement which was likely causing issues on Vercel
        const resultsQuery = query(
          collection(db, 'results'), 
          where('userId', '==', user.id)
        );
        const resultsSnap = await getDocs(resultsQuery);
        const results = resultsSnap.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult));
        
        // Sort client-side instead
        setHistory(results.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()));
      } catch (err) {
        console.error("Error fetching dashboard data:", err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();

    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
    };
  }, [user.id]);

  const stats = {
    totalTaken: history.length,
    avgScore: history.length > 0 
      ? Math.round((history.reduce((acc, curr) => acc + (curr.score / curr.maxScore), 0) / history.length) * 100) 
      : 0,
    highestScore: history.length > 0
      ? Math.round(Math.max(...history.map(h => (h.score / h.maxScore) * 100)))
      : 0
  };

  const isTestCompleted = (testId: string) => history.some(h => h.testId === testId);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 md:p-8 pb-20">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <img src={logo} alt="Aureus Medicos" className="w-12 h-12 md:w-16 md:h-16" />
          <div className="flex-1">
            <h1 className="text-xl md:text-2xl font-black text-slate-900 uppercase tracking-tighter flex items-center gap-2 flex-wrap">
              Aureus Medicos CBT
              {isOffline && (
                <span className="bg-amber-100 text-amber-600 text-[8px] px-2 py-0.5 rounded-full border border-amber-200 animate-pulse uppercase">
                  OFFLINE
                </span>
              )}
            </h1>
            <p className="text-slate-500 text-xs md:text-sm font-medium italic">Welcome, Dr. {user.name}</p>
          </div>
        </div>
        
        <div className="flex gap-2 w-full md:w-auto">
          {user.role === 'admin' && onReturnToAdmin && (
            <button 
              onClick={onReturnToAdmin}
              className="flex-1 md:flex-none px-4 py-2 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-all shadow-sm"
            >
              Admin Portal
            </button>
          )}
          <button 
             onClick={onLogout}
             className="flex-1 md:flex-none px-4 py-2 text-xs font-bold text-slate-600 hover:bg-white rounded-xl transition-all border border-slate-200 shadow-sm"
          >
             Logout
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center">
          <span className="text-slate-400 text-[8px] md:text-[10px] font-bold uppercase tracking-widest mb-1">Tests Completed</span>
          <span className="text-2xl md:text-4xl font-black text-slate-900">{stats.totalTaken}</span>
        </div>
        <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center">
          <span className="text-slate-400 text-[8px] md:text-[10px] font-bold uppercase tracking-widest mb-1">Average Score</span>
          <span className="text-2xl md:text-4xl font-black text-amber-500">{stats.avgScore}%</span>
        </div>
        <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center">
          <span className="text-slate-400 text-[8px] md:text-[10px] font-bold uppercase tracking-widest mb-1">Best Score</span>
          <span className="text-2xl md:text-4xl font-black text-slate-950">{stats.highestScore}%</span>
        </div>
      </div>

      {loading ? (
        <div className="text-center p-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mx-auto"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="flex justify-between items-center mb-4">
               <h2 className="text-lg md:text-xl font-black text-slate-900 uppercase tracking-tight">
                  {isOffline ? 'Cached Practice Exams' : 'Available Practice Exams'}
               </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {tests.length === 0 ? (
                <div className="col-span-full p-12 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200">
                  <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest">
                    {isOffline ? 'No cached exams available. Connect to sync.' : 'No active exams found in the cloud.'}
                  </p>
                </div>
              ) : (
                tests.map(test => {
                  const completed = isTestCompleted(test.id);
                  const canStart = test.allowRetake || !completed;
                  
                  return (
                    <div key={test.id} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 hover:shadow-md transition-all group flex flex-col relative overflow-hidden">
                       {completed && (
                         <div className="absolute top-0 right-0 bg-emerald-500 text-white text-[8px] font-black uppercase px-3 py-1 rounded-bl-xl tracking-widest z-10 shadow-sm">
                           Completed
                         </div>
                       )}
                       <h3 className="font-black text-base md:text-lg text-slate-900 mb-2 group-hover:text-amber-600 transition-colors uppercase tracking-tight leading-tight pr-12">{test.name}</h3>
                       <p className="text-[10px] md:text-xs text-slate-500 mb-6 line-clamp-3 font-medium flex-1">"{test.description}"</p>
                       
                       <div className="flex gap-2 text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-widest mb-6">
                          <span className="bg-slate-50 px-2 py-1 rounded-full">{test.totalDurationSeconds / 60} MINS</span>
                          <span className="bg-slate-50 px-2 py-1 rounded-full">{test.sections.length} SECTIONS</span>
                       </div>

                       <button 
                          disabled={!canStart}
                          onClick={() => onStartTest(test)}
                          className={`w-full py-4 rounded-xl font-black uppercase tracking-[0.2em] text-[10px] transition-all shadow-sm ${
                            canStart 
                            ? 'bg-slate-950 text-amber-500 hover:bg-slate-800 active:scale-95' 
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed grayscale'
                          }`}
                       >
                          {!canStart ? 'Already Attempted' : 'Start Exam'}
                       </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <aside className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 h-fit">
            <h2 className="text-lg md:text-xl font-black mb-6 text-slate-950 uppercase tracking-tight text-center">History</h2>
            <div className="space-y-3">
              {history.length === 0 ? (
                 <p className="text-[9px] font-black text-slate-300 text-center py-6 uppercase tracking-widest">No previous attempts found.</p>
              ) : (
                 history.map(item => (
                   <div key={item.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 transition-all hover:border-amber-200 group">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="text-[9px] font-black text-slate-950 uppercase truncate max-w-[120px] tracking-tight">{item.testName}</h4>
                        <span className={`text-[7px] px-2 py-0.5 rounded font-black uppercase ${
                          item.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {item.status}
                        </span>
                      </div>
                      <div className="flex justify-between items-end mb-3">
                         <span className="text-[8px] text-slate-400 font-bold uppercase">{new Date(item.completedAt).toLocaleDateString()}</span>
                         <span className="text-xl font-black text-slate-950 tracking-tighter">{Math.round((item.score / item.maxScore) * 100)}%</span>
                      </div>
                      <button 
                        onClick={() => onReviewResult(item)}
                        className="w-full py-2 bg-white border border-slate-200 text-[8px] font-black uppercase tracking-widest rounded-lg hover:bg-amber-50 hover:border-amber-200 hover:text-amber-600 transition-all"
                      >
                        Review Mistakes
                      </button>
                   </div>
                 ))
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

export default Dashboard;