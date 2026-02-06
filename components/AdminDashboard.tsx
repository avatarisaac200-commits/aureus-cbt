
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, Question, MockTest, TestSection, ExamResult } from '../types';
import { db } from '../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, updateDoc, where, limit } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { GoogleGenAI, Type } from '@google/genai';
import ScientificText from './ScientificText';
import { LOGO_URL } from '../App';

interface AdminDashboardProps {
  user: User;
  onLogout: () => void;
  onSwitchToStudent: () => void;
}

type AdminTab = 'questions' | 'tests' | 'approvals' | 'import';

const LeaderboardModal: React.FC<{ test: MockTest, onClose: () => void }> = ({ test, onClose }) => {
  const [topScores, setTopScores] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTop = async () => {
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
                    <p className="text-sm font-black text-slate-950">{Math.round((res.score / (res.maxScore || 1)) * 100)}%</p>
                    <p className="text-[8px] font-black text-slate-400 uppercase">{res.score}/{res.maxScore}</p>
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

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onLogout, onSwitchToStudent }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('questions');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [testList, setTestList] = useState<MockTest[]>([]);
  const [allResults, setAllResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState<MockTest | null>(null);
  
  const [importStatus, setImportStatus] = useState<'idle' | 'parsing' | 'review'>('idle');
  const [importProgress, setImportProgress] = useState(0);
  const [stagedQuestions, setStagedQuestions] = useState<Omit<Question, 'id' | 'createdAt' | 'createdBy'>[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [qSubject, setQSubject] = useState('');
  const [qTopic, setQTopic] = useState('');
  const [qText, setQText] = useState('');
  const [qOptions, setQOptions] = useState(['', '', '', '']);
  const [qCorrect, setQCorrect] = useState(0);
  const [qExplanation, setQExplanation] = useState('');

  const [tName, setTName] = useState('');
  const [tDesc, setTDesc] = useState('');
  const [tDuration, setTDuration] = useState(60);
  const [tRetake, setTRetake] = useState(true);
  const [tSections, setTSections] = useState<TestSection[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const qSnap = await getDocs(query(collection(db, 'questions'), orderBy('createdAt', 'desc')));
      setQuestions(qSnap.docs.map(d => ({ ...d.data(), id: d.id } as Question)));
      
      const tSnap = await getDocs(query(collection(db, 'tests'), orderBy('createdAt', 'desc')));
      setTestList(tSnap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest)));

      const rSnap = await getDocs(collection(db, 'results'));
      setAllResults(rSnap.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult)));
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const processDocument = async (file: File) => {
    setImportStatus('parsing');
    setImportProgress(5);
    
    const progressInterval = setInterval(() => {
      setImportProgress(prev => {
        if (prev >= 95) return prev;
        // Natural slowing progress to avoid finishing early
        const inc = prev < 30 ? 4 : (prev < 60 ? 2 : (prev < 85 ? 0.8 : 0.2));
        return prev + inc;
      });
    }, 1000);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });
      const base64Data = await base64Promise;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          { parts: [{ inlineData: { mimeType: 'application/pdf', data: base64Data } }, { text: "Analyze this document and extract all medical questions. Return an array of objects. Use LaTeX for scientific notation. Structure: { \"subject\", \"topic\", \"text\", \"options\" (4), \"correctAnswerIndex\", \"explanation\" }." }] }
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                subject: { type: Type.STRING },
                topic: { type: Type.STRING },
                text: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: 4, maxItems: 4 },
                correctAnswerIndex: { type: Type.INTEGER },
                explanation: { type: Type.STRING },
              },
              required: ['subject', 'topic', 'text', 'options', 'correctAnswerIndex', 'explanation'],
            },
          },
        },
      });

      const data = JSON.parse(response.text || '[]');
      clearInterval(progressInterval);
      setImportProgress(100);
      setStagedQuestions(data);
      setTimeout(() => { setImportStatus('review'); setImportProgress(0); }, 800);
    } catch (err) {
      clearInterval(progressInterval);
      console.error(err);
      alert("Analysis failed.");
      setImportStatus('idle');
      setImportProgress(0);
    }
  };

  const commitImport = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      for (const q of stagedQuestions) {
        await addDoc(collection(db, 'questions'), { ...q, createdBy: user.id, createdAt: new Date().toISOString() });
      }
      alert(`${stagedQuestions.length} items integrated.`);
      setStagedQuestions([]); setImportStatus('idle'); fetchData();
    } catch (err) { alert(err); } finally { setLoading(false); }
  };

  const handleAddOrUpdateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const qData = {
      subject: qSubject || 'Uncategorized', topic: qTopic || 'General', text: qText || '', options: qOptions,
      correctAnswerIndex: qCorrect, explanation: qExplanation, updatedAt: new Date().toISOString()
    };
    try {
      if (editingId) { await updateDoc(doc(db, 'questions', editingId), qData); }
      else { await addDoc(collection(db, 'questions'), { ...qData, createdBy: user.id, createdAt: new Date().toISOString() }); }
      setEditingId(null); setQSubject(''); setQTopic(''); setQText(''); setQOptions(['','','','']); setQCorrect(0); setQExplanation('');
      fetchData();
    } catch (err) { alert(err); } finally { setLoading(false); }
  };

  const getStatusMessage = (progress: number) => {
    if (progress < 15) return "Reading document layers...";
    if (progress < 35) return "Extracting clinical tokens...";
    if (progress < 60) return "Parsing multi-choice options...";
    if (progress < 85) return "Generating medical rationales...";
    return "Finalizing scientific formatting...";
  };

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden">
      {showLeaderboard && <LeaderboardModal test={showLeaderboard} onClose={() => setShowLeaderboard(null)} />}
      <div className="bg-white border-b border-gray-100 p-6 flex flex-col md:flex-row justify-between items-center gap-4 safe-top">
        <div className="flex items-center gap-4">
          <img src={LOGO_URL} className="w-12 h-12" alt="Logo" />
          <div>
            <h1 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Aureus Admin</h1>
            <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Workspace</p>
          </div>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button onClick={onSwitchToStudent} className="flex-1 md:flex-none px-4 py-2 text-[10px] font-black text-slate-600 border border-gray-200 rounded-xl uppercase hover:bg-slate-50">Student View</button>
          <button onClick={onLogout} className="px-4 py-2 text-[10px] font-black text-red-600 border border-red-100 rounded-xl uppercase">Logout</button>
        </div>
      </div>

      <nav className="flex bg-white px-6 border-b border-gray-100 overflow-x-auto no-scrollbar">
        {['questions', 'import', 'tests', 'approvals'].map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab as AdminTab)} className={`px-6 py-4 text-[9px] font-black uppercase tracking-widest whitespace-nowrap ${activeTab === tab ? 'border-b-4 border-amber-500 text-slate-950' : 'text-slate-400'}`}>
            {tab}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-6 md:p-10 no-scrollbar">
        {activeTab === 'import' && (
          <div className="max-w-3xl mx-auto py-10">
            {importStatus === 'idle' && (
              <div className="bg-white p-12 rounded-[3rem] border-4 border-dashed border-slate-100 text-center hover:border-amber-500 transition-all cursor-pointer group" onClick={() => fileInputRef.current?.click()}>
                 <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={(e) => e.target.files?.[0] && processDocument(e.target.files[0])} />
                 <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
                   <svg className="w-10 h-10 text-slate-300 group-hover:text-amber-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                 </div>
                 <h3 className="text-xl font-black text-slate-950 mb-4 uppercase tracking-tight">Bulk PDF Knowledge Import</h3>
                 <p className="text-xs text-slate-400 mb-8 italic px-10">Gemini AI will scan your PDF documents to extract medical questions and generate high-fidelity rationales automatically.</p>
                 <button className="px-12 py-5 bg-slate-950 text-amber-500 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] shadow-xl active:scale-95 transition-all">Upload Study Material</button>
              </div>
            )}
            
            {importStatus === 'parsing' && (
              <div className="bg-white p-12 rounded-[3rem] shadow-2xl border border-gray-100 text-center animate-in fade-in zoom-in duration-300">
                <div className="mb-10 flex flex-col items-center">
                  <div className="w-24 h-24 bg-slate-50 rounded-[2rem] flex items-center justify-center mb-6 relative">
                    <svg className="w-12 h-12 text-amber-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                    </svg>
                    <div className="absolute -top-2 -right-2 bg-slate-950 text-amber-500 text-[8px] font-black px-3 py-1.5 rounded-full animate-pulse shadow-lg border border-amber-500/20">AI CORE ACTIVE</div>
                  </div>
                  <h3 className="text-2xl font-black text-slate-950 mb-3 uppercase tracking-tight">Analyzing Knowledge Base</h3>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest h-4">{getStatusMessage(importProgress)}</p>
                </div>

                <div className="relative max-w-md mx-auto">
                  <div className="flex mb-4 items-center justify-between">
                    <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-3 py-1 rounded-full uppercase tracking-tighter">
                      Syncing Tokens...
                    </span>
                    <span className="text-sm font-black text-slate-950">
                      {Math.round(importProgress)}%
                    </span>
                  </div>
                  <div className="overflow-hidden h-4 mb-4 text-xs flex rounded-full bg-slate-100 border border-slate-200">
                    <div 
                      style={{ width: `${importProgress}%` }} 
                      className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-amber-500 transition-all duration-700 ease-out relative"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
                    </div>
                  </div>
                </div>
                
                <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.4em] mt-12 animate-pulse">
                  Neural engine processing • do not refresh
                </p>
              </div>
            )}

            {importStatus === 'review' && (
              <div className="space-y-6 animate-in slide-in-from-bottom duration-500">
                <div className="flex flex-col md:flex-row justify-between items-center bg-white p-8 rounded-[2rem] border border-gray-100 shadow-xl sticky top-4 z-20 gap-4">
                  <div>
                    <h3 className="text-xl font-black text-slate-950 uppercase tracking-tight">Review Staged Content</h3>
                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">{stagedQuestions.length} Items successfully extracted</p>
                  </div>
                  <button onClick={commitImport} className="w-full md:w-auto px-12 py-5 bg-slate-950 text-amber-500 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl hover:bg-slate-800 active:scale-95 transition-all">Integrate All Items</button>
                </div>
                <div className="grid grid-cols-1 gap-6">
                  {stagedQuestions.map((q, i) => (
                    <div key={i} className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:border-amber-500 transition-colors">
                      <div className="flex justify-between items-start mb-6">
                        <span className="text-[9px] font-black bg-slate-100 text-slate-400 px-3 py-1 rounded-full uppercase">{q.subject}</span>
                        <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest">{q.topic}</span>
                      </div>
                      <p className="text-sm font-bold text-slate-800 mb-8 leading-relaxed"><ScientificText text={q.text} /></p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 opacity-60">
                        {q.options.map((o, idx) => (
                          <div key={idx} className={`text-[10px] p-4 rounded-xl border flex items-center gap-3 ${idx === q.correctAnswerIndex ? 'bg-emerald-50 border-emerald-500/20 text-emerald-900' : 'bg-slate-50 border-slate-100'}`}>
                            <span className="font-black opacity-40">{String.fromCharCode(65 + idx)}</span>
                            <ScientificText text={o} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'questions' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
            <div className="xl:col-span-1">
              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 sticky top-10">
                <h3 className="text-lg font-black text-slate-950 mb-6 uppercase tracking-tight">{editingId ? 'Edit' : 'Create'} Question</h3>
                <form onSubmit={handleAddOrUpdateQuestion} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <input placeholder="Subject" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold" value={qSubject} onChange={e => setQSubject(e.target.value)} required />
                    <input placeholder="Topic" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold" value={qTopic} onChange={e => setQTopic(e.target.value)} required />
                  </div>
                  <textarea placeholder="Text" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold h-32" value={qText} onChange={e => setQText(e.target.value)} required />
                  {qOptions.map((o, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input type="radio" checked={qCorrect === i} onChange={() => setQCorrect(i)} className="accent-amber-500" />
                      <input className="flex-1 p-3 bg-slate-50 border border-gray-100 rounded-xl text-xs" value={o} onChange={e => { const n = [...qOptions]; n[i] = e.target.value; setQOptions(n); }} required />
                    </div>
                  ))}
                  <button className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase text-xs shadow-lg active:scale-95 transition-all">Save Item</button>
                </form>
              </div>
            </div>
            <div className="xl:col-span-2 space-y-4">
               {questions.length === 0 ? (
                 <div className="py-20 text-center bg-white rounded-[2rem] border-2 border-dashed border-slate-100">
                    <p className="text-slate-300 font-black uppercase text-[10px] tracking-[0.3em]">Database empty</p>
                 </div>
               ) : (
                 questions.map(q => (
                   <div key={q.id} className="bg-white p-6 rounded-2xl border border-gray-100 flex justify-between items-start hover:border-amber-200 transition-all group">
                     <div>
                       <div className="flex items-center gap-2 mb-3">
                         <span className="text-[8px] font-black bg-amber-50 text-amber-600 px-2.5 py-1 rounded uppercase">{q.subject}</span>
                         <span className="text-[8px] font-black text-slate-300 uppercase">{q.topic}</span>
                       </div>
                       <p className="text-sm font-bold text-slate-800"><ScientificText text={q.text} /></p>
                     </div>
                     <button onClick={() => deleteDoc(doc(db, 'questions', q.id!)).then(fetchData)} className="text-slate-300 hover:text-red-500 transition-colors p-2 group-hover:bg-red-50 rounded-lg">
                       <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                     </button>
                   </div>
                 ))
               )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
