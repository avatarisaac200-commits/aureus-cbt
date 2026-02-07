
import React, { useState, useEffect, useMemo } from 'react';
import { User, MockTest, ExamResult } from '../types';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, getDocs, limit, orderBy } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
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
      setLoading(true);
      try {
        // Fetch results for this specific test
        const q = query(collection(db, 'results'), where('testId', '==', test.id), orderBy('completedAt', 'asc'));
        const snap = await getDocs(q);
        const results = snap.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult));
        
        // LEADERBOARD ALGORITHM: FIRST ATTEMPT ONLY
        // Map stores the first result (earliest) encountered for each user.
        const userFirstAttempts: Record<string, ExamResult> = {};
        results.forEach(res => {
          if (!userFirstAttempts[res.userId]) {
            userFirstAttempts[res.userId] = res;
          }
        });

        const sorted = Object.values(userFirstAttempts)
          .sort((a, b) => b.score - a.score || new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime())
          .slice(0, 10);
          
        setTopScores(sorted);
      } catch (err) {
        console.error("Leaderboard Sync Failed:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchTop();
  }, [test.id]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md safe-top safe-bottom">
      <div className="w-full max-w-lg bg-white rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border-4 border-amber-500">
        <div className="bg-slate-900 p-10 text-center relative">
          <button onClick={onClose} className="absolute top-6 right-6 text-slate-500 hover:text-white transition-colors">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
          <p className="text-amber-500 text-[10px] font-black uppercase tracking-[0.4em] mb-2">Registry Rankings</p>
          <h2 className="text-2xl font-bold text-white uppercase tracking-tight leading-tight">{test.name}</h2>
          <p className="text-[9px] text-slate-400 font-bold uppercase mt-2">Official First Attempt Database</p>
        </div>
        <div className="p-8 max-h-[60vh] overflow-y-auto no-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Compiling Records...</p>
            </div>
          ) : topScores.length === 0 ? (
            <div className="text-center py-20 text-slate-400 font-bold uppercase text-[10px] tracking-widest italic">No candidates recorded yet</div>
          ) : (
            <div className="space-y-3">
              {topScores.map((res, i) => (
                <div key={res.id} className="flex items-center gap-4 p-6 rounded-[2rem] bg-slate-50 border border-slate-100 shadow-sm">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg ${i === 0 ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/30' : i === 1 ? 'bg-slate-300 text-slate-700' : i === 2 ? 'bg-amber-800 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-black text-slate-950 uppercase truncate">{res.userName}</p>
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{new Date(res.completedAt).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-black text-slate-950 tracking-tighter leading-none">{Math.round((res.score / (res.maxScore || 1)) * 100)}%</p>
                  </div>
                </div>
              ))}
            </div>
          )}
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

  useEffect(() => {
    // Approved tests only
    const unsubTests = onSnapshot(query(collection(db, 'tests'), where('isApproved', '==', true)), (snap) => {
      setTests(snap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest)));
      setLoading(false);
    });

    // Personal transcript history
    const unsubHistory = onSnapshot(query(collection(db, 'results'), where('userId', '==', user.id)), (snap) => {
      setHistory(snap.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult))
        .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()));
    });

    // Global results for telemetry (Quota check: fetching all results can be heavy, but needed for usage counts)
    const unsubAll = onSnapshot(collection(db, 'results'), (snap) => {
      setAllResults(snap.docs.map(d => d.data() as ExamResult));
    });

    return () => { unsubTests(); unsubHistory(); unsubAll(); };
  }, [user.id]);

  // TELEMETRY: ACTIVE USERS TODAY
  const activeToday = useMemo(() => {
    const todayStr = new Date().toDateString();
    const uniqueUsers = new Set(allResults.filter(r => new Date(r.completedAt).toDateString() === todayStr).map(r => r.userId));
    return uniqueUsers.size;
  }, [allResults]);

  // TEST METRIC: UNIQUE CANDIDATES PER MODULE
  const getTestUsageCount = (testId: string) => {
    const uniqueCandidates = new Set(allResults.filter(r => r.testId === testId).map(r => r.userId));
    return uniqueCandidates.size;
  };

  const stats = useMemo(() => {
    if (history.length === 0) return { avg: 0, peak: 0, count: 0 };
    const scores = history.map(h => (h.score / (h.maxScore || 1)) * 100);
    return {
      avg: Math.round(scores.reduce((a, b) => a + b, 0) / history.length),
      peak: Math.round(Math.max(...scores)),
      count: history.length
    };
  }, [history]);

  if (loading) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-50 safe-top safe-bottom">
        <img src={logo} className="w-16 h-16 animate-pulse mb-4" alt="Loading" />
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Syncing Student Profile...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden relative">
      {/* PLATFORM TELEMETRY BAR */}
      <div className="bg-slate-950 text-amber-500 py-3.5 px-8 flex justify-between items-center text-[9px] font-black uppercase tracking-[0.4em] shrink-0 border-b border-slate-900 shadow-2xl z-50 safe-top">
         <div className="flex items-center gap-3">
           <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.7)]"></span>
           <span className="hidden sm:inline">Registry Node: Online</span>
         </div>
         <span className="text-white">Active Candidates Today: <span className="text-amber-500 font-black ml-2 text-sm">{activeToday}</span></span>
         <div className="hidden sm:block">Aureus Registry v3.2</div>
      </div>

      {showLeaderboard && <LeaderboardModal test={showLeaderboard} onClose={() => setShowLeaderboard(null)} />}

      <div className="flex-1 overflow-y-auto no-scrollbar p-6 md:p-12 pb-24">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row justify-between items-center mb-12 gap-8 bg-white p-10 rounded-[3rem] shadow-sm border border-slate-100">
            <div className="flex items-center gap-8">
              <img src={logo} alt="Logo" className="w-20 h-20" />
              <div>
                <h1 className="text-3xl font-bold text-slate-950 uppercase tracking-tight leading-none">Aureus Medicos</h1>
                <p className="text-amber-600 text-[11px] tracking-[0.4em] font-black uppercase mt-2">Certified Clinical Portal</p>
              </div>
            </div>
            <div className="flex gap-4">
              {(user.role === 'admin' || user.role === 'root-admin') && onReturnToAdmin && (
                <button onClick={onReturnToAdmin} className="px-10 py-5 text-[11px] font-black text-amber-600 bg-amber-50 border border-amber-100 rounded-2xl hover:bg-amber-100 transition-all uppercase tracking-widest shadow-sm">Admin Hub</button>
              )}
              <button onClick={onLogout} className="px-8 py-5 text-[11px] font-black text-slate-400 uppercase tracking-widest hover:text-red-500 transition-all">Logout</button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            {[
              { label: 'Registry Mean', val: stats.avg + '%', color: 'text-slate-950' },
              { label: 'Personal Peak', val: stats.peak + '%', color: 'text-amber-500' },
              { label: 'Simulations Run', val: stats.count, color: 'text-slate-950' }
            ].map((s, i) => (
              <div key={i} className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col items-center text-center group hover:border-amber-200 transition-all">
                <span className="text-slate-400 text-[10px] font-black uppercase tracking-[0.3em] mb-3">{s.label}</span>
                <span className={`text-4xl font-black ${s.color} tracking-tighter`}>{s.val}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-12">
            <div className="xl:col-span-2 space-y-12">
              <section>
                <div className="flex items-center justify-between mb-10">
                  <h2 className="text-2xl font-black text-slate-950 uppercase tracking-tight">CBT Registry Simulations</h2>
                  <span className="bg-slate-100 text-slate-500 text-[10px] font-black px-6 py-2 rounded-full uppercase tracking-widest">{tests.length} Active Modules</span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {tests.map(test => {
                    const takerCount = getTestUsageCount(test.id);
                    return (
                      <div key={test.id} className="bg-white p-10 rounded-[3rem] shadow-sm border border-slate-100 hover:border-amber-400 transition-all group flex flex-col h-full relative overflow-hidden">
                        <div className="flex justify-between items-start mb-6">
                          <h3 className="font-black text-2xl text-slate-950 group-hover:text-amber-600 transition-colors uppercase tracking-tight leading-tight flex-1 mr-4">{test.name}</h3>
                          <div className="shrink-0 flex flex-col items-end">
                             <span className="bg-emerald-50 text-emerald-600 text-[9px] font-black px-4 py-2 rounded-xl uppercase tracking-widest shadow-sm border border-emerald-100 whitespace-nowrap">
                               {takerCount} Candidates
                             </span>
                          </div>
                        </div>
                        <p className="text-xs text-slate-400 mb-10 font-medium flex-1 leading-relaxed italic line-clamp-3">{test.description}</p>
                        <div className="flex justify-between items-center mb-8">
                           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-5 py-2.5 rounded-2xl">{test.totalDurationSeconds / 60} Min</span>
                           <button onClick={() => setShowLeaderboard(test)} className="text-[10px] font-black text-amber-600 uppercase tracking-widest hover:underline flex items-center gap-2 group">
                             <svg className="w-4 h-4 transition-transform group-hover:scale-125" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                             Top 10 Rankings
                           </button>
                        </div>
                        <button onClick={() => onStartTest(test)} className="w-full py-6 bg-amber-500 text-slate-950 rounded-2xl font-black uppercase tracking-[0.4em] text-[10px] transition-all active:scale-95 shadow-xl hover:bg-amber-600">Start Simulation</button>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
            
            <aside className="bg-white p-10 rounded-[3rem] shadow-sm border border-slate-200 h-fit sticky top-12">
              <h2 className="text-xl font-black mb-10 text-slate-950 uppercase tracking-tight text-center">Transcript History</h2>
              <div className="space-y-4">
                {history.map(item => (
                  <div key={item.id} className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100 hover:border-amber-200 transition-all group">
                    <div className="flex justify-between items-start mb-4">
                      <h4 className="text-[10px] font-black text-slate-950 uppercase truncate max-w-[150px] leading-tight">{item.testName}</h4>
                      <span className="text-xl font-black text-slate-950 tracking-tighter leading-none">{Math.round((item.score / (item.maxScore || 1)) * 100)}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                       <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{new Date(item.completedAt).toLocaleDateString()}</span>
                       <button onClick={() => onReviewResult(item)} className="text-[9px] font-black text-amber-600 uppercase tracking-widest hover:text-amber-700 transition-all">Detailed Review</button>
                    </div>
                  </div>
                ))}
                {history.length === 0 && (
                  <div className="py-20 text-center flex flex-col items-center">
                    <svg className="w-12 h-12 text-slate-100 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    <p className="text-slate-300 font-black uppercase text-[10px] tracking-widest italic">Registry History Empty</p>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
