
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { User, Question, MockTest, TestSection } from '../types';
import { db } from '../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, updateDoc, onSnapshot, writeBatch, limit, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
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
  const [dbError, setDbError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Test Builder State
  const [testName, setTestName] = useState('');
  const [testDesc, setTestDesc] = useState('');
  const [testDuration, setTestDuration] = useState(60);
  const [sections, setSections] = useState<TestSection[]>([
    { id: 'sec_' + Date.now(), name: 'Section 1', questionIds: [], marksPerQuestion: 1 }
  ]);
  const [activeBuilderSection, setActiveBuilderSection] = useState(0);

  // Question Form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [qSubject, setQSubject] = useState('');
  const [qTopic, setQTopic] = useState('');
  const [qText, setQText] = useState('');
  const [qOptions, setQOptions] = useState(['', '', '', '']);
  const [qCorrect, setQCorrect] = useState(0);
  const [qExplanation, setQExplanation] = useState('');

  // AI Import State
  const [importStatus, setImportStatus] = useState<'idle' | 'parsing' | 'review'>('idle');
  const [stagedQuestions, setStagedQuestions] = useState<StagedQuestion[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // EFFECT: Fetch Bank Data
  useEffect(() => {
    setDbError(null);
    // Note: Removed orderBy('createdAt') to avoid index requirement issues
    const q = query(collection(db, 'questions'), limit(100));
    const unsub = onSnapshot(q, 
      (snap) => {
        const data = snap.docs.map(d => ({ ...d.data(), id: d.id } as Question));
        setQuestions(data);
      },
      (err) => {
        console.error("Firestore Error:", err);
        setDbError(err.message.includes('offline') ? "You appear to be offline." : "Database sync error. Check console for details.");
      }
    );
    return () => unsub();
  }, []);

  const filteredQuestions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return questions;
    return questions.filter(item => 
      item.text.toLowerCase().includes(q) || 
      item.subject.toLowerCase().includes(q)
    );
  }, [questions, searchQuery]);

  const runBankCleanup = async () => {
    if (!window.confirm("Find and remove identical questions? This cannot be undone.")) return;
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'questions'));
      const all = snap.docs.map(d => ({ ...d.data(), id: d.id } as Question));
      
      const seenTexts = new Map<string, string>(); 
      const duplicatesToDelete: string[] = [];

      all.forEach(q => {
        const cleanText = q.text.toLowerCase().trim().replace(/\s+/g, ' ');
        if (seenTexts.has(cleanText)) {
          duplicatesToDelete.push(q.id);
        } else {
          seenTexts.set(cleanText, q.id);
        }
      });

      if (duplicatesToDelete.length > 0) {
        const batch = writeBatch(db);
        duplicatesToDelete.forEach(id => {
          batch.delete(doc(db, 'questions', id));
        });
        await batch.commit();
        alert(`Cleanup successful. Removed ${duplicatesToDelete.length} duplicates.`);
      } else {
        alert("No duplicate questions found.");
      }
    } catch (err: any) {
      console.error("Cleanup Error:", err);
      if (err.code === 'unavailable' || !navigator.onLine) {
        alert("Operation failed: You are currently offline or the database is unreachable.");
      } else {
        alert("Cleanup failed: " + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const processPDF = async (file: File) => {
    setImportStatus('parsing');
    try {
      const fileToBase64 = (f: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve((r.result as string).split(',')[1]);
          r.onerror = reject;
          r.readAsDataURL(f);
        });
      };

      const base64Data = await fileToBase64(file);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: {
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: base64Data } },
            { text: "Extract medical MCQs as a JSON array with: subject, topic, text, options(4), correctAnswerIndex(0-3), explanation." }
          ]
        },
        config: { responseMimeType: "application/json" }
      });

      const extractedText = response.text;
      if (extractedText) {
        setStagedQuestions(JSON.parse(extractedText.trim()));
        setImportStatus('review');
      }
    } catch (err) {
      alert("AI reading failed. Check your API key and file.");
      setImportStatus('idle');
    }
  };

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
      } else {
        await addDoc(collection(db, 'questions'), { ...data, createdBy: user.id, createdAt: new Date().toISOString() });
      }
      resetForm();
    } catch (e) { alert("Could not save to cloud."); }
    finally { setLoading(false); }
  };

  const resetForm = () => {
    setEditingId(null); setQSubject(''); setQTopic(''); setQText(''); setQOptions(['','','','']); setQCorrect(0); setQExplanation('');
  };

  const handleCreateTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testName) return alert("Test name is required.");
    if (sections.some(s => s.questionIds.length === 0)) return alert("One or more sections are empty.");
    
    setLoading(true);
    try {
      await addDoc(collection(db, 'tests'), {
        name: testName,
        description: testDesc,
        totalDurationSeconds: testDuration * 60,
        sections,
        allowRetake: true,
        createdBy: user.id,
        creatorName: user.name,
        isApproved: true,
        createdAt: new Date().toISOString()
      });
      alert("Test Published!");
      setActiveTab('tests');
    } catch (e) { alert("Error deploying test."); }
    finally { setLoading(false); }
  };

  const addSection = () => {
    setSections([...sections, { id: 'sec_' + Date.now(), name: `Section ${sections.length + 1}`, questionIds: [], marksPerQuestion: 1 }]);
    setActiveBuilderSection(sections.length);
  };

  const toggleQuestionInActiveSection = (qId: string) => {
    const newSections = [...sections];
    const currentIds = newSections[activeBuilderSection].questionIds;
    if (currentIds.includes(qId)) {
      newSections[activeBuilderSection].questionIds = currentIds.filter(id => id !== qId);
    } else {
      newSections[activeBuilderSection].questionIds = [...currentIds, qId];
    }
    setSections(newSections);
  };

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden">
      <div className="bg-white border-b border-slate-100 p-6 flex justify-between items-center shrink-0 safe-top shadow-sm z-10">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-10 h-10" alt="Logo" />
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-none">Admin Hub</h1>
            <div className="flex items-center gap-2 mt-1">
               <span className={`w-2 h-2 rounded-full ${dbError ? 'bg-red-500' : 'bg-emerald-500'} animate-pulse`}></span>
               <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{dbError || 'Cloud Synced'}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onSwitchToStudent} className="px-5 py-2 text-[10px] font-bold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 uppercase tracking-widest">Student View</button>
          <button onClick={onLogout} className="px-5 py-2 text-[10px] font-bold text-red-600 border border-red-50 rounded-xl hover:bg-red-50 uppercase tracking-widest">Logout</button>
        </div>
      </div>

      <nav className="flex bg-white px-6 border-b border-slate-100 shrink-0">
        <button onClick={() => setActiveTab('questions')} className={`px-8 py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'questions' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Question Bank</button>
        <button onClick={() => setActiveTab('tests')} className={`px-8 py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'tests' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Test Builder</button>
        <button onClick={() => setActiveTab('import')} className={`px-8 py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'import' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Import PDF</button>
      </nav>

      <div className="flex-1 overflow-y-auto p-6 md:p-10 no-scrollbar safe-bottom">
        {dbError && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 font-bold text-[10px] uppercase tracking-widest">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            {dbError}
          </div>
        )}

        {activeTab === 'questions' && (
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
            <div className="xl:col-span-1">
              <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-xl sticky top-0">
                <h3 className="text-lg font-bold text-slate-900 mb-6">{editingId ? 'Update Item' : 'New Bank Item'}</h3>
                <form onSubmit={handleSaveQuestion} className="space-y-4">
                  <input placeholder="Subject" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold outline-none" value={qSubject} onChange={e => setQSubject(e.target.value)} required />
                  <textarea placeholder="Clinical Scenario..." className="w-full p-5 bg-slate-50 border rounded-2xl text-sm h-32 outline-none" value={qText} onChange={e => setQText(e.target.value)} required />
                  {qOptions.map((o, i) => (
                    <div key={i} className="flex gap-2">
                       <input type="radio" checked={qCorrect === i} onChange={() => setQCorrect(i)} className="accent-amber-500 w-4" name="correct" />
                       <input className="w-full p-3 bg-slate-50 border rounded-xl text-xs" value={o} placeholder={`Option ${String.fromCharCode(65+i)}`} onChange={e => { const n = [...qOptions]; n[i] = e.target.value; setQOptions(n); }} required />
                    </div>
                  ))}
                  <textarea placeholder="Medical Rationale..." className="w-full p-4 bg-slate-50 border rounded-2xl text-xs h-20 outline-none" value={qExplanation} onChange={e => setQExplanation(e.target.value)} />
                  <button className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-[10px] tracking-widest shadow-xl active:scale-95 transition-all">{editingId ? 'Save' : 'Add'}</button>
                  {editingId && <button type="button" onClick={resetForm} className="w-full py-2 text-red-500 text-[9px] font-bold uppercase">Cancel</button>}
                </form>
              </div>
            </div>
            <div className="xl:col-span-3 space-y-6">
               <div className="flex gap-4">
                 <input type="text" placeholder="Quick search bank..." className="flex-1 p-5 bg-white border border-slate-100 rounded-2xl text-xs font-bold outline-none shadow-sm" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                 <button onClick={runBankCleanup} className="px-6 py-5 bg-white border border-red-100 text-red-500 rounded-2xl text-[9px] font-bold uppercase tracking-widest hover:bg-red-50 transition-all flex items-center gap-2">
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                   Clean Bank
                 </button>
               </div>
               <div className="space-y-4">
                  {filteredQuestions.length === 0 && !loading && (
                    <div className="bg-white p-20 rounded-[2rem] border border-dashed text-center text-slate-300 font-bold uppercase text-[10px] tracking-[0.2em]">
                      {searchQuery ? "No search results" : "Bank is currently empty"}
                    </div>
                  )}
                  {filteredQuestions.map(q => (
                    <div key={q.id} className="bg-white p-6 rounded-[2rem] border border-slate-100 flex justify-between items-start gap-6 shadow-sm hover:border-amber-100 transition-all">
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-amber-600 mb-2 uppercase tracking-widest">{q.subject}</p>
                        <p className="text-sm font-bold text-slate-800"><ScientificText text={q.text} /></p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => { setEditingId(q.id); setQSubject(q.subject); setQText(q.text); setQOptions(q.options); setQCorrect(q.correctAnswerIndex); setQExplanation(q.explanation || ''); }} className="p-3 bg-slate-100 rounded-xl hover:bg-slate-200"><svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                        <button onClick={() => { if(window.confirm('Delete this?')) deleteDoc(doc(db, 'questions', q.id)) }} className="p-3 bg-red-50 rounded-xl hover:bg-red-100"><svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                      </div>
                    </div>
                  ))}
               </div>
            </div>
          </div>
        )}

        {activeTab === 'tests' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-1">
              <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-xl space-y-6">
                <h3 className="text-lg font-bold">1. Parameters</h3>
                <input placeholder="Unique Test Title" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold" value={testName} onChange={e => setTestName(e.target.value)} />
                <textarea placeholder="Instructions for candidates..." className="w-full p-4 bg-slate-50 border rounded-2xl text-xs h-20" value={testDesc} onChange={e => setTestDesc(e.target.value)} />
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                   <span className="text-[10px] font-bold uppercase text-slate-400">Time (Mins)</span>
                   <input type="number" className="bg-transparent font-bold w-full text-center text-xl outline-none" value={testDuration} onChange={e => setTestDuration(parseInt(e.target.value))} />
                </div>
                
                <div className="space-y-3">
                   <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">2. Logical Sections</p>
                   {sections.map((s, idx) => (
                     <button key={s.id} onClick={() => setActiveBuilderSection(idx)} className={`w-full p-4 rounded-2xl border-2 text-left flex justify-between items-center transition-all ${activeBuilderSection === idx ? 'border-amber-500 bg-amber-50' : 'border-slate-50 bg-white'}`}>
                        <div>
                          <input 
                            className="text-[10px] font-bold text-slate-900 bg-transparent outline-none uppercase" 
                            value={s.name} 
                            onChange={(e) => {
                              const newSections = [...sections];
                              newSections[idx].name = e.target.value;
                              setSections(newSections);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <p className="text-[9px] text-slate-400 mt-1">{s.questionIds.length} items linked</p>
                        </div>
                        {activeBuilderSection === idx && <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></div>}
                     </button>
                   ))}
                   <button onClick={addSection} className="w-full p-3 border-2 border-dashed border-slate-100 rounded-2xl text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:border-amber-200 transition-all">+ New Section</button>
                </div>

                <button onClick={handleCreateTest} className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-[10px] tracking-widest shadow-xl active:scale-95 transition-all">Publish Test</button>
              </div>
            </div>
            
            <div className="xl:col-span-2 space-y-6 flex flex-col h-[700px]">
               <div className="bg-slate-900 text-white p-6 rounded-[2rem] flex justify-between items-center shadow-lg">
                  <div>
                    <h4 className="text-sm font-bold uppercase tracking-widest text-amber-500">Selecting for: {sections[activeBuilderSection].name}</h4>
                    <p className="text-[9px] text-slate-400 mt-1">Tap an entry to link it to this section</p>
                  </div>
                  <input type="text" placeholder="Filter current view..." className="bg-slate-800 border-none p-3 rounded-xl text-xs font-bold w-48 outline-none" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
               </div>
               
               <div className="flex-1 overflow-y-auto pr-2 space-y-3 no-scrollbar pb-10">
                  {filteredQuestions.map(q => {
                    const isSelected = sections[activeBuilderSection].questionIds.includes(q.id);
                    return (
                      <div key={q.id} onClick={() => toggleQuestionInActiveSection(q.id)} className={`p-5 border-2 rounded-2xl cursor-pointer transition-all flex justify-between items-center gap-6 shadow-sm ${isSelected ? 'border-amber-500 bg-amber-50 shadow-md ring-2 ring-amber-500/10' : 'border-white bg-white hover:border-slate-200'}`}>
                         <div className="flex-1">
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">{q.subject}</p>
                            <p className="text-sm font-bold text-slate-800 leading-relaxed"><ScientificText text={q.text} /></p>
                         </div>
                         <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 shrink-0 ${isSelected ? 'bg-amber-500 border-amber-500 text-slate-950 shadow-sm' : 'border-slate-100 text-transparent'}`}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg></div>
                      </div>
                    );
                  })}
               </div>
            </div>
          </div>
        )}

        {activeTab === 'import' && (
           <div className="max-w-2xl mx-auto py-20 text-center">
              {importStatus === 'idle' ? (
                <div onClick={() => fileInputRef.current?.click()} className="bg-white p-20 rounded-[3rem] border-4 border-dashed border-slate-100 hover:border-amber-400 cursor-pointer transition-all shadow-xl group">
                  <input type="file" id="pdf-input" ref={fileInputRef} className="hidden" accept=".pdf" onChange={(e) => e.target.files?.[0] && processPDF(e.target.files[0])} />
                  <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-amber-50 transition-colors">
                    <svg className="w-8 h-8 text-slate-400 group-hover:text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                  </div>
                  <h3 className="text-xl font-bold mb-4 uppercase text-slate-900">Medical Data Import</h3>
                  <p className="text-xs text-slate-400 font-medium">Feed AI a PDF to generate structured MCQ datasets.</p>
                </div>
              ) : importStatus === 'parsing' ? (
                <div className="py-20 flex flex-col items-center">
                  <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-6 shadow-lg"></div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">Scanning clinical records...</p>
                </div>
              ) : (
                <div className="space-y-6 text-left animate-in slide-in-from-bottom-10">
                  <div className="flex justify-between items-center bg-slate-950 p-6 rounded-3xl text-white shadow-2xl">
                    <div>
                      <p className="text-sm font-bold uppercase text-amber-500">{stagedQuestions.length} Items Parsed</p>
                      <p className="text-[9px] text-slate-400 uppercase font-bold mt-1">Review validation results</p>
                    </div>
                    <button onClick={async () => {
                       setLoading(true);
                       try {
                         const batch = writeBatch(db);
                         stagedQuestions.forEach(q => {
                           const ref = doc(collection(db, 'questions'));
                           batch.set(ref, { ...q, createdBy: user.id, createdAt: new Date().toISOString() });
                         });
                         await batch.commit();
                         setImportStatus('idle');
                         alert("Bank updated successfully.");
                       } catch (e) { alert("Import sync failed."); }
                       finally { setLoading(false); }
                    }} className="px-8 py-3 bg-amber-500 text-slate-950 rounded-xl font-bold uppercase text-[10px] hover:bg-amber-600">Commit to Bank</button>
                  </div>
                  {stagedQuestions.map((q, i) => (
                    <div key={i} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                      <p className="text-[9px] font-bold text-amber-600 uppercase mb-2 tracking-widest">{q.subject}</p>
                      <p className="text-sm font-bold text-slate-800 leading-relaxed"><ScientificText text={q.text} /></p>
                    </div>
                  ))}
                  <button onClick={() => setImportStatus('idle')} className="w-full py-4 text-slate-400 text-[9px] font-bold uppercase tracking-widest hover:text-red-500">Abort Import</button>
                </div>
              )}
           </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
