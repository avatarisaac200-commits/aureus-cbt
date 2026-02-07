
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { User, Question, MockTest } from '../types';
import { db } from '../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, updateDoc, onSnapshot, writeBatch } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
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
  const [expandedTopics, setExpandedTopics] = useState<Record<string, boolean>>({});
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
    const unsubQ = onSnapshot(query(collection(db, 'questions'), orderBy('createdAt', 'desc')), (snap) => {
      setQuestions(snap.docs.map(d => ({ ...d.data(), id: d.id } as Question)));
    });
    const unsubT = onSnapshot(collection(db, 'tests'), (snap) => {
      setTests(snap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest)));
    });
    return () => { unsubQ(); unsubT(); };
  }, []);

  const filteredQuestions = useMemo(() => {
    if (!searchQuery) return questions;
    const lowSearch = searchQuery.toLowerCase();
    return questions.filter(q => 
      q.text.toLowerCase().includes(lowSearch) || 
      q.subject.toLowerCase().includes(lowSearch) || 
      q.topic.toLowerCase().includes(lowSearch)
    );
  }, [questions, searchQuery]);

  const groupedQuestions = useMemo(() => {
    const groups: Record<string, Question[]> = {};
    filteredQuestions.forEach(q => {
      const topic = q.topic || 'General';
      if (!groups[topic]) groups[topic] = [];
      groups[topic].push(q);
    });
    return groups;
  }, [filteredQuestions]);

  const removeDuplicates = async () => {
    if (!window.confirm("Search and delete identical questions from the bank?")) return;
    setLoading(true);
    const seen = new Map<string, string>(); // text -> id
    const toDelete: string[] = [];
    
    questions.forEach(q => {
      const normalizedText = q.text.toLowerCase().trim();
      if (seen.has(normalizedText)) {
        toDelete.push(q.id);
      } else {
        seen.set(normalizedText, q.id);
      }
    });

    if (toDelete.length === 0) {
      alert("No duplicate questions found.");
    } else {
      const batch = writeBatch(db);
      toDelete.forEach(id => batch.delete(doc(db, 'questions', id)));
      await batch.commit();
      alert(`Deleted ${toDelete.length} duplicate questions.`);
    }
    setLoading(false);
  };

  const toggleTopic = (topic: string) => {
    setExpandedTopics(prev => ({ ...prev, [topic]: !prev[topic] }));
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
      alert("Error parsing PDF.");
      setImportStatus('idle');
    }
  };

  const commitImport = async () => {
    if (!window.confirm(`Are you sure you want to add ${stagedQuestions.length} questions to the bank?`)) return;
    setIsCommitting(true);
    try {
      const batch = writeBatch(db);
      stagedQuestions.forEach(q => {
        const newRef = doc(collection(db, 'questions'));
        batch.set(newRef, { ...q, createdBy: user.id, createdAt: new Date().toISOString() });
      });
      await batch.commit();
      setStagedQuestions([]);
      setImportStatus('idle');
      alert("Successfully committed.");
    } catch (err) {
      alert("Error committing questions.");
    } finally {
      setIsCommitting(false);
    }
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const qData = {
      subject: qSubject || 'General', topic: qTopic || 'General',
      text: qText, options: qOptions, correctAnswerIndex: qCorrect, explanation: qExplanation,
    };
    try {
      if (editingId) {
        await updateDoc(doc(db, 'questions', editingId), { ...qData, updatedAt: new Date().toISOString() });
      } else {
        await addDoc(collection(db, 'questions'), { ...qData, createdBy: user.id, createdAt: new Date().toISOString() });
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
    if (testSelectedQuestions.length === 0) return alert("Select at least 1 question.");
    setLoading(true);
    try {
      await addDoc(collection(db, 'tests'), {
        name: testName, description: testDesc, totalDurationSeconds: testDuration * 60,
        sections: [{ id: 'main', name: 'Main Section', questionIds: testSelectedQuestions, marksPerQuestion: 1 }],
        allowRetake: true, createdBy: user.id, creatorName: user.name, isApproved: true, createdAt: new Date().toISOString()
      });
      setTestName(''); setTestDesc(''); setTestSelectedQuestions([]);
      alert("Test Created!");
    } catch (err) { alert("Error creating test."); }
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
                 <p className="text-xs text-slate-400 mb-8 italic">Upload MCQs from clinical PDFs.</p>
                 <button className="px-12 py-4 bg-slate-950 text-amber-500 rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-xl">Select PDF File</button>
              </div>
            )}
            {importStatus === 'parsing' && <div className="text-center py-20 font-bold uppercase text-amber-600 animate-pulse">AI is reading document... {importProgress}%</div>}
            {importStatus === 'review' && (
              <div className="space-y-6">
                <div className="bg-slate-950 p-8 rounded-[2rem] border-b-4 border-amber-500 flex justify-between items-center sticky top-0 z-20">
                  <div className="text-white"><p className="text-lg font-bold uppercase">{stagedQuestions.length} Items Detected</p></div>
                  <button onClick={commitImport} disabled={isCommitting} className="px-10 py-4 bg-amber-500 text-slate-950 rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-lg">
                    {isCommitting ? "Questions are being added, please wait..." : "Commit to Bank"}
                  </button>
                </div>
                {stagedQuestions.map((q, i) => (
                  <div key={i} className="bg-white p-6 rounded-2xl border border-slate-100"><p className="text-sm font-bold text-slate-800"><ScientificText text={q.text} /></p></div>
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
                  <h3 className="text-lg font-bold text-slate-950 uppercase">{editingId ? 'Edit Item' : 'Add Item'}</h3>
                  {editingId && <button onClick={resetQForm} className="text-[8px] text-red-500 uppercase font-black">Cancel</button>}
                </div>
                <form onSubmit={handleSaveQuestion} className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <input placeholder="Subject" className="w-full p-4 bg-slate-50 border rounded-2xl text-[10px] font-bold outline-none" value={qSubject} onChange={e => setQSubject(e.target.value)} required />
                    <input placeholder="Topic" className="w-full p-4 bg-slate-50 border rounded-2xl text-[10px] font-bold outline-none" value={qTopic} onChange={e => setQTopic(e.target.value)} required />
                  </div>
                  <textarea placeholder="Clinical Text..." className="w-full p-4 bg-slate-50 border rounded-2xl text-xs h-32 outline-none" value={qText} onChange={e => setQText(e.target.value)} required />
                  {qOptions.map((o, i) => (
                    <div key={i} className="flex gap-2">
                       <input type="radio" checked={qCorrect === i} onChange={() => setQCorrect(i)} className="accent-amber-500" />
                       <input className="w-full p-3 bg-slate-50 border rounded-xl text-xs outline-none" value={o} placeholder={`Opt ${String.fromCharCode(65+i)}`} onChange={e => { const n = [...qOptions]; n[i] = e.target.value; setQOptions(n); }} required />
                    </div>
                  ))}
                  <textarea placeholder="Explanation/Rationale" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs h-20 outline-none" value={qExplanation} onChange={e => setQExplanation(e.target.value)} />
                  <button className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-[10px] shadow-xl">{editingId ? 'Update Item' : 'Store in Bank'}</button>
                </form>
              </div>
            </div>
            <div className="xl:col-span-3 space-y-6">
               <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-6 rounded-[1.5rem] border border-slate-100 shadow-sm">
                  <input type="text" placeholder="Search Bank (Text, Topic, Subject)..." className="flex-1 p-4 bg-slate-50 border rounded-2xl text-xs outline-none" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                  <button onClick={removeDuplicates} className="px-6 py-4 bg-red-50 text-red-600 border border-red-100 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-red-100">Clean Duplicates</button>
               </div>
               {Object.entries(groupedQuestions).map(([topic, qs]) => (
                 <div key={topic} className="bg-white rounded-3xl border shadow-sm overflow-hidden">
                    <button onClick={() => toggleTopic(topic)} className="w-full p-6 flex justify-between items-center bg-slate-50">
                       <div className="text-left"><h3 className="font-bold text-slate-900 uppercase text-sm">{topic}</h3><p className="text-[9px] text-slate-400 uppercase">{qs.length} Items</p></div>
                       <svg className={`w-5 h-5 transition-transform ${expandedTopics[topic] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    {expandedTopics[topic] && (
                      <div className="p-6 space-y-4">
                        {qs.map(q => (
                          <div key={q.id} className="p-5 border rounded-2xl flex justify-between items-center gap-4 group">
                             <div className="flex-1"><p className="text-sm font-bold text-slate-800 leading-relaxed"><ScientificText text={q.text} /></p></div>
                             <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                               <button onClick={() => handleEditQuestion(q)} className="p-3 bg-slate-100 text-slate-600 rounded-xl hover:bg-amber-100 hover:text-amber-600"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                               <button onClick={() => deleteDoc(doc(db, 'questions', q.id))} className="p-3 bg-red-50 text-red-600 rounded-xl"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                             </div>
                          </div>
                        ))}
                      </div>
                    )}
                 </div>
               ))}
            </div>
          </div>
        )}

        {activeTab === 'tests' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
             <div className="xl:col-span-1">
                <div className="bg-white p-8 rounded-[2rem] border shadow-sm">
                   <h3 className="text-lg font-bold text-slate-950 uppercase mb-6">Create New Mock Test</h3>
                   <form onSubmit={handleCreateTest} className="space-y-4">
                      <input placeholder="Test Title" className="w-full p-4 bg-slate-50 border rounded-2xl text-[10px] font-bold outline-none" value={testName} onChange={e => setTestName(e.target.value)} required />
                      <textarea placeholder="Description" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs h-24 outline-none" value={testDesc} onChange={e => setTestDesc(e.target.value)} required />
                      <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border">
                        <span className="text-[10px] font-bold uppercase text-slate-400">Duration (Min)</span>
                        <input type="number" className="bg-transparent font-bold w-16" value={testDuration} onChange={e => setTestDuration(parseInt(e.target.value))} />
                      </div>
                      <div className="bg-slate-50 p-4 rounded-2xl border text-[10px] font-bold uppercase">
                        Selected: {testSelectedQuestions.length} Questions
                      </div>
                      <button className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-[10px] shadow-xl">Deploy Test</button>
                   </form>
                </div>
             </div>
             <div className="xl:col-span-2">
                <div className="bg-white p-8 rounded-[2rem] border shadow-sm">
                   <h3 className="text-lg font-bold text-slate-950 uppercase mb-6">Select Questions from Bank</h3>
                   <input type="text" placeholder="Search..." className="w-full p-4 bg-slate-50 border rounded-2xl mb-6 text-xs" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                   <div className="space-y-2 max-h-[600px] overflow-y-auto no-scrollbar">
                      {filteredQuestions.map(q => (
                        <div key={q.id} onClick={() => setTestSelectedQuestions(prev => prev.includes(q.id) ? prev.filter(id => id !== q.id) : [...prev, q.id])} className={`p-4 border rounded-xl cursor-pointer transition-all ${testSelectedQuestions.includes(q.id) ? 'bg-amber-50 border-amber-500' : 'bg-white border-slate-100 hover:border-slate-300'}`}>
                           <p className="text-[11px] font-bold text-slate-800 line-clamp-2">{q.text}</p>
                           <p className="text-[8px] text-slate-400 mt-1 uppercase">{q.subject} • {q.topic}</p>
                        </div>
                      ))}
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
