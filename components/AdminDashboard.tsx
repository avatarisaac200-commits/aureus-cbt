
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

type AdminTab = 'questions' | 'tests' | 'approvals' | 'import';
type StagedQuestion = Omit<Question, 'id' | 'createdAt' | 'createdBy'>;

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, initialTab = 'questions', onLogout, onSwitchToStudent }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [tests, setTests] = useState<MockTest[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [importStatus, setImportStatus] = useState<'idle' | 'parsing' | 'review'>('idle');
  const [importProgress, setImportProgress] = useState(0);
  const [stagedQuestions, setStagedQuestions] = useState<StagedQuestion[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Question Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [qSubject, setQSubject] = useState('');
  const [qTopic, setQTopic] = useState('');
  const [qText, setQText] = useState('');
  const [qOptions, setQOptions] = useState(['', '', '', '']);
  const [qCorrect, setQCorrect] = useState(0);
  const [qExplanation, setQExplanation] = useState('');

  // Test Form State
  const [testName, setTestName] = useState('');
  const [testDesc, setTestDesc] = useState('');
  const [testDuration, setTestDuration] = useState(60);
  const [testSelectedQuestions, setTestSelectedQuestions] = useState<string[]>([]);

  useEffect(() => {
    // Basic snapshot for real-time reactivity
    const unsubQ = onSnapshot(query(collection(db, 'questions'), orderBy('createdAt', 'desc')), (snap) => {
      setQuestions(snap.docs.map(d => ({ ...d.data(), id: d.id } as Question)));
    });
    const unsubT = onSnapshot(collection(db, 'tests'), (snap) => {
      setTests(snap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest)));
    });
    return () => { unsubQ(); unsubT(); };
  }, []);

  const filteredQuestions = useMemo(() => {
    const lowSearch = searchQuery.toLowerCase().trim();
    if (!lowSearch) return questions;
    return questions.filter(q => 
      q.text.toLowerCase().includes(lowSearch) || 
      q.subject.toLowerCase().includes(lowSearch) || 
      q.topic.toLowerCase().includes(lowSearch)
    );
  }, [questions, searchQuery]);

  // AUTOMATED DE-DUPLICATION ALGORITHM
  const removeDuplicates = async () => {
    if (!window.confirm("Run Automated De-duplication? Identical clinical text entries will be merged into the oldest entry.")) return;
    setLoading(true);
    try {
      const seen = new Map<string, string>(); // normalized text -> original id
      const duplicatesToDelete: string[] = [];

      // Sort by createdAt ASC to keep the oldest entries
      const sorted = [...questions].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      sorted.forEach(q => {
        const norm = q.text.toLowerCase().replace(/\s+/g, ' ').trim();
        if (seen.has(norm)) {
          duplicatesToDelete.push(q.id);
        } else {
          seen.set(norm, q.id);
        }
      });

      if (duplicatesToDelete.length === 0) {
        alert("No duplicates found. Question bank is clean.");
      } else {
        const batch = writeBatch(db);
        duplicatesToDelete.forEach(id => batch.delete(doc(db, 'questions', id)));
        await batch.commit();
        alert(`Registry optimized. Deleted ${duplicatesToDelete.length} duplicate entries.`);
      }
    } catch (e) {
      alert("Error during registry optimization.");
    } finally {
      setLoading(false);
    }
  };

  const processDocument = async (file: File) => {
    setImportStatus('parsing');
    setImportProgress(10);
    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const base64Data = await base64Promise;
      setImportProgress(30);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: base64Data } },
            { text: "Extract medical MCQs as JSON array: subject, topic, text, options(4), correctAnswerIndex(0-3), explanation." }
          ]
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
            },
          },
        },
      });
      setStagedQuestions(JSON.parse(response.text) as StagedQuestion[]);
      setImportProgress(100);
      setTimeout(() => setImportStatus('review'), 500);
    } catch (err) {
      alert("Error parsing document.");
      setImportStatus('idle');
    }
  };

  const commitImport = async () => {
    if (!window.confirm(`Add these ${stagedQuestions.length} questions to the master bank?`)) return;
    setIsCommitting(true);
    try {
      const batch = writeBatch(db);
      stagedQuestions.forEach(q => {
        const newRef = doc(collection(db, 'questions'));
        batch.set(newRef, { 
          ...q, 
          createdBy: user.id, 
          createdAt: new Date().toISOString() 
        });
      });
      await batch.commit();
      setStagedQuestions([]);
      setImportStatus('idle');
      alert("Import Successful.");
    } catch (err) {
      alert("Commit failed.");
    } finally {
      setIsCommitting(false);
    }
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const qData = {
      subject: qSubject || 'General', 
      topic: qTopic || 'General',
      text: qText, 
      options: qOptions, 
      correctAnswerIndex: qCorrect, 
      explanation: qExplanation,
    };
    try {
      if (editingId) {
        await updateDoc(doc(db, 'questions', editingId), { 
          ...qData, 
          updatedAt: new Date().toISOString() 
        });
        alert("Question updated.");
      } else {
        await addDoc(collection(db, 'questions'), { 
          ...qData, 
          createdBy: user.id, 
          createdAt: new Date().toISOString() 
        });
        alert("Stored in Bank.");
      }
      resetQForm();
    } catch (err) { alert("Save error."); }
    finally { setLoading(false); }
  };

  const resetQForm = () => {
    setEditingId(null); setQSubject(''); setQTopic(''); setQText(''); setQOptions(['','','','']); setQCorrect(0); setQExplanation('');
  };

  const handleEditQuestion = (q: Question) => {
    setEditingId(q.id); setQSubject(q.subject); setQTopic(q.topic); setQText(q.text); setQOptions(q.options); setQCorrect(q.correctAnswerIndex); setQExplanation(q.explanation || '');
    setActiveTab('questions');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCreateTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (testSelectedQuestions.length === 0) return alert("Selection empty.");
    setLoading(true);
    try {
      await addDoc(collection(db, 'tests'), {
        name: testName, 
        description: testDesc, 
        totalDurationSeconds: testDuration * 60,
        sections: [{ id: 'main', name: 'Main Section', questionIds: testSelectedQuestions, marksPerQuestion: 1 }],
        allowRetake: true, 
        createdBy: user.id, 
        creatorName: user.name, 
        isApproved: true, 
        createdAt: new Date().toISOString()
      });
      setTestName(''); setTestDesc(''); setTestSelectedQuestions([]);
      alert("Test Deployed Successfully.");
    } catch (err) { alert("Error deploying test."); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden">
      <div className="bg-white border-b border-slate-100 p-6 flex flex-col md:flex-row justify-between items-center gap-4 safe-top">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-12 h-12" alt="Logo" />
          <div>
            <h1 className="text-xl font-bold text-slate-900 uppercase tracking-tight leading-none">Admin Panel</h1>
            <p className="text-[9px] font-bold text-amber-600 uppercase tracking-widest mt-1">Full Content Governance</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onSwitchToStudent} className="px-5 py-2.5 text-[10px] font-bold text-slate-600 border border-slate-200 rounded-xl uppercase tracking-widest hover:bg-slate-50 transition-all">Student View</button>
          <button onClick={onLogout} className="px-5 py-2.5 text-[10px] font-bold text-red-600 border border-red-50 rounded-xl uppercase tracking-widest hover:bg-red-50 transition-all">Logout</button>
        </div>
      </div>

      <nav className="flex bg-white px-6 border-b border-slate-100 overflow-x-auto no-scrollbar">
        {['questions', 'import', 'tests', 'approvals'].map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab as AdminTab)} className={`px-6 py-4 text-[9px] font-bold uppercase tracking-widest whitespace-nowrap transition-all ${activeTab === tab ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50/50' : 'text-slate-400 hover:text-slate-600'}`}>{tab}</button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-6 no-scrollbar safe-bottom">
        {activeTab === 'import' && (
          <div className="max-w-3xl mx-auto py-10">
            {importStatus === 'idle' && (
              <div className="bg-white p-12 rounded-[2rem] border-4 border-dashed border-slate-200 text-center hover:border-amber-500 transition-all cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                 <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={(e) => e.target.files?.[0] && processDocument(e.target.files[0])} />
                 <h3 className="text-xl font-bold text-slate-950 mb-4 uppercase tracking-tight">AI PDF Batch Import</h3>
                 <p className="text-xs text-slate-400 mb-8 italic">Upload clinical MCQs directly from study material.</p>
                 <button className="px-12 py-4 bg-slate-950 text-amber-500 rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-xl">Select PDF File</button>
              </div>
            )}
            {importStatus === 'parsing' && <div className="text-center py-20 font-bold uppercase text-amber-600 animate-pulse">AI Parsing Document... {importProgress}%</div>}
            {importStatus === 'review' && (
              <div className="space-y-6">
                <div className="bg-slate-950 p-8 rounded-[2rem] border-b-4 border-amber-500 flex justify-between items-center sticky top-0 z-20 shadow-2xl">
                  <div className="text-white">
                    <p className="text-lg font-bold uppercase">{stagedQuestions.length} Questions Staged</p>
                    <p className="text-[10px] text-amber-400 font-bold uppercase tracking-widest">Verify and Commit to Registry</p>
                  </div>
                  <button onClick={commitImport} disabled={isCommitting} className="px-10 py-4 bg-amber-500 text-slate-950 rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-lg active:scale-95 disabled:opacity-50 transition-all">
                    {isCommitting ? "Questions are being added, please wait..." : "Commit to Bank"}
                  </button>
                </div>
                {stagedQuestions.map((q, i) => (
                  <div key={i} className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                    <p className="text-[10px] font-bold text-amber-600 uppercase mb-4 tracking-widest">{q.subject} • {q.topic}</p>
                    <p className="text-base font-bold text-slate-800 mb-6 leading-relaxed"><ScientificText text={q.text} /></p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                       {q.options.map((opt, oi) => (
                         <div key={oi} className={`p-4 rounded-xl text-xs font-bold border ${q.correctAnswerIndex === oi ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-100 text-slate-500'}`}>
                           {String.fromCharCode(65 + oi)}. {opt}
                         </div>
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
              <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm sticky top-4">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-bold text-slate-950 uppercase">{editingId ? 'Edit Question' : 'Manual Entry'}</h3>
                  {editingId && <button onClick={resetQForm} className="text-[8px] text-red-500 uppercase font-black px-3 py-1 bg-red-50 rounded-full">Cancel Edit</button>}
                </div>
                <form onSubmit={handleSaveQuestion} className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <input placeholder="Subject" className="w-full p-4 bg-slate-50 border rounded-2xl text-[10px] font-bold outline-none" value={qSubject} onChange={e => setQSubject(e.target.value)} required />
                    <input placeholder="Topic" className="w-full p-4 bg-slate-50 border rounded-2xl text-[10px] font-bold outline-none" value={qTopic} onChange={e => setQTopic(e.target.value)} required />
                  </div>
                  <textarea placeholder="Clinical Case / Question Text..." className="w-full p-4 bg-slate-50 border rounded-2xl text-xs h-32 outline-none" value={qText} onChange={e => setQText(e.target.value)} required />
                  {qOptions.map((o, i) => (
                    <div key={i} className="flex gap-2">
                       <input type="radio" name="correct" checked={qCorrect === i} onChange={() => setQCorrect(i)} className="accent-amber-500 w-4" />
                       <input className="w-full p-3 bg-slate-50 border rounded-xl text-xs outline-none" value={o} placeholder={`Option ${String.fromCharCode(65+i)}`} onChange={e => { const n = [...qOptions]; n[i] = e.target.value; setQOptions(n); }} required />
                    </div>
                  ))}
                  <textarea placeholder="Explanation / Rationale (Optional)" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs h-20 outline-none" value={qExplanation} onChange={e => setQExplanation(e.target.value)} />
                  <button className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-[10px] shadow-xl active:scale-95 transition-all">{editingId ? 'Update Registry' : 'Store in Bank'}</button>
                </form>
              </div>
            </div>
            <div className="xl:col-span-3 space-y-6">
               <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                  <div className="relative flex-1">
                    <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    <input type="text" placeholder="Search Master Bank (Subject, Topic, Content)..." className="w-full p-4 pl-12 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-bold uppercase outline-none focus:ring-2 focus:ring-amber-500" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                  </div>
                  <button onClick={removeDuplicates} className="px-6 py-4 bg-red-50 text-red-600 border border-red-100 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-red-100 transition-all flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    Optimize Bank
                  </button>
               </div>
               <div className="space-y-4">
                  {filteredQuestions.length === 0 ? (
                    <div className="py-20 text-center bg-white rounded-3xl border border-slate-100">
                      <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest italic">No clinical entries found matching search.</p>
                    </div>
                  ) : (
                    filteredQuestions.map(q => (
                      <div key={q.id} className="bg-white p-8 rounded-[2rem] border border-slate-100 hover:border-amber-200 transition-all group flex flex-col md:flex-row justify-between items-start gap-6">
                        <div className="flex-1">
                          <p className="text-[9px] font-black text-amber-600 uppercase tracking-[0.2em] mb-3">{q.subject} • {q.topic}</p>
                          <p className="text-base font-bold text-slate-800 leading-relaxed mb-4"><ScientificText text={q.text} /></p>
                          <div className="grid grid-cols-2 gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                            {q.options.map((o, idx) => (
                              <div key={idx} className={`text-[10px] font-bold flex items-center gap-2 ${q.correctAnswerIndex === idx ? 'text-emerald-600' : 'text-slate-400'}`}>
                                <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] ${q.correctAnswerIndex === idx ? 'bg-emerald-500 text-white' : 'bg-slate-100'}`}>{String.fromCharCode(65+idx)}</div>
                                <span className="truncate">{o}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex md:flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={() => handleEditQuestion(q)} className="p-3 bg-slate-900 text-amber-500 rounded-xl hover:bg-slate-800 transition-all" title="Edit Clinical Entry">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 012.828 0L21 4.586a2 2 0 010 2.828l-10 10a2 2 0 01-1.107.554l-3 .5a.5.5 0 01-.58-.58l.5-3a2 2 0 01.554-1.107l10-10z"></path></svg>
                          </button>
                          <button onClick={() => { if(window.confirm('Delete question?')) deleteDoc(doc(db, 'questions', q.id)) }} className="p-3 bg-red-50 text-red-600 rounded-xl hover:bg-red-100" title="Purge Entry">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
               </div>
            </div>
          </div>
        )}

        {activeTab === 'tests' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
             <div className="xl:col-span-1">
                <div className="bg-white p-10 rounded-[2rem] border border-slate-100 shadow-xl sticky top-4">
                   <h3 className="text-xl font-bold text-slate-950 uppercase tracking-tight mb-8">Deploy Mock Test</h3>
                   <form onSubmit={handleCreateTest} className="space-y-4">
                      <input placeholder="Test Title (e.g. Clinical Pediatrics Mock 1)" className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-bold uppercase outline-none focus:ring-2 focus:ring-amber-500" value={testName} onChange={e => setTestName(e.target.value)} required />
                      <textarea placeholder="Instructions / Description..." className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl text-xs h-32 outline-none focus:ring-2 focus:ring-amber-500" value={testDesc} onChange={e => setTestDesc(e.target.value)} required />
                      <div className="flex items-center gap-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                        <span className="text-[10px] font-bold uppercase text-slate-400">Timer (Minutes)</span>
                        <input type="number" className="bg-transparent font-bold w-16 text-center text-lg" value={testDuration} onChange={e => setTestDuration(parseInt(e.target.value))} />
                      </div>
                      <div className="bg-slate-950 p-6 rounded-2xl text-amber-500 flex justify-between items-center shadow-inner">
                        <span className="text-[10px] font-black uppercase tracking-widest">Selected Items</span>
                        <span className="text-2xl font-bold">{testSelectedQuestions.length}</span>
                      </div>
                      <button className="w-full py-6 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-[10px] tracking-widest shadow-2xl active:scale-95 transition-all">Deploy Clinical Test</button>
                   </form>
                </div>
             </div>
             <div className="xl:col-span-2">
                <div className="bg-white p-10 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col h-[800px]">
                   <h3 className="text-xl font-bold text-slate-950 uppercase tracking-tight mb-8">Selector Matrix</h3>
                   <div className="relative mb-6">
                    <input type="text" placeholder="Search Bank for specific questions..." className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-bold uppercase outline-none focus:ring-2 focus:ring-amber-500" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                   </div>
                   <div className="flex-1 overflow-y-auto no-scrollbar space-y-3">
                      {filteredQuestions.map(q => {
                        const isSelected = testSelectedQuestions.includes(q.id);
                        return (
                          <div key={q.id} onClick={() => setTestSelectedQuestions(prev => isSelected ? prev.filter(id => id !== q.id) : [...prev, q.id])} className={`p-5 border-2 rounded-2xl cursor-pointer transition-all flex justify-between items-center gap-6 ${isSelected ? 'bg-amber-50 border-amber-500 shadow-md ring-4 ring-amber-500/5' : 'bg-white border-slate-100 hover:border-slate-300'}`}>
                             <div className="flex-1">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{q.subject} • {q.topic}</p>
                                <p className="text-sm font-bold text-slate-800 line-clamp-2 leading-relaxed"><ScientificText text={q.text} /></p>
                             </div>
                             <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${isSelected ? 'bg-amber-500 border-amber-500 text-slate-950' : 'border-slate-100 text-transparent'}`}>
                               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                             </div>
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
