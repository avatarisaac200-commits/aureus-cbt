
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, Question, MockTest, TestSection, ExamResult } from '../types';
import { db } from '../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, updateDoc, where, limit } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { GoogleGenAI, Type } from '@google/genai';
import ScientificText from './ScientificText';
import { LOGO_URL } from '../App';

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
      setImportProgress(prev => (prev >= 95 ? prev : prev + (prev < 40 ? 3 : 1)));
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
          { parts: [{ inlineData: { mimeType: 'application/pdf', data: base64Data } }, { text: "Extract medical multiple choice questions. Return JSON array of objects with fields: subject, topic, text, options (array of 4 strings), correctAnswerIndex, explanation." }] }
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
      setTimeout(() => setImportStatus('review'), 800);
    } catch (err) {
      clearInterval(progressInterval);
      alert("Analysis failed.");
      setImportStatus('idle');
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

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden">
      <div className="bg-white border-b border-gray-100 p-6 flex flex-col md:flex-row justify-between items-center gap-4 safe-top">
        <div className="flex items-center gap-4">
          <img src={LOGO_URL} className="w-12 h-12" alt="Logo" />
          <div>
            <h1 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Aureus Admin</h1>
            <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Workspace</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onSwitchToStudent} className="px-4 py-2 text-[10px] font-black text-slate-600 border border-gray-200 rounded-xl uppercase">Student View</button>
          <button onClick={onLogout} className="px-4 py-2 text-[10px] font-black text-red-600 border border-red-100 rounded-xl uppercase">Logout</button>
        </div>
      </div>

      <nav className="flex bg-white px-6 border-b border-gray-100 overflow-x-auto no-scrollbar">
        {[
          { id: 'questions', label: 'Questions' },
          { id: 'import', label: 'AI Import', badge: 'NEW' },
          { id: 'tests', label: 'Tests' },
          { id: 'approvals', label: 'Approvals' }
        ].map((tab) => (
          <button 
            key={tab.id} 
            onClick={() => setActiveTab(tab.id as AdminTab)} 
            className={`relative px-6 py-4 text-[9px] font-black uppercase tracking-widest whitespace-nowrap ${activeTab === tab.id ? 'border-b-4 border-amber-500 text-slate-950' : 'text-slate-400'}`}
          >
            {tab.label}
            {tab.badge && <span className="absolute top-2 right-1 bg-amber-500 text-slate-950 text-[6px] px-1 py-0.5 rounded-sm font-black">{tab.badge}</span>}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
        {activeTab === 'import' && (
          <div className="max-w-3xl mx-auto py-10">
            {importStatus === 'idle' && (
              <div className="bg-white p-12 rounded-[3rem] border-4 border-dashed border-slate-100 text-center hover:border-amber-500 transition-all cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                 <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={(e) => e.target.files?.[0] && processDocument(e.target.files[0])} />
                 <h3 className="text-xl font-black text-slate-950 mb-4 uppercase tracking-tight">Bulk PDF Analysis</h3>
                 <p className="text-xs text-slate-400 mb-8 italic px-10">Upload a PDF containing medical items. Gemini AI will automatically extract questions, options, and rationales.</p>
                 <button className="px-12 py-5 bg-slate-950 text-amber-500 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em]">Select PDF File</button>
              </div>
            )}
            
            {importStatus === 'parsing' && (
              <div className="bg-white p-12 rounded-[3rem] shadow-2xl text-center">
                <div className="w-20 h-20 bg-slate-50 rounded-full mx-auto mb-8 flex items-center justify-center relative overflow-hidden">
                  <div className="absolute bottom-0 left-0 w-full bg-amber-500 transition-all duration-500" style={{ height: `${importProgress}%` }}></div>
                  <span className="relative z-10 text-sm font-black text-slate-950">{Math.round(importProgress)}%</span>
                </div>
                <h3 className="text-lg font-black text-slate-950 mb-2 uppercase tracking-tight">Gemini AI is Analyzing...</h3>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest animate-pulse">Extracting medical knowledge</p>
              </div>
            )}

            {importStatus === 'review' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-gray-100 shadow-sm sticky top-0 z-10">
                  <h3 className="text-lg font-black text-slate-950 uppercase tracking-tight">Review Staged Items ({stagedQuestions.length})</h3>
                  <button onClick={commitImport} className="px-10 py-3 bg-slate-950 text-amber-500 rounded-xl text-[10px] font-black uppercase">Commit All</button>
                </div>
                <div className="grid grid-cols-1 gap-6">
                  {stagedQuestions.map((q, i) => (
                    <div key={i} className="bg-white p-6 rounded-2xl border border-gray-100">
                      <p className="text-sm font-bold text-slate-800 mb-4"><ScientificText text={q.text} /></p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 opacity-60">
                        {q.options.map((o, idx) => <div key={idx} className={`text-[10px] p-2 rounded-lg border ${idx === q.correctAnswerIndex ? 'bg-emerald-50 border-emerald-500/20' : ''}`}>{o}</div>)}
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
              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
                <h3 className="text-lg font-black text-slate-950 mb-6 uppercase tracking-tight">Manual Question Entry</h3>
                <form onSubmit={handleAddOrUpdateQuestion} className="space-y-4">
                  <textarea placeholder="Question Text" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold h-32" value={qText} onChange={e => setQText(e.target.value)} required />
                  {qOptions.map((o, i) => (
                    <input key={i} className="w-full p-3 bg-slate-50 border border-gray-100 rounded-xl text-xs" value={o} placeholder={`Option ${String.fromCharCode(65+i)}`} onChange={e => { const n = [...qOptions]; n[i] = e.target.value; setQOptions(n); }} required />
                  ))}
                  <button className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase text-xs">Save Question</button>
                </form>
                <div className="mt-8 pt-8 border-t border-gray-100">
                   <p className="text-[9px] text-slate-400 font-bold uppercase mb-4">Pro Tip</p>
                   <button onClick={() => setActiveTab('import')} className="w-full p-4 bg-amber-50 border border-amber-200 rounded-2xl text-[10px] font-black text-amber-600 uppercase flex items-center justify-between group">
                     Use AI PDF Analysis
                     <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
                   </button>
                </div>
              </div>
            </div>
            <div className="xl:col-span-2 space-y-4">
               {questions.map(q => (
                 <div key={q.id} className="bg-white p-6 rounded-2xl border border-gray-100 flex justify-between items-start">
                   <div>
                     <span className="text-[8px] font-black bg-amber-50 text-amber-600 px-2 py-1 rounded uppercase">{q.subject}</span>
                     <p className="text-sm font-bold text-slate-800 mt-2"><ScientificText text={q.text} /></p>
                   </div>
                   <button onClick={() => deleteDoc(doc(db, 'questions', q.id!)).then(fetchData)} className="text-slate-300 hover:text-red-500 transition-colors p-2"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                 </div>
               ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
