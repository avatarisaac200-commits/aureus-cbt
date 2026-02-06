
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, Question, MockTest, TestSection, ExamResult } from '../types';
import { db } from '../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, updateDoc, where, limit } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
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

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, initialTab = 'questions', onLogout, onSwitchToStudent }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  
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

  const fetchData = async () => {
    setLoading(true);
    try {
      const qSnap = await getDocs(query(collection(db, 'questions'), orderBy('createdAt', 'desc')));
      setQuestions(qSnap.docs.map(d => ({ ...d.data(), id: d.id } as Question)));
    } catch (err) {
      console.error(err);
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
        const inc = prev < 40 ? 4 : (prev < 75 ? 1.5 : 0.5);
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
        model: 'gemini-3-pro-preview',
        contents: {
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: base64Data } },
            { text: "Extract medical multiple choice questions from this clinical document. Return JSON array of objects with fields: subject, topic, text, options (array of 4 strings), correctAnswerIndex, explanation. Ensure all scientific notation is formatted correctly." }
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

      const data = JSON.parse(response.text || '[]');
      clearInterval(progressInterval);
      setImportProgress(100);
      setStagedQuestions(data);
      setTimeout(() => { setImportStatus('review'); setImportProgress(0); }, 800);
    } catch (err) {
      clearInterval(progressInterval);
      alert("Document processing failed. Please ensure the PDF is valid and readable.");
      setImportStatus('idle');
      setImportProgress(0);
    }
  };

  const commitImport = async () => {
    setLoading(true);
    try {
      for (const q of stagedQuestions) {
        await addDoc(collection(db, 'questions'), { ...q, createdBy: user.id, createdAt: new Date().toISOString() });
      }
      setStagedQuestions([]); setImportStatus('idle'); fetchData();
    } catch (err) { alert(err); } finally { setLoading(false); }
  };

  const handleAddOrUpdateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const qData = {
      subject: qSubject || 'General', topic: qTopic || 'Clinical', text: qText, options: qOptions,
      correctAnswerIndex: qCorrect, explanation: qExplanation, updatedAt: new Date().toISOString()
    };
    try {
      if (editingId) { await updateDoc(doc(db, 'questions', editingId), qData); }
      else { await addDoc(collection(db, 'questions'), { ...qData, createdBy: user.id, createdAt: new Date().toISOString() }); }
      setEditingId(null); setQText(''); setQOptions(['','','','']); fetchData();
    } catch (err) { alert(err); } finally { setLoading(false); }
  };

  const getStatusMessage = (progress: number) => {
    if (progress < 25) return "Initializing extraction engine...";
    if (progress < 50) return "Scanning document layers...";
    if (progress < 75) return "Structuring clinical data...";
    return "Finalizing item repository...";
  };

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden">
      <div className="bg-white border-b border-slate-100 p-6 flex flex-col md:flex-row justify-between items-center gap-4 safe-top">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-12 h-12" alt="Aureus Logo" />
          <div>
            <h1 className="text-xl font-black text-slate-900 uppercase tracking-tighter leading-none">Aureus Admin</h1>
            <p className="text-[9px] font-black text-amber-600 uppercase tracking-[0.3em] mt-1">Registry Control</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onSwitchToStudent} className="px-5 py-2.5 text-[10px] font-black text-slate-600 border border-slate-200 rounded-xl uppercase tracking-widest hover:bg-slate-50 transition-all">Student View</button>
          <button onClick={onLogout} className="px-5 py-2.5 text-[10px] font-black text-red-600 border border-red-50 rounded-xl uppercase tracking-widest hover:bg-red-50 transition-all">Logout</button>
        </div>
      </div>

      <nav className="flex bg-white px-6 border-b border-slate-100 overflow-x-auto no-scrollbar">
        {[
          { id: 'questions', label: 'Item Bank' },
          { id: 'import', label: 'Import Items', badge: 'PRO' },
          { id: 'tests', label: 'Assessments' },
          { id: 'approvals', label: 'Queue' }
        ].map((tab) => (
          <button 
            key={tab.id} 
            onClick={() => setActiveTab(tab.id as AdminTab)} 
            className={`relative px-6 py-4 text-[9px] font-black uppercase tracking-[0.3em] whitespace-nowrap transition-all ${activeTab === tab.id ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50/50' : 'text-slate-400 hover:text-slate-600'}`}
          >
            {tab.label}
            {tab.badge && <span className="absolute top-2 right-1 bg-amber-500 text-slate-950 text-[6px] px-1 py-0.5 rounded-sm font-black">{tab.badge}</span>}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-6 no-scrollbar safe-bottom">
        {activeTab === 'import' && (
          <div className="max-w-3xl mx-auto py-10 px-4">
            {importStatus === 'idle' && (
              <div className="bg-white p-12 rounded-[3rem] border-4 border-dashed border-slate-100 text-center hover:border-amber-500 transition-all cursor-pointer group" onClick={() => fileInputRef.current?.click()}>
                 <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={(e) => e.target.files?.[0] && processDocument(e.target.files[0])} />
                 <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-8 group-hover:bg-amber-50 transition-colors">
                    <svg className="w-10 h-10 text-slate-300 group-hover:text-amber-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                 </div>
                 <h3 className="text-xl font-black text-slate-950 mb-4 uppercase tracking-tight leading-tight">Import questions from PDF</h3>
                 <p className="text-xs text-slate-400 mb-10 italic px-4 md:px-10 leading-relaxed">Select a PDF file containing clinical assessment items. The system will scan and structure the content for review.</p>
                 <button className="px-12 py-5 bg-slate-950 text-amber-500 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] shadow-xl hover:bg-slate-900 transition-all">Select Document</button>
              </div>
            )}
            
            {importStatus === 'parsing' && (
              <div className="bg-white p-12 rounded-[3rem] shadow-2xl text-center border border-slate-100 animate-in fade-in zoom-in-95 duration-500">
                <div className="w-24 h-24 bg-slate-50 rounded-[2rem] mx-auto mb-10 flex items-center justify-center relative overflow-hidden">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-black text-slate-950 z-10">{Math.round(importProgress)}%</span>
                  </div>
                  <div className="absolute bottom-0 left-0 w-full bg-amber-500 transition-all duration-700 ease-out" style={{ height: `${importProgress}%` }}></div>
                </div>
                <h3 className="text-lg font-black text-slate-950 mb-3 uppercase tracking-tight">Processing Content</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest animate-pulse h-4">{getStatusMessage(importProgress)}</p>
                
                <div className="mt-12 max-w-sm mx-auto h-2 bg-slate-50 rounded-full overflow-hidden border border-slate-100">
                  <div className="h-full bg-amber-500 transition-all duration-700 relative" style={{ width: `${importProgress}%` }}>
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
                  </div>
                </div>
              </div>
            )}

            {importStatus === 'review' && (
              <div className="space-y-6 animate-in slide-in-from-bottom-6 duration-500">
                <div className="flex flex-col md:flex-row justify-between items-center bg-slate-950 p-8 rounded-[2rem] shadow-2xl sticky top-4 z-10 gap-4 border-b-4 border-amber-500">
                  <div className="text-center md:text-left">
                    <h3 className="text-lg font-black text-white uppercase tracking-tight">Extraction Complete</h3>
                    <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest">{stagedQuestions.length} Items successfully structured</p>
                  </div>
                  <button onClick={commitImport} className="w-full md:w-auto px-10 py-4 bg-amber-500 text-slate-950 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg hover:bg-amber-400 transition-all active:scale-95">Integrate Items</button>
                </div>
                <div className="grid grid-cols-1 gap-6">
                  {stagedQuestions.map((q, i) => (
                    <div key={i} className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm hover:border-amber-200 transition-all group">
                      <div className="flex justify-between items-center mb-6">
                         <span className="text-[8px] font-black bg-slate-100 text-slate-400 px-3 py-1 rounded-full uppercase tracking-widest">{q.subject}</span>
                         <span className="text-[8px] font-black text-amber-600 uppercase tracking-widest">{q.topic}</span>
                      </div>
                      <p className="text-sm font-bold text-slate-800 mb-8 leading-relaxed"><ScientificText text={q.text} /></p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-70">
                        {q.options.map((o, idx) => (
                           <div key={idx} className={`text-[10px] p-4 rounded-xl border flex items-center gap-3 ${idx === q.correctAnswerIndex ? 'bg-emerald-50 border-emerald-500/20 text-emerald-900 font-black' : 'bg-slate-50 border-slate-100'}`}>
                             <span className="opacity-30">{String.fromCharCode(65+idx)}</span>
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
              <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 sticky top-4">
                <h3 className="text-lg font-black text-slate-950 mb-6 uppercase tracking-tight leading-tight">Item Registry</h3>
                <form onSubmit={handleAddOrUpdateQuestion} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <input placeholder="Subject" className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-amber-500" value={qSubject} onChange={e => setQSubject(e.target.value)} required />
                    <input placeholder="Topic" className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-amber-500" value={qTopic} onChange={e => setQTopic(e.target.value)} required />
                  </div>
                  <textarea placeholder="Clinical stem or question text..." className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-bold h-32 outline-none focus:ring-2 focus:ring-amber-500" value={qText} onChange={e => setQText(e.target.value)} required />
                  {qOptions.map((o, i) => (
                    <div key={i} className="flex gap-2 group">
                       <input type="radio" checked={qCorrect === i} onChange={() => setQCorrect(i)} className="accent-amber-500" />
                       <input className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-medium outline-none focus:border-amber-500" value={o} placeholder={`Option ${String.fromCharCode(65+i)}`} onChange={e => { const n = [...qOptions]; n[i] = e.target.value; setQOptions(n); }} required />
                    </div>
                  ))}
                  <button className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] shadow-xl hover:bg-slate-900 transition-all active:scale-95">Register Item</button>
                </form>
              </div>
            </div>
            <div className="xl:col-span-2 space-y-4">
               {questions.map(q => (
                 <div key={q.id} className="bg-white p-6 rounded-3xl border border-slate-100 flex justify-between items-start hover:border-amber-200 transition-all group shadow-sm">
                   <div className="flex-1 pr-6">
                     <div className="flex gap-2 items-center mb-3">
                        <span className="text-[8px] font-black bg-slate-100 text-slate-400 px-2.5 py-1 rounded uppercase tracking-widest">{q.subject}</span>
                        <span className="text-[8px] font-black text-amber-600 uppercase tracking-widest">{q.topic}</span>
                     </div>
                     <p className="text-sm font-bold text-slate-800 leading-relaxed"><ScientificText text={q.text} /></p>
                   </div>
                   <button onClick={() => deleteDoc(doc(db, 'questions', q.id!)).then(fetchData)} className="text-slate-200 hover:text-red-500 transition-colors p-2 bg-slate-50 rounded-xl group-hover:bg-red-50"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                 </div>
               ))}
               {questions.length === 0 && (
                 <div className="py-20 text-center bg-white rounded-[3rem] border-2 border-dashed border-slate-100">
                    <p className="text-slate-300 font-black text-[10px] uppercase tracking-[0.4em]">Repository empty</p>
                 </div>
               )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
