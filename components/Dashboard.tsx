
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
        // Fetch all results for this test. Filtering on client prevents index errors.
        const q = query(
          collection(db, 'results'), 
          where('testId', '==', test.id)
        );
        const snap = await getDocs(q);
        const results = snap.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult));
        
        // Sort results by score locally
        const sorted = results
          .sort((a, b) => b.score - a.score)
          .slice(0, 10);
          
        setTopScores(sorted);
      } catch (err) {
        console.error("Leaderboard failed:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchTop();
  }, [test.id]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm safe-top safe-bottom">
      <div className="w-full max-w-lg bg-white rounded-[2rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="bg-slate-900 p-8 text-center relative border-b-4 border-amber-500">
          <button onClick={onClose} className="absolute top-6 right-6 text-slate-500 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
          <p className="text-amber-500 text-[9px] font-bold uppercase tracking-[0.3em] mb-2">Leaderboard</p>
          <h2 className="text-xl font-bold text-white uppercase tracking-tight">{test.name}</h2>
        </div>
        <div className="p-8 max-h-[60vh] overflow-y-auto no-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Loading List...</p>
            </div>
          ) : topScores.length === 0 ? (
            <p className="text-center py-10 text-slate-400 font-bold text-[10px] uppercase tracking-widest">No results yet</p>
          ) : (
            <div className="space-y-3">
              {topScores.map((res, i) => (
                <div key={res.id} className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border border-gray-100">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${i === 0 ? 'bg-amber-500 text-slate-950' : i === 1 ? 'bg-slate-300 text-slate-700' : i === 2 ? 'bg-amber-700 text-white' : 'bg-slate-200 text-slate-400'}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] font-bold text-slate-900 uppercase truncate">{res.userName || 'Student'}</p>
                    <p className="text-[8px] text-slate-400 font-bold uppercase">{new Date(res.completedAt).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-950">{Math.round((res.score / (res.maxScore || 1)) * 100)}%</p>
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

    return () => { unsubTests(); unsubResults(); };
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

  if (loading) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-50 safe-top safe-bottom">
        <img src={logo} className="w-16 h-16 animate-pulse mb-4" alt="Loading" />
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.4em]">Loading Dashboard...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden relative">
      {showLeaderboard && <LeaderboardModal test={showLeaderboard} onClose={() => setShowLeaderboard(null)} />}

      <div className="max-w-6xl mx-auto w-full flex-1 overflow-y-auto no-scrollbar p-4 md:p-8 safe-top safe-bottom">
        <div className="flex flex-col md:flex-row justify-between items-center mb-10 gap-6 bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 shrink-0">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <img src={logo} alt="Logo" className="w-14 h-14 object-contain" />
            <div className="flex-1">
              <h1 className="text-xl font-bold text-slate-950 uppercase tracking-tight leading-none">
                Aureus Medicos
              </h1>
              <p className="text-amber-600 text-[9px] tracking-widest font-bold uppercase mt-1">Student Area</p>
            </div>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            {(user.role === 'admin' || user.role === 'root-admin') && onReturnToAdmin && (
              <button onClick={onReturnToAdmin} className="flex-1 md:flex-none px-6 py-3 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-all active:scale-95 uppercase tracking-widest">Admin Hub</button>
            )}
            <button onClick={onLogout} className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:text-red-500 transition-all">Logout</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 md:gap-6 mb-12">
          <div className="bg-white p-6 rounded-[1.5rem] shadow-sm border border-slate-100 flex flex-col items-center">
            <span className="text-slate-400 text-[8px] md:text-[9px] font-bold uppercase tracking-widest mb-2">Average</span>
            <span className="text-xl md:text-3xl font-bold text-slate-900">{stats.avgScore}%</span>
          </div>
          <div className="bg-white p-6 rounded-[1.5rem] shadow-sm border border-slate-100 flex flex-col items-center">
            <span className="text-amber-600 text-[8px] md:text-[9px] font-bold uppercase tracking-widest mb-2">Best</span>
            <span className="text-xl md:text-3xl font-bold text-amber-500">{stats.highestScore}%</span>
          </div>
          <div className="bg-white p-6 rounded-[1.5rem] shadow-sm border border-slate-100 flex flex-col items-center">
            <span className="text-slate-400 text-[8px] md:text-[9px] font-bold uppercase tracking-widest mb-2">Tests</span>
            <span className="text-xl md:text-3xl font-bold text-slate-900">{stats.totalTaken}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 md:gap-12 pb-10">
          <div className="lg:col-span-2 space-y-10">
            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-slate-900 uppercase tracking-tight">Available Tests</h2>
                <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-3 py-1 rounded-full">{tests.length} Active</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {tests.map(test => (
                  <div key={test.id} className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 hover:border-amber-200 transition-all group flex flex-col relative overflow-hidden">
                    <h3 className="font-bold text-lg text-slate-900 mb-2 group-hover:text-amber-600 transition-colors uppercase tracking-tight">{test.name}</h3>
                    <p className="text-[10px] text-slate-400 mb-6 line-clamp-3 font-medium flex-1 italic">{test.description}</p>
                    <div className="flex flex-wrap gap-2 text-[8px] font-bold uppercase tracking-widest mb-8">
                       <span className="bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-full text-slate-500">{test.totalDurationSeconds / 60} min</span>
                       <button onClick={(e) => { e.stopPropagation(); setShowLeaderboard(test); }} className="bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full text-amber-600 hover:bg-amber-500 hover:text-white transition-all">
                         Ranking
                       </button>
                    </div>
                    <button onClick={() => onStartTest(test)} className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase tracking-widest text-[10px] transition-all active:scale-95 shadow-lg">Start Test</button>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <aside className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-200 h-fit">
            <h2 className="text-lg font-bold mb-8 text-slate-950 uppercase tracking-tight text-center">My History</h2>
            <div className="space-y-4">
              {history.map(item => (
                <div key={item.id} className="p-5 bg-slate-50 rounded-xl border border-slate-100 hover:border-amber-200 transition-all group">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="text-[10px] font-bold text-slate-900 uppercase truncate max-w-[140px]">{item.testName}</h4>
                    <span className="text-lg font-bold text-slate-950 tracking-tighter">{Math.round((item.score / (item.maxScore || 1)) * 100)}%</span>
                  </div>
                  <div className="flex justify-between items-center">
                     <span className="text-[8px] text-slate-400 font-bold uppercase">{new Date(item.completedAt).toLocaleDateString()}</span>
                     <button onClick={() => onReviewResult(item)} className="text-[8px] font-bold text-amber-600 uppercase tracking-widest hover:underline">Review</button>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
