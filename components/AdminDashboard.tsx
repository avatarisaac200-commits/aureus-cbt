import React, { useState, useEffect, useRef, useMemo } from 'react';
import { User, Question, MockTest } from '../types';
import { db } from '../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, updateDoc, onSnapshot, writeBatch, limit } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { GoogleGenAI, Type } from '@google/genai';
import ScientificText from './ScientificText';
import logo from '../assets/logo.png';

interface AdminDashboardProps {
  user: User;
  initialTab?: AdminTab;
  onLogout: () => void;
  onSwitchToStudent: () => void;
}

type AdminTab = 'questions' | 'tests' | 'import';
type StagedQuestion = Omit<Question, 'id' | 'createdAt' | 'createdBy'>;

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, initialTab = 'questions', onLogout, onSwitchToStudent }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [importStatus, setImportStatus] = useState<'idle' | 'parsing' | 'review'>('idle');
  const [importProgress, setImportProgress] = useState(0);
  const [stagedQuestions, setStagedQuestions] = useState<StagedQuestion[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Question Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [qSubject, setQSubject] = useState('');
  const [qTopic, setQTopic] = useState('');
  const [qText, setQText] = useState('');
  const [qOptions, setQOptions] = useState(['', '', '', '']);
  const [qCorrect, setQCorrect] = useState(0);
  const [qExplanation, setQExplanation] = useState('');

  // Simulation Form state
  const [testName, setTestName] = useState('');
  const [testDesc, setTestDesc] = useState('');
  const [testDuration, setTestDuration] = useState(60);
  const [testSelectedQuestions, setTestSelectedQuestions] = useState<string[]>([]);

  useEffect(() => {
    // Limited fetch for performance
    const unsubQ = onSnapshot(query(collection(db, 'questions'), orderBy('createdAt', 'desc'), limit(200)), (snap) => {
      setQuestions(snap.docs.map(d => ({ ...d.data(), id: d.id } as Question)));
    });
    return () => unsubQ();
  }, []);

  const filteredQuestions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return questions;
    return questions.filter(item => 
      item.text.toLowerCase().includes(q) || 
      item.subject.toLowerCase().includes(q) || 
      item.topic.toLowerCase().includes(q)
    );
  }, [questions, searchQuery]);

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const data = {
      subject: qSubject || 'General',
      topic: qTopic || 'General',
      text: qText,
      options: qOptions,
      correctAnswerIndex: qCorrect,
      explanation: qExplanation,
    };
    try {
      if (editingId) {
        await updateDoc(doc(db, 'questions', editingId), { ...data, updatedAt: new Date().toISOString() });
        alert("Clinical record updated.");
      } else {
        await addDoc(collection(db, 'questions'), { ...data, createdBy: user.id, createdAt: new Date().toISOString() });
        alert("Clinical record saved.");
      }
      resetForm();
    } catch (e) { alert("Registry error."); }
    finally { setLoading(false); }
  };

  const resetForm = () => {
    setEditingId(null); setQSubject(''); setQTopic(''); setQText(''); setQOptions(['','','','']); setQCorrect(0); setQExplanation('');
  };

  const startEdit = (q: Question) => {
    setEditingId(q.id); setQSubject(q.subject); setQTopic(q.topic); setQText(q.text); setQOptions(q.options); setQCorrect(q.correctAnswerIndex); setQExplanation(q.explanation || '');
    setActiveTab('questions');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const runDeDuplication = async () => {
    if (!window.confirm("Run Automated Cleanup? Identical narratives will be merged.")) return;
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'questions'));
      const all = snap.docs.map(d => ({ ...d.data(), id: d.id } as Question))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const seen = new Set<string>();
      const toDelete: string[] = [];
      all.forEach(q => {
        const norm = q.text.toLowerCase().replace(/\s+/g, ' ').trim();
        if (seen.has(norm)) toDelete.push(q.id); else seen.add(norm);
      });
      if (toDelete.length > 0) {
        const batch = writeBatch(db);
        toDelete.forEach(id => batch.delete(doc(db, 'questions', id)));
        await batch.commit();
        alert(`Registry optimized. Purged ${toDelete.length} duplicates.`);
      } else { alert("Registry is already clean."); }
    } catch (e) { alert("Cleanup failed."); }
    finally { setLoading(false); }
  };

  const processPDF = async (file: File) => {
    setImportStatus('parsing');
    setImportProgress(10);
    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });
      const base64Data = await base64Promise;
      setImportProgress(40);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [{ inlineData: { mimeType: 'application/pdf', data: base64Data } }, { text: "Extract medical MCQs as JSON array: subject, topic, text, options(4), correctAnswerIndex(0-3), explanation." }]
        },
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
            }
          }
        }
      });
      setStagedQuestions(JSON.parse(response.text) as StagedQuestion[]);
      setImportProgress(100);
      setTimeout(() => setImportStatus('review'), 500);
    } catch (err) { alert("AI parsing error."); setImportStatus('idle'); }
  };

  const commitBatch = async () => {
    if (!window.confirm(`Commit ${stagedQuestions.length} items to bank?`)) return;
    setIsCommitting(true);
    try {
      const batch = writeBatch(db);
      stagedQuestions.forEach(q => {
        const ref = doc(collection(db, 'questions'));
        batch.set(ref, { ...q, createdBy: user.id, createdAt: new Date().toISOString() });
      });
      await batch.commit();
      setStagedQuestions([]);
      setImportStatus('idle');
      alert("Batch commit successful.");
    } catch (e) { alert("Commit error."); }
    finally { setIsCommitting(false); }
  };

  const handleCreateTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (testSelectedQuestions.length === 0) return alert("Select clinical items from matrix.");
    setLoading(true);
    try {
      await addDoc(collection(db, 'tests'), {
        name: testName,
        description: testDesc,
        totalDurationSeconds: testDuration * 60,
        sections: [{ id: 'main', name: 'Master Section', questionIds: testSelectedQuestions, marksPerQuestion: 1 }],
        allowRetake: true,
        createdBy: user.id,
        creatorName: user.name,
        isApproved: true,
        createdAt: new Date().toISOString()
      });
      setTestName(''); setTestDesc(''); setTestSelectedQuestions([]);
      alert("Simulation module deployed.");
      setActiveTab('tests');
    } catch (e) { alert("Deployment error."); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden">
      <div className="bg-white border-b border-slate-100 p-6 flex flex-col md:flex-row justify-between items-center gap-4 shrink-0 safe-top">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-12 h-12" alt="Logo" />
          <div>
            <h1 className="text-xl font-bold text-slate-900 uppercase tracking-tight leading-none">CBT Admin</h1>
            <p className="text-[9px] font-bold text-amber-600 uppercase tracking-widest mt-1">Registry Hub</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onSwitchToStudent} className="px-5 py-2.5 text-[10px] font-bold text-slate-600 border border-slate-200 rounded-xl uppercase tracking-widest hover:bg-slate-50 transition-all">Student Portal</button>
          <button onClick={onLogout} className="px-5 py-2.5 text-[10px] font-bold text-red-600 border border-red-50 rounded-xl uppercase tracking-widest hover:bg-red-50 transition-all">Logout</button>
        </div>
      </div>

      <nav className="flex bg-white px-6 border-b border-slate-100 overflow-x-auto no-scrollbar shrink-0">
        {['questions', 'import', 'tests'].map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab as AdminTab)} className={`px-8 py-4 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap transition-all ${activeTab === tab ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50/50' : 'text-slate-400'}`}>{tab}</button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-6 md:p-10 no-scrollbar safe-bottom">
        {activeTab === 'import' && (
          <div className="max-w-4xl mx-auto py-12">
            {importStatus === 'idle' && (
              <div className="bg-white p-20 rounded-[3rem] border-4 border-dashed border-slate-100 text-center cursor-pointer hover:border-amber-400 transition-all" onClick={() => fileInputRef.current?.click()}>
                 <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={(e) => e.target.files?.[0] && processPDF(e.target.files[0])} />
                 <h3 className="text-2xl font-bold text-slate-950 mb-4 uppercase tracking-tight">AI PDF Batch Import</h3>
                 <p className="text-xs text-slate-400 mb-10 italic">Upload Source Material to Generate Registry Entries.</p>
                 <button className="px-14 py-5 bg-slate-950 text-amber-500 rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-2xl">Select PDF Document</button>
              </div>
            )}
            {importStatus === 'parsing' && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-6"></div>
                <h3 className="text-xl font-bold text-slate-950 uppercase mb-2">Analyzing clinical data</h3>
                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest animate-pulse">{importProgress}% Completed</p>
              </div>
            )}
            {importStatus === 'review' && (
              <div className="space-y-6 animate-in slide-in-from-bottom-6 duration-500">
                <div className="bg-slate-950 p-10 rounded-[2.5rem] border-b-8 border-amber-500 flex flex-col md:flex-row justify-between items-center sticky top-0 z-50 shadow-2xl gap-6">
                  <div>
                    <h2 className="text-white text-xl font-bold uppercase">{stagedQuestions.length} Items Extracted</h2>
                    <p className="text-amber-400 text-[9px] font-bold uppercase tracking-widest">Master Preview</p>
                  </div>
                  <button onClick={commitBatch} disabled={isCommitting} className="px-12 py-5 bg-amber-500 text-slate-950 rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl active:scale-95">Confirm Registry</button>
                </div>
                {stagedQuestions.map((q, i) => (
                  <div key={i} className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-sm">
                    <p className="text-[10px] font-bold text-amber-600 uppercase mb-4 tracking-widest">{q.subject} • {q.topic}</p>
                    <p className="text-lg font-bold text-slate-900 mb-8"><ScientificText text={q.text} /></p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       {q.options.map((opt, oi) => (
                         <div key={oi} className={`p-5 rounded-2xl text-xs font-bold border ${q.correctAnswerIndex === oi ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>{opt}</div>
                       ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'questions' && (
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
            <div className="xl:col-span-1">
              <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl sticky top-4 z-40">
                <h3 className="text-xl font-bold text-slate-950 uppercase tracking-tight mb-6">{editingId ? 'Edit Entry' : 'Manual Entry'}</h3>
                <form onSubmit={handleSaveQuestion} className="space-y-4">
                  <input placeholder="Subject" className="w-full p-4 bg-slate-50 border rounded-2xl text-[10px] font-bold outline-none uppercase tracking-widest" value={qSubject} onChange={e => setQSubject(e.target.value)} required />
                  <input placeholder="Topic" className="w-full p-4 bg-slate-50 border rounded-2xl text-[10px] font-bold outline-none uppercase tracking-widest" value={qTopic} onChange={e => setQTopic(e.target.value)} required />
                  <textarea placeholder="Narrative..." className="w-full p-5 bg-slate-50 border rounded-2xl text-sm h-40 outline-none" value={qText} onChange={e => setQText(e.target.value)} required />
                  {qOptions.map((o, i) => (
                    <div key={i} className="flex gap-2">
                       <input type="radio" checked={qCorrect === i} onChange={() => setQCorrect(i)} className="accent-amber-500 w-4" name="correct" />
                       <input className="w-full p-4 bg-slate-50 border rounded-2xl text-[10px] font-bold outline-none" value={o} placeholder={`Option ${String.fromCharCode(65+i)}`} onChange={e => { const n = [...qOptions]; n[i] = e.target.value; setQOptions(n); }} required />
                    </div>
                  ))}
                  <textarea placeholder="Expert Rationale" className="w-full p-5 bg-slate-50 border rounded-2xl text-xs h-24 outline-none" value={qExplanation} onChange={e => setQExplanation(e.target.value)} />
                  <button className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-[10px] tracking-widest">{editingId ? 'Update Record' : 'Save Record'}</button>
                  {editingId && <button type="button" onClick={resetForm} className="w-full py-2 text-red-500 text-[9px] font-bold uppercase">Cancel</button>}
                </form>
              </div>
            </div>
            <div className="xl:col-span-3 space-y-6">
               <div className="flex flex-col lg:flex-row gap-4 bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm sticky top-4 z-30">
                  <div className="relative flex-1">
                    <svg className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    <input type="text" placeholder="Search Master Bank..." className="w-full p-5 pl-14 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-bold uppercase outline-none focus:ring-4 focus:ring-amber-500/10" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                  </div>
                  <button onClick={runDeDuplication} className="px-8 py-5 bg-red-50 text-red-600 rounded-2xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-red-100 transition-all">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    Clean Registry
                  </button>
               </div>
               <div className="space-y-4">
                  {filteredQuestions.map(q => (
                    <div key={q.id} className="bg-white p-10 rounded-[2.5rem] border border-slate-100 hover:border-amber-200 group flex flex-col md:flex-row gap-8 items-start relative shadow-sm transition-all">
                      <div className="flex-1">
                        <p className="text-[10px] font-black text-amber-600 uppercase mb-4 tracking-widest">{q.subject} • {q.topic}</p>
                        <p className="text-lg font-bold text-slate-800 leading-relaxed mb-6"><ScientificText text={q.text} /></p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                           {q.options.map((opt, oi) => (
                             <div key={oi} className={`p-4 rounded-xl text-[10px] font-bold flex items-center gap-3 border ${q.correctAnswerIndex === oi ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                                <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-black ${q.correctAnswerIndex === oi ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'}`}>{String.fromCharCode(65+oi)}</div>
                                <span className="truncate">{opt}</span>
                             </div>
                           ))}
                        </div>
                      </div>
                      <div className="flex md:flex-col gap-2 shrink-0 md:opacity-0 group-hover:opacity-100 transition-all">
                        <button onClick={() => startEdit(q)} className="p-4 bg-slate-950 text-amber-500 rounded-2xl hover:bg-slate-900 shadow-xl" title="Modify Record"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 012.828 0L21 4.586a2 2 0 010 2.828l-10 10a2 2 0 01-1.107.554l-3 .5a.5.5 0 01-.58-.58l.5-3a2 2 0 01.554-1.107l10-10z"></path></svg></button>
                        <button onClick={() => { if(window.confirm('Delete this clinical record?')) deleteDoc(doc(db, 'questions', q.id)) }} className="p-4 bg-red-50 text-red-600 rounded-2xl hover:bg-red-100" title="Purge Record"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                      </div>
                    </div>
                  ))}
               </div>
            </div>
          </div>
        )}

        {activeTab === 'tests' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
             <div className="xl:col-span-1">
                <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl sticky top-4">
                   <h3 className="text-2xl font-bold text-slate-950 uppercase tracking-tight mb-8">Deploy Simulation</h3>
                   <form onSubmit={handleCreateTest} className="space-y-4">
                      <input placeholder="Simulation Title" className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-bold uppercase outline-none focus:ring-2 focus:ring-amber-500" value={testName} onChange={e => setTestName(e.target.value)} required />
                      <textarea placeholder="Instructions..." className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl text-xs h-32 outline-none" value={testDesc} onChange={e => setTestDesc(e.target.value)} required />
                      <div className="flex items-center gap-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                        <span className="text-[10px] font-bold uppercase text-slate-400">Duration (Mins)</span>
                        <input type="number" className="bg-transparent font-bold w-16 text-center text-xl" value={testDuration} onChange={e => setTestDuration(parseInt(e.target.value))} />
                      </div>
                      <div className="bg-slate-950 p-6 rounded-2xl text-amber-500 flex justify-between items-center shadow-inner">
                        <span className="text-[10px] font-black uppercase tracking-widest">Selected Items</span>
                        <span className="text-3xl font-bold">{testSelectedQuestions.length}</span>
                      </div>
                      <button className="w-full py-6 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-[10px] tracking-widest shadow-2xl active:scale-95">Publish Module</button>
                   </form>
                </div>
             </div>
             <div className="xl:col-span-2">
                <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col h-[800px]">
                   <h3 className="text-xl font-bold text-slate-950 uppercase tracking-tight mb-6">Selection Matrix</h3>
                   <input type="text" placeholder="Filter questions..." className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-bold uppercase outline-none mb-6" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                   <div className="flex-1 overflow-y-auto no-scrollbar space-y-3 pr-2">
                      {filteredQuestions.map(q => {
                        const isSelected = testSelectedQuestions.includes(q.id);
                        return (
                          <div key={q.id} onClick={() => setTestSelectedQuestions(prev => isSelected ? prev.filter(id => id !== q.id) : [...prev, q.id])} className={`p-5 border-2 rounded-2xl cursor-pointer transition-all flex justify-between items-center gap-6 ${isSelected ? 'bg-amber-50 border-amber-500 shadow-md ring-4 ring-amber-500/10' : 'bg-white border-slate-100 hover:border-slate-200'}`}>
                             <div className="flex-1">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{q.subject} • {q.topic}</p>
                                <p className="text-sm font-bold text-slate-800 line-clamp-2"><ScientificText text={q.text} /></p>
                             </div>
                             <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${isSelected ? 'bg-amber-500 border-amber-500 text-slate-950 shadow-sm' : 'border-slate-100 text-transparent'}`}><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg></div>
                          </div>
                        );
                      })}
                   </div>
                </div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;