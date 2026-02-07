
import React, { useState, useEffect, useMemo } from 'react';
import { User, MockTest, ExamResult } from '../types';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, getDocs } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
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
        const q = query(
          collection(db, 'results'), 
          where('testId', '==', test.id)
        );
        const snap = await getDocs(q);
        const results = snap.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult));
        
        // LEADERBOARD ALGORITHM: EXCLUSIVE FIRST ATTEMPTS
        const userFirstAttempts: Record<string, ExamResult> = {};
        results.forEach(res => {
          const currentFirst = userFirstAttempts[res.userId];
          if (!currentFirst || new Date(res.completedAt) < new Date(currentFirst.completedAt)) {
            userFirstAttempts[res.userId] = res;
          }
        });

        // Sort unique first-attempts by highest score
        const sorted = Object.values(userFirstAttempts)
          .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            // Tie-breaker: who finished faster (if we had duration) or who finished first
            return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
          })
          .slice(0, 10);
          
        setTopScores(sorted);
      } catch (err) {
        console.error("Leaderboard fetch failed:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchTop();
  }, [test.id]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm safe-top safe-bottom">
      <div className="w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border-4 border-amber-500">
        <div className="bg-slate-900 p-8 text-center relative">
          <button onClick={onClose} className="absolute top-6 right-6 text-slate-500 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
          <p className="text-amber-500 text-[9px] font-bold uppercase tracking-[0.3em] mb-2">Registry Ranking (Official First Attempt Only)</p>
          <h2 className="text-xl font-bold text-white uppercase tracking-tight">{test.name}</h2>
        </div>
        <div className="p-8 max-h-[60vh] overflow-y-auto no-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Syncing Leaderboard...</p>
            </div>
          ) : topScores.length === 0 ? (
            <p className="text-center py-10 text-slate-400 font-bold text-[10px] uppercase tracking-widest">No candidates recorded yet</p>
          ) : (
            <div className="space-y-3">
              {topScores.map((res, i) => (
                <div key={res.id} className="flex items-center gap-4 p-5 rounded-2xl bg-slate-50 border border-gray-100 shadow-sm">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm ${i === 0 ? 'bg-amber-500 text-slate-950' : i === 1 ? 'bg-slate-300 text-slate-700' : i === 2 ? 'bg-amber-700 text-white' : 'bg-slate-200 text-slate-400'}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-[11px] font-bold text-slate-900 uppercase truncate">{res.userName || 'Anonymous Candidate'}</p>
                    <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest">{new Date(res.completedAt).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-slate-950 tracking-tighter">{Math.round((res.score / (res.maxScore || 1)) * 100)}%</p>
                    <p className="text-[8px] font-bold text-slate-400 uppercase">{res.score}/{res.maxScore}</p>
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
    const testsQuery = query(collection(db, 'tests'), where('isApproved', '==', true));
    const unsubTests = onSnapshot(testsQuery, (snapshot) => {
      setTests(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as MockTest)));
      setLoading(false);
    });

    const resultsQuery = query(collection(db, 'results'), where('userId', '==', user.id));
    const unsubResults = onSnapshot(resultsQuery, (snapshot) => {
      setHistory(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult))
        .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()));
    });

    const allResultsQuery = query(collection(db, 'results'));
    const unsubAllResults = onSnapshot(allResultsQuery, (snapshot) => {
      setAllResults(snapshot.docs.map(d => d.data() as ExamResult));
    });

    return () => { unsubTests(); unsubResults(); unsubAllResults(); };
  }, [user.id]);

  const stats = useMemo(() => {
    if (history.length === 0) return { avgScore: 0, highestScore: 0, totalTaken: 0 };
    const scores = history.map(h => (h.score / (h.maxScore || 1)) * 100);
    return {
      avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / history.length),
      highestScore: Math.round(Math.max(...scores)),
      totalTaken: history.length
    };
  }, [history]);

  // TELEMETRY: ACTIVE CANDIDATES TODAY
  const activeUsersToday = useMemo(() => {
    const today = new Date().toDateString();
    const uniqueUsers = new Set(allResults.filter(r => new Date(r.completedAt).toDateString() === today).map(r => r.userId));
    return uniqueUsers.size;
  }, [allResults]);

  // TEST METADATA: USAGE COUNTS
  const getTakenCount = (testId: string) => {
    const uniqueCandidates = new Set(allResults.filter(r => r.testId === testId).map(r => r.userId));
    return uniqueCandidates.size;
  };

  if (loading) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-50 safe-top safe-bottom">
        <img src={logo} className="w-16 h-16 animate-pulse mb-4" alt="Loading" />
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.4em]">Syncing Student Portal...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden relative">
      {/* TELEMETRY BAR */}
      <div className="bg-slate-950 text-amber-500 py-3 px-8 flex flex-col sm:flex-row justify-between items-center text-[9px] font-black uppercase tracking-[0.3em] shrink-0 border-b border-slate-900 shadow-lg">
         <div className="flex items-center gap-3">
           <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
           <span>Platform Status: Operational</span>
         </div>
         <span className="mt-2 sm:mt-0">Candidates Active Today: {activeUsersToday}</span>
      </div>

      {showLeaderboard && <LeaderboardModal test={showLeaderboard} onClose={() => setShowLeaderboard(null)} />}

      <div className="max-w-7xl mx-auto w-full flex-1 overflow-y-auto no-scrollbar p-6 md:p-12 safe-top safe-bottom">
        <div className="flex flex-col lg:flex-row justify-between items-center mb-12 gap-8 bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 shrink-0">
          <div className="flex items-center gap-6 w-full lg:w-auto">
            <img src={logo} alt="Logo" className="w-16 h-16 object-contain" />
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-slate-950 uppercase tracking-tight leading-none">
                Aureus Medicos
              </h1>
              <p className="text-amber-600 text-[10px] tracking-widest font-bold uppercase mt-1">Certified Student Registry</p>
            </div>
          </div>
          <div className="flex gap-3 w-full lg:w-auto">
            {(user.role === 'admin' || user.role === 'root-admin') && onReturnToAdmin && (
              <button onClick={onReturnToAdmin} className="flex-1 lg:flex-none px-8 py-4 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded-2xl hover:bg-amber-100 transition-all active:scale-95 uppercase tracking-widest shadow-sm">Admin Hub</button>
            )}
            <button onClick={onLogout} className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:text-red-500 transition-all">Logout</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col items-center text-center">
            <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2">Registry Mean</span>
            <span className="text-3xl font-bold text-slate-950">{stats.avgScore}%</span>
          </div>
          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col items-center text-center">
            <span className="text-amber-600 text-[10px] font-bold uppercase tracking-widest mb-2">Personal Peak</span>
            <span className="text-3xl font-bold text-amber-500">{stats.highestScore}%</span>
          </div>
          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col items-center text-center">
            <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2">Simulations Run</span>
            <span className="text-3xl font-bold text-slate-950">{stats.totalTaken}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-12 pb-20">
          <div className="xl:col-span-2 space-y-12">
            <section>
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold text-slate-950 uppercase tracking-tight">Active Mock Registry</h2>
                <span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-4 py-1.5 rounded-full uppercase">{tests.length} Programs</span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {tests.map(test => {
                  const candidateCount = getTakenCount(test.id);
                  return (
                    <div key={test.id} className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-100 hover:border-amber-200 transition-all group flex flex-col relative overflow-hidden h-full">
                      <div className="flex justify-between items-start mb-4">
                        <h3 className="font-bold text-xl text-slate-950 group-hover:text-amber-600 transition-colors uppercase tracking-tight leading-tight">{test.name}</h3>
                        <div className="flex flex-col items-end">
                          <span className="bg-amber-50 text-amber-600 text-[9px] font-black px-3 py-1.5 rounded-xl uppercase shadow-sm whitespace-nowrap">
                            Attempted By {candidateCount}
                          </span>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-400 mb-8 line-clamp-3 font-medium flex-1 italic leading-relaxed">{test.description}</p>
                      <div className="flex flex-wrap gap-3 text-[10px] font-bold uppercase tracking-widest mb-10">
                         <span className="bg-slate-50 border border-slate-100 px-4 py-2 rounded-2xl text-slate-500">{test.totalDurationSeconds / 60} Min</span>
                         <button onClick={(e) => { e.stopPropagation(); setShowLeaderboard(test); }} className="bg-slate-950 text-amber-500 px-6 py-2 rounded-2xl hover:bg-slate-900 transition-all shadow-xl active:scale-95">
                           Rankings
                         </button>
                      </div>
                      <button onClick={() => onStartTest(test)} className="w-full py-5 bg-amber-500 text-slate-950 rounded-2xl font-bold uppercase tracking-[0.2em] text-[10px] transition-all active:scale-95 shadow-xl hover:bg-amber-600">Enter Simulation</button>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
          
          <aside className="bg-white p-10 rounded-[3rem] shadow-sm border border-slate-200 h-fit">
            <h2 className="text-xl font-bold mb-10 text-slate-950 uppercase tracking-tight text-center">Transcript History</h2>
            <div className="space-y-4">
              {history.map(item => (
                <div key={item.id} className="p-6 bg-slate-50 rounded-[1.5rem] border border-slate-100 hover:border-amber-200 transition-all group">
                  <div className="flex justify-between items-start mb-3">
                    <h4 className="text-[11px] font-bold text-slate-950 uppercase truncate max-w-[160px]">{item.testName}</h4>
                    <span className="text-xl font-bold text-slate-950 tracking-tighter">{Math.round((item.score / (item.maxScore || 1)) * 100)}%</span>
                  </div>
                  <div className="flex justify-between items-center">
                     <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{new Date(item.completedAt).toLocaleDateString()}</span>
                     <button onClick={() => onReviewResult(item)} className="text-[9px] font-black text-amber-600 uppercase tracking-widest hover:underline hover:text-amber-700">Detailed Review</button>
                  </div>
                </div>
              ))}
              {history.length === 0 && (
                <div className="py-20 text-center">
                  <p className="text-slate-300 font-bold uppercase text-[10px] tracking-widest">Registry Empty</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
