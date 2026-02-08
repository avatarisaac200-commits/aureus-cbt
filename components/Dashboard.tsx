
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
      setLoading(true);
      try {
        const q = query(collection(db, 'results'), where('testId', '==', test.id), orderBy('completedAt', 'asc'), limit(100));
        const snap = await getDocs(q);
        const results = snap.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult));
        
        const userFirstAttempts: Record<string, ExamResult> = {};
        results.forEach(res => {
          if (!userFirstAttempts[res.userId]) userFirstAttempts[res.userId] = res;
        });

        const sorted = Object.values(userFirstAttempts)
          .sort((a, b) => b.score - a.score)
          .slice(0, 10);
          
        setTopScores(sorted);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetchTop();
  }, [test.id]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm safe-top safe-bottom">
      <div className="w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 border-b-8 border-amber-500">
        <div className="bg-slate-900 p-8 text-center relative">
          <button onClick={onClose} className="absolute top-6 right-6 text-slate-400 hover:text-white"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
          <p className="text-amber-500 text-[10px] font-black uppercase tracking-widest mb-1">Top Scores</p>
          <h2 className="text-xl font-bold text-white uppercase truncate">{test.name}</h2>
          <p className="text-[9px] text-slate-400 uppercase mt-2 italic">Official first attempts only</p>
        </div>
        <div className="p-6 max-h-[60vh] overflow-y-auto no-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center py-20"><div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Finding records...</p></div>
          ) : topScores.length === 0 ? (
            <div className="text-center py-20 text-slate-400 font-bold uppercase text-[10px]">No scores found yet.</div>
          ) : (
            <div className="space-y-2">
              {topScores.map((res, i) => (
                <div key={res.id} className="flex items-center gap-4 p-5 rounded-2xl bg-slate-50 border border-slate-100 shadow-sm">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black ${i === 0 ? 'bg-amber-500 text-slate-950 shadow-md' : 'bg-slate-100 text-slate-400'}`}>{i + 1}</div>
                  <div className="flex-1 text-sm font-bold text-slate-900 truncate uppercase">{res.userName}</div>
                  <div className="text-xl font-black text-slate-950">{Math.round((res.score / (res.maxScore || 1)) * 100)}%</div>
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
    const unsubTests = onSnapshot(query(collection(db, 'tests'), where('isApproved', '==', true), limit(30)), (snap) => {
      setTests(snap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest)));
      setLoading(false);
    });
    const unsubHistory = onSnapshot(query(collection(db, 'results'), where('userId', '==', user.id), orderBy('completedAt', 'desc'), limit(20)), (snap) => {
      setHistory(snap.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult)));
    });
    return () => { unsubTests(); unsubHistory(); };
  }, [user.id]);

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
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-50"><img src={logo} className="w-12 h-12 animate-pulse mb-4" alt="Loading" /><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Opening Portal...</p></div>
    );
  }

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden relative">
      <div className="bg-slate-950 text-amber-500 py-3 px-8 flex justify-between items-center text-[10px] font-black uppercase tracking-widest shrink-0 border-b border-slate-900 shadow-xl z-50 safe-top">
         <div className="flex items-center gap-3"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-sm"></span>Online</div>
         <div className="hidden sm:block">Aureus Registry v3.7</div>
         <button onClick={onLogout} className="text-white hover:text-red-500 transition-colors uppercase text-[9px] font-bold">Logout</button>
      </div>

      {showLeaderboard && <LeaderboardModal test={showLeaderboard} onClose={() => setShowLeaderboard(null)} />}

      <div className="flex-1 overflow-y-auto p-6 md:p-12 pb-24 no-scrollbar">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row justify-between items-center mb-10 gap-6 bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
            <div className="flex items-center gap-6">
              <img src={logo} alt="Logo" className="w-16 h-16" />
              <div>
                <h1 className="text-2xl font-bold text-slate-950 uppercase tracking-tight leading-none">Student Portal</h1>
                <p className="text-amber-600 text-[10px] font-black uppercase mt-1">Aureus Medicos</p>
              </div>
            </div>
            {(user.role === 'admin' || user.role === 'root-admin') && onReturnToAdmin && (
              <button onClick={onReturnToAdmin} className="px-10 py-4 text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-100 rounded-2xl hover:bg-amber-100 uppercase tracking-widest shadow-sm transition-all">Go to Admin Hub</button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {[
              { label: 'Average Score', val: stats.avg + '%', color: 'text-slate-950' },
              { label: 'Highest Score', val: stats.peak + '%', color: 'text-amber-500' },
              { label: 'Exams Completed', val: stats.count, color: 'text-slate-950' }
            ].map((s, i) => (
              <div key={i} className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 text-center hover:border-amber-200 transition-all">
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 block">{s.label}</span>
                <span className={`text-3xl font-black ${s.color}`}>{s.val}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
            <div className="xl:col-span-2 space-y-10">
              <section>
                <div className="flex items-center justify-between mb-8"><h2 className="text-xl font-bold text-slate-950 uppercase">Exam List</h2></div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {tests.map(test => (
                    <div key={test.id} className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 hover:border-amber-400 transition-all flex flex-col h-full group">
                      <div className="flex justify-between items-start mb-4">
                        <h3 className="font-bold text-xl text-slate-950 uppercase truncate leading-tight mr-2 group-hover:text-amber-600 transition-colors">{test.name}</h3>
                        <span className="bg-slate-50 text-slate-500 text-[8px] font-black px-3 py-1.5 rounded-lg uppercase whitespace-nowrap">{test.totalDurationSeconds / 60}m</span>
                      </div>
                      <p className="text-xs text-slate-400 mb-8 font-medium italic line-clamp-2 leading-relaxed">{test.description || 'Practice exam simulation.'}</p>
                      <div className="mt-auto flex justify-between items-center">
                         <button onClick={() => setShowLeaderboard(test)} className="text-[9px] font-bold text-amber-600 uppercase tracking-widest hover:underline flex items-center gap-1">
                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>View Rankings
                         </button>
                         <button onClick={() => onStartTest(test)} className="px-8 py-3 bg-amber-500 text-slate-950 rounded-xl font-bold uppercase tracking-widest text-[9px] hover:bg-amber-600 shadow-lg active:scale-95 transition-all">Take Exam</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            
            <aside className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 h-fit sticky top-12 transition-all">
              <h2 className="text-lg font-bold mb-8 text-slate-950 uppercase text-center">Your Progress</h2>
              <div className="space-y-3">
                {history.map(item => (
                  <div key={item.id} className="p-5 bg-slate-50 rounded-2xl border border-slate-100 hover:border-amber-200 transition-all">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="text-[10px] font-bold text-slate-950 uppercase truncate max-w-[120px]">{item.testName}</h4>
                      <span className="text-lg font-black text-slate-950">{Math.round((item.score / (item.maxScore || 1)) * 100)}%</span>
                    </div>
                    <button onClick={() => onReviewResult(item)} className="text-[9px] font-bold text-amber-600 uppercase tracking-widest hover:underline transition-all">Review Mistakes</button>
                  </div>
                ))}
                {history.length === 0 && (
                  <div className="py-20 text-center italic text-slate-300 font-bold uppercase text-[10px] tracking-widest">No history yet.</div>
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
