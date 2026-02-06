
import React, { useState, useEffect, useMemo } from 'react';
import { User, MockTest, ExamResult } from '../types';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, getDocs, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import ScientificText from './ScientificText';
import logo from '../assets/logo.png';

interface DashboardProps {
  user: User;
  onLogout: () => void;
  onStartTest: (test: MockTest) => void;
  onReviewResult: (result: ExamResult) => void;
  onReturnToAdmin?: () => void;
}

const LeaderboardModal: React.FC<{ test: MockTest, onClose: () => void }> = ({ test, onClose }) => {
  const [topScores, setTopScores] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTop = async () => {
      // Query results for this test ordered by score
      const q = query(
        collection(db, 'results'), 
        where('testId', '==', test.id),
        orderBy('score', 'desc'),
        limit(10)
      );
      const snap = await getDocs(q);
      setTopScores(snap.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult)));
      setLoading(false);
    };
    fetchTop();
  }, [test.id]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="bg-slate-900 p-8 text-center relative border-b-4 border-amber-500">
          <button onClick={onClose} className="absolute top-6 right-6 text-slate-500 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
          <p className="text-amber-500 text-[9px] font-black uppercase tracking-[0.3em] mb-2">Aureus Hall of Fame</p>
          <h2 className="text-xl font-black text-white uppercase tracking-tight">{test.name}</h2>
        </div>
        <div className="p-8 max-h-[60vh] overflow-y-auto no-scrollbar">
          {loading ? (
            <div className="flex justify-center py-10"><div className="w-6 h-6 border-b-2 border-amber-500 rounded-full animate-spin"></div></div>
          ) : topScores.length === 0 ? (
            <p className="text-center py-10 text-slate-400 font-black text-[10px] uppercase tracking-widest">No rankings yet</p>
          ) : (
            <div className="space-y-3">
              {topScores.map((res, i) => (
                <div key={res.id} className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-gray-100">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm ${i === 0 ? 'bg-amber-500 text-slate-950' : i === 1 ? 'bg-slate-300 text-slate-700' : i === 2 ? 'bg-amber-700 text-white' : 'bg-slate-200 text-slate-400'}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] font-black text-slate-900 uppercase truncate">{res.userName || 'Student'}</p>
                    <p className="text-[8px] text-slate-400 font-bold uppercase">{new Date(res.completedAt).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-slate-950">{Math.round((res.score / res.maxScore) * 100)}%</p>
                    <p className="text-[8px] font-black text-slate-400 uppercase">{res.score}/{res.maxScore}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-6 bg-slate-50 border-t border-gray-100 text-center">
          <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Only Top 10 Participants Shown</p>
        </div>
      </div>
    </div>
  );
};

const Dashboard: React.FC<DashboardProps> = ({ user, onLogout, onStartTest, onReviewResult, onReturnToAdmin }) => {
  const [tests, setTests] = useState<MockTest[]>([]);
  const [history, setHistory] = useState<ExamResult[]>([]);
  const [allResults, setAllResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLeaderboard, setShowLeaderboard] = useState<MockTest | null>(null);
  
  const [lastSeenTimestamp, setLastSeenTimestamp] = useState<number>(() => {
    const saved = localStorage.getItem(`aureus_last_seen_${user.id}`);
    return saved ? parseInt(saved) : Date.now();
  });
  
  const [newTestAlert, setNewTestAlert] = useState<string | null>(null);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    const testsQuery = query(collection(db, 'tests'), where('isApproved', '==', true));
    const unsubscribeTests = onSnapshot(testsQuery, (snapshot) => {
      const testsData = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as MockTest));
      const latest = testsData.reduce((prev, curr) => {
        const currTime = new Date(curr.createdAt).getTime();
        const prevTime = prev ? new Date(prev.createdAt).getTime() : 0;
        return currTime > prevTime ? curr : prev;
      }, null as MockTest | null);

      if (latest) {
        const latestTime = new Date(latest.createdAt).getTime();
        if (latestTime > lastSeenTimestamp) {
          setNewTestAlert(latest.name);
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("New Exam Available", {
              body: `"${latest.name}" has been added to the library.`,
              icon: logo,
              tag: 'new-test-alert'
            });
          }
        }
      }
      setTests(testsData);
      setLoading(false);
    });

    // Listen to all results to calculate counts globally
    const allResultsQuery = query(collection(db, 'results'));
    const unsubscribeAllResults = onSnapshot(allResultsQuery, (snapshot) => {
      setAllResults(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult)));
    });

    const resultsQuery = query(collection(db, 'results'), where('userId', '==', user.id));
    const unsubscribeResults = onSnapshot(resultsQuery, (snapshot) => {
      setHistory(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult))
        .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()));
    });

    return () => {
      unsubscribeTests();
      unsubscribeAllResults();
      unsubscribeResults();
    };
  }, [user.id, lastSeenTimestamp]);

  const participantCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allResults.forEach(res => {
      if (!counts[res.testId]) counts[res.testId] = 0;
      // We count unique participants per test
      const testResults = allResults.filter(r => r.testId === res.testId);
      const uniqueUsers = new Set(testResults.map(r => r.userId));
      counts[res.testId] = uniqueUsers.size;
    });
    return counts;
  }, [allResults]);

  const stats = useMemo(() => {
    if (history.length === 0) return { avgScore: 0, highestScore: 0, totalTaken: 0 };
    const scores = history.map(h => (h.score / h.maxScore) * 100);
    return {
      avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / history.length),
      highestScore: Math.round(Math.max(...scores)),
      totalTaken: history.length
    };
  }, [history]);

  const handleStartTest = (test: MockTest) => {
    const now = Date.now();
    setLastSeenTimestamp(now);
    localStorage.setItem(`aureus_last_seen_${user.id}`, now.toString());
    setNewTestAlert(null);
    onStartTest(test);
  };

  const isTestCompleted = (testId: string) => history.some(h => String(h.testId) === String(testId) && h.status === 'completed');

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden relative">
      {newTestAlert && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm">
          <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-amber-500/50 flex items-center justify-between animate-in slide-in-from-top-4">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 bg-amber-500 rounded-full animate-ping"></div>
              <p className="text-[10px] font-black uppercase tracking-widest">New Exam Available: {newTestAlert}</p>
            </div>
            <button onClick={() => setNewTestAlert(null)} className="p-1 text-slate-400 hover:text-white">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
        </div>
      )}

      {showLeaderboard && <LeaderboardModal test={showLeaderboard} onClose={() => setShowLeaderboard(null)} />}

      <div className="max-w-6xl mx-auto w-full flex-1 overflow-y-auto no-scrollbar p-4 md:p-8 safe-top safe-bottom">
        <div className="flex flex-col md:flex-row justify-between items-center mb-10 gap-6 bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 shrink-0">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <img src={logo} alt="Logo" className="w-12 h-12 md:w-16 md:h-16 object-contain" />
            <div className="flex-1">
              <h1 className="text-lg md:text-xl font-black text-slate-900 uppercase tracking-tighter flex flex-col leading-tight">
                <span>Aureus Medicos</span>
                <span className="text-amber-500 text-[10px] tracking-widest font-bold">CBT Practice App</span>
              </h1>
              <p className="text-slate-500 text-[10px] md:text-xs font-bold truncate">{user.name}</p>
            </div>
          </div>
          
          <div className="flex gap-2 w-full md:w-auto">
            {(user.role === 'admin' || user.role === 'root-admin') && onReturnToAdmin && (
              <button onClick={onReturnToAdmin} className="flex-1 md:flex-none px-6 py-3 text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-all active:scale-95">Admin Panel</button>
            )}
            <button onClick={onLogout} className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase hover:text-red-500 transition-all">Logout</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 md:gap-6 mb-12 shrink-0">
          <div className="bg-white p-5 md:p-8 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center">
            <span className="text-slate-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest mb-2 text-center">Avg Score</span>
            <span className="text-xl md:text-4xl font-black text-slate-950">{stats.avgScore}%</span>
          </div>
          <div className="bg-white p-5 md:p-8 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center">
            <span className="text-slate-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest mb-2 text-center">Highest</span>
            <span className="text-xl md:text-4xl font-black text-amber-500">{stats.highestScore}%</span>
          </div>
          <div className="bg-white p-5 md:p-8 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center">
            <span className="text-slate-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest mb-2 text-center">Total</span>
            <span className="text-xl md:text-4xl font-black text-slate-950">{stats.totalTaken}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 md:gap-12 pb-10">
          <div className="lg:col-span-2 space-y-12">
            <section>
              <h2 className="text-xl font-black mb-6 text-slate-900 uppercase tracking-tight flex items-center gap-3">
                Practice Exams
                <span className="bg-amber-500 text-slate-950 text-[10px] px-2 py-0.5 rounded-lg">{tests.length}</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {tests.length === 0 && !loading ? (
                  <div className="col-span-full p-20 text-center bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100">
                    <p className="text-slate-300 font-black uppercase text-xs tracking-[0.2em]">No tests available yet.</p>
                  </div>
                ) : (
                  tests.map(test => {
                    const completed = isTestCompleted(test.id);
                    const isNew = new Date(test.createdAt).getTime() > lastSeenTimestamp;
                    const pCount = participantCounts[test.id] || 0;
                    
                    return (
                      <div key={test.id} className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl transition-all group flex flex-col relative overflow-hidden">
                        {completed && <div className="absolute top-0 right-0 bg-emerald-500 text-white text-[8px] font-black uppercase px-4 py-1.5 rounded-bl-xl tracking-widest z-10">Completed</div>}
                        {isNew && !completed && (
                          <div className="absolute top-0 right-0 bg-amber-500 text-slate-950 text-[8px] font-black uppercase px-4 py-1.5 rounded-bl-xl tracking-widest z-10 animate-pulse">
                            New Content
                          </div>
                        )}
                        
                        <h3 className="font-black text-lg text-slate-900 mb-2 group-hover:text-amber-600 transition-colors uppercase tracking-tight leading-tight pr-10">{test.name}</h3>
                        <p className="text-[10px] text-slate-400 mb-6 line-clamp-3 font-medium flex-1">{test.description}</p>
                        
                        <div className="flex flex-wrap gap-2 text-[8px] font-black uppercase tracking-widest mb-8">
                           <span className="bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-full text-slate-400">{test.totalDurationSeconds / 60} Mins</span>
                           <button 
                             onClick={(e) => { e.stopPropagation(); setShowLeaderboard(test); }}
                             className="bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full text-amber-600 hover:bg-amber-500 hover:text-white transition-all active:scale-95"
                           >
                             {pCount} Participants
                           </button>
                        </div>
                        
                        <button 
                          onClick={() => handleStartTest(test)}
                          className="w-full py-4 bg-slate-950 text-amber-500 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95 shadow-lg hover:bg-slate-800"
                        >
                          Start Simulation
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>

          <aside className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-200 h-fit sticky top-8">
            <h2 className="text-xl font-black mb-8 text-slate-950 uppercase tracking-tight text-center">Attempts</h2>
            <div className="space-y-4">
              {history.length === 0 ? (
                <p className="text-[10px] font-black text-slate-300 text-center py-12 uppercase tracking-[0.3em]">No scores recorded</p>
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
               <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Aureus Medicos Suite</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
