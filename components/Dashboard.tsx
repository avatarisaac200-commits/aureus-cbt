
import React, { useState, useEffect } from 'react';
import { User, MockTest, ExamResult } from '../types';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, orderBy } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import ScientificText from './ScientificText';

const logo = '/assets/logo.png?v=2';

// Fixed missing component logic and default export
interface DashboardProps {
  user: User;
  onLogout: () => void;
  onStartTest: (test: MockTest) => void;
  onReviewResult: (result: ExamResult) => void;
  onReturnToAdmin?: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ user, onLogout, onStartTest, onReviewResult, onReturnToAdmin }) => {
  const [tests, setTests] = useState<MockTest[]>([]);
  const [results, setResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const testsQuery = query(collection(db, 'tests'), where('isApproved', '==', true));
    const unsubTests = onSnapshot(testsQuery, (snapshot) => {
      setTests(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as MockTest));
    });

    const resultsQuery = query(collection(db, 'results'), where('userId', '==', user.id), orderBy('completedAt', 'desc'));
    const unsubResults = onSnapshot(resultsQuery, (snapshot) => {
      setResults(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as ExamResult));
      setLoading(false);
    });

    return () => {
      unsubTests();
      unsubResults();
    };
  }, [user.id]);

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
      <header className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={logo} className="w-8 h-8" alt="Logo" />
          <div>
            <h1 className="text-sm font-black uppercase tracking-widest text-slate-900 leading-none">Dashboard</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Aureus Medicos</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {(user.role === 'admin' || user.role === 'root-admin') && onReturnToAdmin && (
            <button onClick={onReturnToAdmin} className="text-[10px] font-black uppercase tracking-widest text-amber-600 border border-amber-200 px-3 py-1.5 rounded-full hover:bg-amber-50 transition-all">
              Admin Panel
            </button>
          )}
          <button onClick={onLogout} className="text-[10px] font-black uppercase tracking-widest text-rose-500 border border-rose-100 px-3 py-1.5 rounded-full hover:bg-rose-50 transition-all">
            Logout
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-8">
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Available Exams</h2>
            <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">{tests.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tests.map(test => (
              <div key={test.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
                <h3 className="font-bold text-slate-900 text-lg mb-1">{test.name}</h3>
                <p className="text-slate-500 text-sm mb-4 line-clamp-2">{test.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    {Math.floor(test.totalDurationSeconds / 60)} MINS
                  </span>
                  <button
                    onClick={() => onStartTest(test)}
                    className="bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl hover:bg-amber-500 transition-colors"
                  >
                    Start Test
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-4">Recent Results</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            {results.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">No results yet.</p>
              </div>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Exam Name</th>
                    <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Score</th>
                    <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                    <th className="px-6 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map(result => (
                    <tr key={result.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-bold text-slate-900 text-sm">{result.testName}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-mono text-amber-600 font-bold">{result.score}/{result.maxScore}</span>
                      </td>
                      <td className="px-6 py-4 text-slate-500 text-xs">
                        {new Date(result.completedAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => onReviewResult(result)}
                          className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-amber-500"
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
