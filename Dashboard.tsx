import React, { useState, useEffect, useMemo } from 'react';
import { User, MockTest, ExamResult, Question, TestSection } from './types';
import { db } from './firebase';
import { collection, getDocs, query, where, addDoc, orderBy } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import ScientificText from './components/ScientificText';
import logo from './assets/logo.png';

interface DashboardProps {
  user: User;
  onLogout: () => void;
  onStartTest: (test: MockTest) => void;
  onReviewResult: (result: ExamResult) => void;
  onReturnToAdmin?: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ user, onLogout, onStartTest, onReviewResult, onReturnToAdmin }) => {
  const [tests, setTests] = useState<MockTest[]>([]);
  const [myCreatedTests, setMyCreatedTests] = useState<MockTest[]>([]);
  const [history, setHistory] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showCreator, setShowCreator] = useState(false);

  // Creator State
  const [tName, setTName] = useState('');
  const [tDesc, setTDesc] = useState('');
  const [tDuration, setTDuration] = useState(60);
  const [qSubject, setQSubject] = useState('');
  const [qTopic, setQTopic] = useState('');
  const [qText, setQText] = useState('');
  const [qOptions, setQOptions] = useState(['', '', '', '']);
  const [qCorrect, setQCorrect] = useState(0);
  const [tempQuestionIds, setTempQuestionIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Calculate user stats from history
  const stats = useMemo(() => {
    if (history.length === 0) return { avgScore: 0, highestScore: 0, totalTaken: 0 };
    const scores = history.map(h => (h.score / h.maxScore) * 100);
    return {
      avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / history.length),
      highestScore: Math.round(Math.max(...scores)),
      totalTaken: history.length
    };
  }, [history]);

  useEffect(() => {
    const handleStatusChange = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);

    const fetchData = async () => {
      try {
        setLoading(true);
        // Fetch approved tests for general listing
        const testsQuery = query(collection(db, 'tests'), where('isApproved', '==', true));
        const testsSnap = await getDocs(testsQuery);
        setTests(testsSnap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest)));

        // Fetch tests created by this user
        const myTestsQuery = query(collection(db, 'tests'), where('createdBy', '==', user.id));
        const myTestsSnap = await getDocs(myTestsQuery);
        setMyCreatedTests(myTestsSnap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest)));

        // Fetch history
        const resultsQuery = query(collection(db, 'results'), where('userId', '==', user.id));
        const resultsSnap = await getDocs(resultsQuery);
        setHistory(resultsSnap.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult))
          .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()));

      } catch (err) {
        console.error("Dashboard error:", err);
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

  const handleAddQuestionToDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const qData = {
        subject: qSubject,
        topic: qTopic,
        text: qText,
        options: qOptions,
        correctAnswerIndex: qCorrect,
        createdBy: user.id,
        createdAt: new Date().toISOString()
      };
      const docRef = await addDoc(collection(db, 'questions'), qData);
      setTempQuestionIds([...tempQuestionIds, docRef.id]);
      // Reset question fields
      setQText('');
      setQOptions(['', '', '', '']);
      setQCorrect(0);
      alert("Question logged and added to draft.");
    } catch (err) {
      alert("Error: " + err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePublishProposedTest = async () => {
    if (tempQuestionIds.length === 0) return alert("Add at least one question first.");
    setIsSubmitting(true);
    try {
      const newTest: Omit<MockTest, 'id'> = {
        name: tName,
        description: tDesc,
        totalDurationSeconds: tDuration * 60,
        sections: [{
          id: `sec_${Date.now()}`,
          name: 'General',
          questionIds: tempQuestionIds,
          marksPerQuestion: 1
        }],
        allowRetake: true,
        createdBy: user.id,
        creatorName: user.name,
        isApproved: false,
        createdAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'tests'), newTest);
      alert("Practice test submitted! An admin will review it shortly.");
      setShowCreator(false);
      setTempQuestionIds([]);
      setTName('');
      setTDesc('');
      
      // Refresh my tests
      const myTestsQuery = query(collection(db, 'tests'), where('createdBy', '==', user.id));
      const myTestsSnap = await getDocs(myTestsQuery);
      setMyCreatedTests(myTestsSnap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest)));
    } catch (err) {
      alert("Error publishing test: " + err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isTestCompleted = (testId: string) => history.some(h => String(h.testId) === String(testId) && h.status === 'completed');

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pt-4 pb-8 md:pt-8 md:pb-12 px-4 md:px-8">
      <div className="max-w-6xl mx-auto w-full">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-10 gap-6 bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <img src={logo} alt="Aureus Medicos" className="w-12 h-12 md:w-16 md:h-16 object-contain" />
            <div className="flex-1">
              <h1 className="text-xl md:text-2xl font-black text-slate-900 uppercase tracking-tighter flex items-center gap-2">
                Aureus CBT
                {isOffline && <span className="bg-amber-100 text-amber-600 text-[8px] px-2 py-0.5 rounded-full border border-amber-200 uppercase">OFFLINE</span>}
              </h1>
              <p className="text-slate-500 text-[10px] md:text-xs font-bold italic">Dr. {user.name}</p>
            </div>
          </div>
          
          <div className="flex gap-2 w-full md:w-auto">
            <button 
              onClick={() => setShowCreator(!showCreator)}
              className="flex-1 md:flex-none px-6 py-3 text-[10px] font-black text-white bg-slate-950 rounded-xl uppercase hover:bg-slate-800 transition-all shadow-lg active:scale-95"
            >
              {showCreator ? 'Exit Creator' : 'Create a Test'}
            </button>
            {user.role === 'admin' && onReturnToAdmin && (
              <button 
                onClick={onReturnToAdmin}
                className="flex-1 md:flex-none px-6 py-3 text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-all active:scale-95"
              >
                Admin
              </button>
            )}
            <button onClick={onLogout} className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase hover:text-red-500 transition-all">Logout</button>
          </div>
        </div>

        {/* Creator Module */}
        {showCreator && (
          <div className="mb-12 bg-white p-6 md:p-12 rounded-[2.5rem] shadow-xl border border-gray-100 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="flex flex-col md:flex-row justify-between items-start mb-10 gap-4">
               <div>
                  <h2 className="text-2xl font-black text-slate-950 uppercase tracking-tight">Community Test Architect</h2>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Design your own practice sets</p>
               </div>
               <div className="bg-amber-50 border border-amber-100 px-5 py-2 rounded-2xl">
                  <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Question Draft: {tempQuestionIds.length}</span>
               </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">
               <div className="space-y-6">
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                    <span className="w-5 h-5 bg-slate-100 rounded-full flex items-center justify-center text-[8px]">1</span> 
                    Test Identity
                  </h3>
                  <div className="space-y-4">
                    <input placeholder="Exam Name (e.g. Cardiology Mock)" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-slate-950/5" value={tName} onChange={e => setTName(e.target.value)} />
                    <textarea placeholder="Instructions or description..." className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold min-h-[100px] outline-none" value={tDesc} onChange={e => setTDesc(e.target.value)} />
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-gray-100">
                      <span className="text-[10px] font-black text-slate-400 uppercase">Timer (Minutes)</span>
                      <input type="number" className="w-16 p-2 bg-white border border-gray-200 rounded-xl text-xs text-center font-black" value={tDuration} onChange={e => setTDuration(parseInt(e.target.value))} />
                    </div>
                    <button 
                      onClick={handlePublishProposedTest}
                      disabled={isSubmitting || tempQuestionIds.length === 0}
                      className="w-full py-5 bg-emerald-600 text-white rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-lg disabled:opacity-20 mt-4 active:scale-95 transition-all"
                    >
                      Publish for Admin Review
                    </button>
                  </div>
               </div>

               <div className="p-8 bg-slate-950 rounded-[2.5rem] border-2 border-slate-900 shadow-2xl">
                  <h3 className="text-[10px] font-black text-amber-500 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                    <span className="w-5 h-5 bg-amber-500/20 rounded-full flex items-center justify-center text-[8px]">2</span> 
                    Build Questions
                  </h3>
                  <form onSubmit={handleAddQuestionToDraft} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <input placeholder="Subject" className="w-full p-4 bg-slate-900 border border-slate-800 rounded-2xl text-xs font-bold text-white outline-none focus:border-amber-500" value={qSubject} onChange={e => setQSubject(e.target.value)} required />
                      <input placeholder="Topic" className="w-full p-4 bg-slate-900 border border-slate-800 rounded-2xl text-xs font-bold text-white outline-none focus:border-amber-500" value={qTopic} onChange={e => setQTopic(e.target.value)} required />
                    </div>
                    <textarea placeholder="Write question here..." className="w-full p-4 bg-slate-900 border border-slate-800 rounded-2xl text-xs font-bold text-white min-h-[100px] outline-none focus:border-amber-500" value={qText} onChange={e => setQText(e.target.value)} required />
                    <div className="space-y-2">
                      {qOptions.map((opt, idx) => (
                        <div key={idx} className="flex gap-3 items-center">
                          <input type="radio" checked={qCorrect === idx} onChange={() => setQCorrect(idx)} className="accent-amber-500 w-4 h-4" />
                          <input placeholder={`Option ${String.fromCharCode(65+idx)}`} className="flex-1 p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-white outline-none focus:border-amber-500/50" value={opt} onChange={e => {
                            const n = [...qOptions]; n[idx] = e.target.value; setQOptions(n);
                          }} required />
                        </div>
                      ))}
                    </div>
                    <button disabled={isSubmitting} className="w-full py-4 bg-amber-500 text-slate-950 rounded-2xl font-black uppercase text-[10px] tracking-widest mt-4 hover:bg-amber-400 active:scale-95 transition-all">
                      {isSubmitting ? 'Saving...' : 'Add Question to Test'}
                    </button>
                  </form>
               </div>
            </div>
          </div>
        )}

        {/* User Stats Banner */}
        <div className="grid grid-cols-3 gap-3 md:gap-6 mb-12">
          <div className="bg-white p-5 md:p-8 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center">
            <span className="text-slate-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest mb-2 text-center">Avg Score</span>
            <span className="text-xl md:text-4xl font-black text-slate-950">{stats.avgScore}%</span>
          </div>
          <div className="bg-white p-5 md:p-8 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center">
            <span className="text-slate-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest mb-2 text-center">Top Result</span>
            <span className="text-xl md:text-4xl font-black text-amber-500">{stats.highestScore}%</span>
          </div>
          <div className="bg-white p-5 md:p-8 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center">
            <span className="text-slate-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest mb-2 text-center">Attempts</span>
            <span className="text-xl md:text-4xl font-black text-slate-950">{stats.totalTaken}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 md:gap-12">
          <div className="lg:col-span-2 space-y-12">
            {/* Approved Tests Bank */}
            <section>
              <h2 className="text-xl font-black mb-6 text-slate-900 uppercase tracking-tight flex items-center gap-3">
                Global Exam Bank
                <span className="bg-amber-500 text-slate-950 text-[10px] px-2 py-0.5 rounded-lg">{tests.length}</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {tests.length === 0 ? (
                  <div className="col-span-full p-20 text-center bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100">
                    <p className="text-slate-300 font-black uppercase text-xs tracking-[0.2em]">Bank is currently offline.</p>
                  </div>
                ) : (
                  tests.map(test => {
                    const completed = isTestCompleted(test.id);
                    return (
                      <div key={test.id} className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl transition-all group flex flex-col relative overflow-hidden">
                        {completed && <div className="absolute top-0 right-0 bg-emerald-500 text-white text-[8px] font-black uppercase px-4 py-1.5 rounded-bl-xl tracking-widest z-10 shadow-sm">Completed</div>}
                        <h3 className="font-black text-lg text-slate-900 mb-2 group-hover:text-amber-600 transition-colors uppercase tracking-tight leading-tight pr-10">{test.name}</h3>
                        <p className="text-[10px] text-slate-400 mb-6 line-clamp-3 font-medium flex-1">"{test.description}"</p>
                        <div className="flex gap-2 text-[8px] font-black text-slate-400 uppercase tracking-widest mb-8">
                           <span className="bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-full">{test.totalDurationSeconds / 60} MINS</span>
                           <span className="bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-full">Public</span>
                        </div>
                        <button 
                          onClick={() => onStartTest(test)}
                          className="w-full py-4 bg-slate-950 text-amber-500 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95 shadow-lg"
                        >
                          Begin Examination
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* Student's Own Submissions */}
            {myCreatedTests.length > 0 && (
              <section className="animate-in fade-in slide-in-from-bottom-4">
                <h2 className="text-xl font-black mb-6 text-slate-900 uppercase tracking-tight flex items-center gap-3">
                  My Test Submissions
                  <span className="bg-slate-200 text-slate-500 text-[10px] px-2 py-0.5 rounded-lg">{myCreatedTests.length}</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {myCreatedTests.map(test => (
                    <div key={test.id} className="bg-white p-8 rounded-[2rem] border border-gray-200 shadow-sm group hover:border-amber-200 transition-all">
                      <div className="flex justify-between items-start mb-4">
                        <h4 className="text-sm font-black uppercase tracking-tight text-slate-900">{test.name}</h4>
                        <div className={`text-[8px] font-black px-3 py-1.5 rounded-full uppercase flex items-center gap-1.5 ${test.isApproved ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-amber-50 text-amber-600 border border-amber-100'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${test.isApproved ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`}></span>
                          {test.isApproved ? 'Live' : 'Pending'}
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-6">{test.sections[0].questionIds.length} Proposed Questions</p>
                      <button disabled className="w-full py-3 bg-slate-50 text-slate-300 rounded-xl text-[9px] font-black uppercase tracking-widest border border-slate-100 cursor-not-allowed">Review Locked</button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* History Sidebar */}
          <aside className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-200 h-fit sticky top-8">
            <h2 className="text-xl font-black mb-8 text-slate-950 uppercase tracking-tight text-center">Score Log</h2>
            <div className="space-y-4">
              {history.length === 0 ? (
                <p className="text-[10px] font-black text-slate-300 text-center py-12 uppercase tracking-[0.3em]">No Recorded Attempts</p>
              ) : (
                history.map(item => (
                  <div key={item.id} className="p-5 bg-slate-50 rounded-2xl border border-slate-100 hover:border-amber-200 hover:bg-white transition-all group">
                    <div className="flex justify-between items-start mb-3">
                      <h4 className="text-[10px] font-black text-slate-950 uppercase truncate max-w-[140px] tracking-tight">{item.testName}</h4>
                      <span className="text-xl font-black text-slate-950 tracking-tighter leading-none">{Math.round((item.score / item.maxScore) * 100)}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                       <span className="text-[8px] text-slate-400 font-bold uppercase">{new Date(item.completedAt).toLocaleDateString()}</span>
                       <button onClick={() => onReviewResult(item)} className="text-[8px] font-black text-amber-600 uppercase tracking-widest hover:underline active:scale-95">Review Mistakes</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
