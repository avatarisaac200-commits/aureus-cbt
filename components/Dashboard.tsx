
import React, { useState, useEffect, useMemo } from 'react';
import { User, MockTest, ExamResult } from '../types';
import { db } from '../firebase';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import ScientificText from './ScientificText';
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

  const stats = useMemo(() => {
    if (history.length === 0) return { avgScore: 0, highestScore: 0, totalTaken: 0 };
    const scores = history.map(h => (h.score / h.maxScore) * 100);
    return {
      avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / history.length),
      highestScore: Math.round(Math.max(...scores)),
      totalTaken: history.length
    };
  }, [history]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const testsQuery = query(collection(db, 'tests'), where('isApproved', '==', true));
      const testsSnap = await getDocs(testsQuery);
      setTests(testsSnap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest)));

      const resultsQuery = query(collection(db, 'results'), where('userId', '==', user.id));
      const resultsSnap = await getDocs(resultsQuery);
      setHistory(resultsSnap.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult))
        .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()));
    } catch (err) {
      console.error("Error loading dashboard:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleStatusChange = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);
    fetchData();
    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
    };
  }, [user.id]);

  const copyShareLink = (testId: string) => {
    const link = `${window.location.origin}/?testId=${testId}`;
    navigator.clipboard.writeText(link).then(() => {
      alert("Link copied to clipboard!");
    });
  };

  const isTestCompleted = (testId: string) => history.some(h => String(h.testId) === String(testId) && h.status === 'completed');

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden">
      <div className="max-w-6xl mx-auto w-full flex-1 overflow-y-auto no-scrollbar p-4 md:p-8 safe-top safe-bottom">
        <div className="flex flex-col md:flex-row justify-between items-center mb-10 gap-6 bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 shrink-0">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <img src={logo} alt="Logo" className="w-12 h-12 md:w-16 md:h-16 object-contain" />
            <div className="flex-1">
              <h1 className="text-lg md:text-xl font-black text-slate-900 uppercase tracking-tighter flex flex-col leading-tight">
                <span>Aureus Medicos</span>
                <span className="text-amber-500 text-[10px] tracking-widest font-bold">CBT Practice App</span>
              </h1>
              <p className="text-slate-500 text-[10px] md:text-xs font-bold truncate max-w-[150px] md:max-w-none">{user.name}</p>
            </div>
          </div>
          
          <div className="flex gap-2 w-full md:w-auto">
            {(user.role === 'admin' || user.role === 'root-admin') && onReturnToAdmin && (
              <button 
                onClick={onReturnToAdmin}
                className="flex-1 md:flex-none px-6 py-3 text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-all active:scale-95"
              >
                Admin Panel
              </button>
            )}
            <button onClick={onLogout} className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase hover:text-red-500 transition-all">Logout</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 md:gap-6 mb-12 shrink-0">
          <div className="bg-white p-5 md:p-8 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center">
            <span className="text-slate-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest mb-2 text-center">Average Score</span>
            <span className="text-xl md:text-4xl font-black text-slate-950">{stats.avgScore}%</span>
          </div>
          <div className="bg-white p-5 md:p-8 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center">
            <span className="text-slate-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest mb-2 text-center">Highest Score</span>
            <span className="text-xl md:text-4xl font-black text-amber-500">{stats.highestScore}%</span>
          </div>
          <div className="bg-white p-5 md:p-8 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center">
            <span className="text-slate-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest mb-2 text-center">Tests Taken</span>
            <span className="text-xl md:text-4xl font-black text-slate-950">{stats.totalTaken}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 md:gap-12 pb-10">
          <div className="lg:col-span-2 space-y-12">
            <section>
              <h2 className="text-xl font-black mb-6 text-slate-900 uppercase tracking-tight flex items-center gap-3">
                Available Tests
                <span className="bg-amber-500 text-slate-950 text-[10px] px-2 py-0.5 rounded-lg">{tests.length}</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {tests.length === 0 ? (
                  <div className="col-span-full p-20 text-center bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100">
                    <p className="text-slate-300 font-black uppercase text-xs tracking-[0.2em]">No tests available yet.</p>
                  </div>
                ) : (
                  tests.map(test => {
                    const completed = isTestCompleted(test.id);
                    return (
                      <div key={test.id} className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl transition-all group flex flex-col relative overflow-hidden">
                        {completed && <div className="absolute top-0 right-0 bg-emerald-500 text-white text-[8px] font-black uppercase px-4 py-1.5 rounded-bl-xl tracking-widest z-10 shadow-sm">Done</div>}
                        <h3 className="font-black text-lg text-slate-900 mb-2 group-hover:text-amber-600 transition-colors uppercase tracking-tight leading-tight pr-10">{test.name}</h3>
                        <p className="text-[10px] text-slate-400 mb-6 line-clamp-3 font-medium flex-1">{test.description}</p>
                        <div className="flex gap-2 text-[8px] font-black text-slate-400 uppercase tracking-widest mb-8">
                           <span className="bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-full">{test.totalDurationSeconds / 60} Mins</span>
                           <button onClick={() => copyShareLink(test.id)} className="bg-amber-50 text-amber-600 border border-amber-100 px-3 py-1.5 rounded-full hover:bg-amber-100 transition-all">Copy Link</button>
                        </div>
                        <button 
                          onClick={() => onStartTest(test)}
                          className="w-full py-4 bg-slate-950 text-amber-500 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95 shadow-lg"
                        >
                          Start Test
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>

          <aside className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-200 h-fit sticky top-8">
            <h2 className="text-xl font-black mb-8 text-slate-950 uppercase tracking-tight text-center">Score Log</h2>
            <div className="space-y-4">
              {history.length === 0 ? (
                <p className="text-[10px] font-black text-slate-300 text-center py-12 uppercase tracking-[0.3em]">No scores yet</p>
              ) : (
                history.map(item => (
                  <div key={item.id} className="p-5 bg-slate-50 rounded-2xl border border-slate-100 hover:border-amber-200 hover:bg-white transition-all group">
                    <div className="flex justify-between items-start mb-3">
                      <h4 className="text-[10px] font-black text-slate-950 uppercase truncate max-w-[140px] tracking-tight">{item.testName}</h4>
                      <span className="text-xl font-black text-slate-950 tracking-tighter leading-none">{Math.round((item.score / item.maxScore) * 100)}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                       <span className="text-[8px] text-slate-400 font-bold uppercase">{new Date(item.completedAt).toLocaleDateString()}</span>
                       <button onClick={() => onReviewResult(item)} className="text-[8px] font-black text-amber-600 uppercase tracking-widest hover:underline active:scale-95">Review</button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="mt-8 pt-6 border-t border-gray-50 text-center">
               <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Aureus Medicos CBT Practice App</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
