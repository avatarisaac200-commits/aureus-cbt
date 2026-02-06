
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, Question, MockTest, TestSection, ExamResult } from '../types';
import { db } from '../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, updateDoc, where, limit } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { GoogleGenAI, Type } from '@google/genai';
import ScientificText from './ScientificText';

const logo = '/assets/logo.png?v=2';

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
        <div className="p-6 bg-slate-50 border-t border-gray-100 text-center">
          <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Admin View • Top 10 Leaders</p>
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
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});
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
  const [newSecName, setNewSecName] = useState('');
  const [newSecPoints, setNewSecPoints] = useState(1);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [qSearchQuery, setQSearchQuery] = useState('');

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

  useEffect(() => {
    fetchData();
  }, []);

  const groupedQuestions = useMemo(() => {
    const groups: Record<string, Question[]> = {};
    questions.forEach(q => {
      const sub = q.subject || 'Uncategorized';
      if (!groups[sub]) groups[sub] = [];
      groups[sub].push(q);
    });
    return groups;
  }, [questions]);

  const participantCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    testList.forEach(test => {
      const uniqueUsers = new Set(allResults.filter(r => r.testId === test.id).map(r => r.userId));
      counts[test.id] = uniqueUsers.size;
    });
    return counts;
  }, [allResults, testList]);

  const filteredQuestionsForArchitect = useMemo(() => {
    if (!qSearchQuery.trim()) return [];
    const queryLower = qSearchQuery.toLowerCase();
    return questions.filter(q => 
      (q.subject || '').toLowerCase().includes(queryLower) || 
      (q.topic || '').toLowerCase().includes(queryLower) || 
      (q.text || '').toLowerCase().includes(queryLower)
    );
  }, [questions, qSearchQuery]);

  const handleToggleApproval = async (testId: string, currentStatus: boolean) => {
    try {
      setLoading(true);
      await updateDoc(doc(db, 'tests', testId), { isApproved: !currentStatus });
      fetchData();
    } catch (err) {
      alert("Action failed: " + err);
    } finally {
      setLoading(false);
    }
  };

  const deleteTest = async (id: string) => {
    if (window.confirm("Delete this test?")) {
      setLoading(true);
      await deleteDoc(doc(db, 'tests', id));
      fetchData();
    }
  };

  const handleAddOrUpdateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) {
      alert("Error: User session expired. Please re-login.");
      return;
    }
    setLoading(true);
    const qData = {
      subject: qSubject || 'Uncategorized',
      topic: qTopic || 'General',
      text: qText || '',
      options: qOptions || ['', '', '', ''],
      correctAnswerIndex: qCorrect || 0,
      explanation: qExplanation || '',
      updatedAt: new Date().toISOString()
    };
    try {
      if (editingId) {
        await updateDoc(doc(db, 'questions', editingId), qData);
      } else {
        await addDoc(collection(db, 'questions'), { 
          ...qData, 
          createdBy: user.id, 
          createdAt: new Date().toISOString() 
        });
      }
      resetForm();
      fetchData();
    } catch (err) { alert(err); } finally { setLoading(false); }
  };

  const resetForm = () => {
    setEditingId(null); setQSubject(''); setQTopic(''); setQText(''); setQOptions(['', '', '', '']); setQCorrect(0); setQExplanation('');
  };

  const startEditing = (q: Question) => {
    setEditingId(q.id); setQSubject(q.subject); setQTopic(q.topic); setQText(q.text); setQOptions(q.options); setQCorrect(q.correctAnswerIndex); setQExplanation(q.explanation || '');
  };

  const toggleQuestionSelection = (id: string) => {
    setSelectedQuestionIds(prev => 
      prev.includes(id) ? prev.filter(qId => qId !== id) : [...prev, id]
    );
  };

  const addSectionToTest = () => {
    if (!newSecName.trim() || selectedQuestionIds.length === 0) {
      alert("Please name the section and pick questions.");
      return;
    }
    const newSection: TestSection = {
      id: `sec_${Date.now()}`,
      name: newSecName,
      questionIds: selectedQuestionIds,
      marksPerQuestion: newSecPoints || 1
    };
    setTSections([...tSections, newSection]);
    setNewSecName('');
    setSelectedQuestionIds([]);
    setQSearchQuery('');
  };

  const handleCreateOfficialTest = async () => {
    if (!user?.id) {
      alert("Critical Error: Administrative ID not found. Action blocked.");
      return;
    }
    if (tSections.length === 0) return alert("Add at least one section first.");
    if (!tName.trim()) return alert("Test name is required.");
    
    setLoading(true);
    try {
      const newTest = {
        name: tName || 'Unnamed Test',
        description: tDesc || '',
        sections: tSections,
        totalDurationSeconds: (tDuration || 60) * 60,
        allowRetake: tRetake ?? true,
        createdBy: user.id,
        creatorName: user.name || 'Admin',
        isApproved: true,
        createdAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'tests'), newTest);
      setTName(''); setTDesc(''); setTSections([]); setTDuration(60);
      fetchData();
      alert("Test created and published.");
    } catch (err) {
      console.error(err);
      alert("Database error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  const processDocument = async (file: File) => {
    setImportStatus('parsing');
    setImportProgress(5);
    
    const progressInterval = setInterval(() => {
      setImportProgress(prev => {
        if (prev >= 92) return prev;
        const inc = prev < 40 ? 4 : (prev < 70 ? 2 : 0.8);
        return prev + inc;
      });
    }, 1200);

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
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: base64Data,
                },
              },
              {
                text: "Analyze this document and extract all medical questions. Return an array of objects. Each object must strictly follow this structure: { \"subject\": string, \"topic\": string, \"text\": string, \"options\": [string, string, string, string], \"correctAnswerIndex\": integer 0-3, \"explanation\": string }. Use LaTeX for scientific notation if present (e.g. $H_2O$, $Ca^{2+}$). Output ONLY the raw JSON array.",
              },
            ],
          },
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
      
      setTimeout(() => {
        setImportStatus('review');
        setImportProgress(0);
      }, 600);
      
    } catch (err) {
      clearInterval(progressInterval);
      console.error(err);
      alert("Structural analysis failed. Ensure the PDF contains clear multiple-choice questions.");
      setImportStatus('idle');
      setImportProgress(0);
    }
  };

  const commitImport = async () => {
    if (!user?.id) {
      alert("Error: Admin session required.");
      return;
    }
    setLoading(true);
    try {
      const timestamp = new Date().toISOString();
      for (const q of stagedQuestions) {
        await addDoc(collection(db, 'questions'), {
          ...q,
          createdBy: user.id,
          createdAt: timestamp
        });
      }
      alert(`${stagedQuestions.length} medical items successfully integrated.`);
      setStagedQuestions([]);
      setImportStatus('idle');
      fetchData();
    } catch (err) {
      alert("Integration error: " + err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden">
      {showLeaderboard && <LeaderboardModal test={showLeaderboard} onClose={() => setShowLeaderboard(null)} />}

      <div className="bg-white border-b border-gray-100 p-6 flex flex-col md:flex-row justify-between items-center gap-4 safe-top">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-12 h-12" alt="Logo" />
          <div>
            <h1 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Aureus Admin</h1>
            <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Aureus Medicos CBT Practice App</p>
          </div>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button onClick={onSwitchToStudent} className="flex-1 md:flex-none px-4 py-2 text-[10px] font-black text-slate-600 border border-gray-200 rounded-xl uppercase hover:bg-slate-50 transition-all">Student View</button>
          <button onClick={onLogout} className="px-4 py-2 text-[10px] font-black text-red-600 border border-red-100 rounded-xl uppercase transition-all">Logout</button>
        </div>
      </div>

      <nav className="flex bg-white px-6 border-b border-gray-100 overflow-x-auto no-scrollbar">
        <button onClick={() => setActiveTab('questions')} className={`px-6 py-4 text-[9px] font-black uppercase tracking-widest whitespace-nowrap ${activeTab === 'questions' ? 'border-b-4 border-amber-500 text-slate-950' : 'text-slate-400'}`}>Questions</button>
        <button onClick={() => setActiveTab('import')} className={`px-6 py-4 text-[9px] font-black uppercase tracking-widest whitespace-nowrap ${activeTab === 'import' ? 'border-b-4 border-amber-500 text-slate-950' : 'text-slate-400'}`}>Integrator</button>
        <button onClick={() => setActiveTab('tests')} className={`px-6 py-4 text-[9px] font-black uppercase tracking-widest whitespace-nowrap ${activeTab === 'tests' ? 'border-b-4 border-amber-500 text-slate-950' : 'text-slate-400'}`}>Tests</button>
        <button onClick={() => setActiveTab('approvals')} className={`px-6 py-4 text-[9px] font-black uppercase tracking-widest whitespace-nowrap flex items-center gap-2 ${activeTab === 'approvals' ? 'border-b-4 border-amber-500 text-slate-950' : 'text-slate-400'}`}>
          Pending
          {testList.filter((t: MockTest) => !t.isApproved).length > 0 && <span className="bg-amber-500 text-slate-950 text-[8px] px-2 py-0.5 rounded-full">{testList.filter((t: MockTest) => !t.isApproved).length}</span>}
        </button>
      </nav>

      <div className="flex-1 overflow-y-auto p-6 md:p-10 no-scrollbar safe-bottom">
        <div className="max-w-7xl mx-auto">
          
          {activeTab === 'import' && (
            <div className="space-y-10">
              {importStatus === 'idle' && (
                <div className="max-w-3xl mx-auto bg-white p-12 rounded-[3rem] border-4 border-dashed border-slate-100 flex flex-col items-center justify-center text-center transition-all hover:border-amber-500 group">
                   <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-8 group-hover:bg-amber-50 transition-colors">
                     <svg className="w-10 h-10 text-slate-300 group-hover:text-amber-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                   </div>
                   <h3 className="text-xl font-black text-slate-950 mb-4 uppercase tracking-tight">Contextual Document Parser</h3>
                   <p className="text-xs text-slate-400 max-w-sm mb-10 leading-relaxed font-medium italic">Instantly integrate high-fidelity medical content from source documents. Layout and notation patterns are automatically preserved.</p>
                   <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={(e) => e.target.files?.[0] && processDocument(e.target.files[0])} />
                   <button onClick={() => fileInputRef.current?.click()} className="px-12 py-5 bg-slate-950 text-amber-500 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] shadow-2xl active:scale-95 transition-all">Analyze PDF</button>
                </div>
              )}

              {importStatus === 'parsing' && (
                <div className="max-w-lg mx-auto bg-white p-12 rounded-[3rem] shadow-2xl border border-gray-100 flex flex-col items-center">
                  <div className="relative w-24 h-24 mb-10 flex items-center justify-center">
                    <div className="absolute inset-0 border-4 border-slate-50 rounded-full"></div>
                    <div 
                      className="absolute inset-0 border-4 border-amber-500 rounded-full border-t-transparent transition-all duration-300" 
                      style={{ transform: `rotate(${importProgress * 3.6}deg)` }}
                    ></div>
                    <span className="text-sm font-black text-slate-900">{Math.round(importProgress)}%</span>
                  </div>
                  <h3 className="text-lg font-black text-slate-950 mb-6 uppercase tracking-tight">Pattern Recognition</h3>
                  
                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mb-4">
                    <div 
                      className="bg-amber-500 h-full transition-all duration-700 ease-out" 
                      style={{ width: `${importProgress}%` }}
                    ></div>
                  </div>
                  
                  <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest animate-pulse h-4 text-center">
                    {importProgress < 30 ? 'Analyzing Document Layout...' : 
                     importProgress < 60 ? 'Extracting Medical Context...' : 
                     importProgress < 90 ? 'Formatting Scientific Notation...' : 
                     'Finalizing Integration...'}
                  </p>
                </div>
              )}

              {importStatus === 'review' && (
                <div className="space-y-8 animate-in slide-in-from-bottom-10">
                   <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-gray-100 shadow-sm sticky top-0 z-10">
                      <div>
                        <h3 className="text-lg font-black text-slate-950 uppercase tracking-tight">Integration Staging</h3>
                        <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">{stagedQuestions.length} items mapped from source</p>
                      </div>
                      <div className="flex gap-3">
                         <button onClick={() => setImportStatus('idle')} className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Discard</button>
                         <button onClick={commitImport} className="px-10 py-3 bg-slate-950 text-amber-500 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl active:scale-95">Bulk Integrate</button>
                      </div>
                   </div>
                   
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
                     {stagedQuestions.map((q, i) => (
                       <div key={i} className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm relative group">
                          <button onClick={() => setStagedQuestions(prev => prev.filter((_, idx) => idx !== i))} className="absolute top-6 right-6 text-slate-200 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                          <div className="flex gap-2 mb-4">
                            <span className="text-[8px] font-black bg-slate-50 border border-slate-100 px-3 py-1 rounded-full text-slate-400 uppercase">{q.subject}</span>
                            <span className="text-[8px] font-black bg-amber-50 border border-amber-200 px-3 py-1 rounded-full text-amber-600 uppercase">{q.topic}</span>
                          </div>
                          <p className="text-sm font-black text-slate-900 mb-6 leading-relaxed"><ScientificText text={q.text} /></p>
                          <div className="space-y-2 mb-6">
                            {q.options.map((opt, idx) => (
                              <div key={idx} className={`p-3 rounded-xl border text-[10px] font-bold ${idx === q.correctAnswerIndex ? 'bg-emerald-50 border-emerald-500/20 text-emerald-900' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                                <ScientificText text={opt} />
                              </div>
                            ))}
                          </div>
                          <div className="p-4 bg-slate-900 rounded-2xl text-[10px] text-slate-300 leading-relaxed italic">
                            <ScientificText text={q.explanation || ''} />
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
                <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 sticky top-0">
                  <h3 className="text-lg font-black text-slate-950 mb-6 uppercase tracking-tight">{editingId ? 'Edit Question' : 'Add Question'}</h3>
                  <form onSubmit={handleAddOrUpdateQuestion} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <input placeholder="Subject" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold" value={qSubject} onChange={e => setQSubject(e.target.value)} required />
                      <input placeholder="Topic" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold" value={qTopic} onChange={e => setQTopic(e.target.value)} required />
                    </div>
                    <textarea placeholder="Write question..." className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold min-h-[120px]" value={qText} onChange={e => setQText(e.target.value)} required />
                    <div className="space-y-2">
                      {qOptions.map((opt, idx) => (
                        <div key={idx} className="flex gap-3 items-center">
                          <input type="radio" checked={qCorrect === idx} onChange={() => setQCorrect(idx)} />
                          <input placeholder={`Option ${String.fromCharCode(65+idx)}`} className="flex-1 p-3 bg-slate-50 border border-gray-100 rounded-xl text-xs font-bold" value={opt} onChange={e => {
                            const n = [...qOptions]; n[idx] = e.target.value; setQOptions(n);
                          }} required />
                        </div>
                      ))}
                    </div>
                    <textarea placeholder="Explanation" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold min-h-[100px]" value={qExplanation} onChange={e => setQExplanation(e.target.value)} />
                    <button className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl active:scale-95 transition-all">Save</button>
                    {editingId && <button onClick={resetForm} className="w-full py-2 text-[10px] font-black text-red-500 uppercase">Cancel</button>}
                  </form>
                </div>
              </div>
              <div className="xl:col-span-2 space-y-6">
                 {Object.entries(groupedQuestions).map(([subject, qs]) => (
                   <div key={subject} className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                     <button onClick={() => setExpandedSubjects(p => ({...p, [subject]: !p[subject]}))} className="w-full flex justify-between items-center p-6 bg-slate-50 hover:bg-slate-100 transition-all">
                       <span className="text-sm font-black uppercase text-slate-900 tracking-tight">{subject} <span className="text-slate-400 font-bold">({qs.length})</span></span>
                       <svg className={`w-5 h-5 transition-transform ${expandedSubjects[subject] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                     </button>
                     {expandedSubjects[subject] && (
                       <div className="p-4 space-y-4">
                         {qs.map((q: Question) => (
                           <div key={q.id} className="p-5 rounded-2xl border border-slate-100 hover:border-amber-200 transition-all relative">
                             <div className="flex justify-between items-start mb-2">
                               <span className="text-[8px] font-black bg-amber-50 text-amber-600 px-3 py-1 rounded-full uppercase tracking-widest">{q.topic}</span>
                               <div className="flex gap-3">
                                 <button onClick={() => startEditing(q)} className="text-[9px] font-black text-slate-400 hover:text-amber-500 uppercase">Edit</button>
                                 <button onClick={() => deleteDoc(doc(db, 'questions', q.id!)).then(fetchData)} className="text-[9px] font-black text-slate-400 hover:text-red-500 uppercase">Delete</button>
                               </div>
                             </div>
                             <p className="text-xs font-bold text-slate-800"><ScientificText text={q.text} /></p>
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
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
              <div className="xl:col-span-1">
                <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 sticky top-0">
                   <h3 className="text-lg font-black text-slate-950 mb-6 uppercase tracking-tight">Create Test</h3>
                   <div className="space-y-4">
                      <input placeholder="Name" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold" value={tName} onChange={e => setTName(e.target.value)} />
                      <textarea placeholder="About this test..." className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold min-h-[80px]" value={tDesc} onChange={e => setTDesc(e.target.value)} />
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-gray-100">
                        <span className="text-[10px] font-black text-slate-400 uppercase">Mins</span>
                        <input type="number" className="w-16 p-2 bg-white border border-gray-200 rounded-xl text-xs text-center font-black" value={tDuration} onChange={e => setTDuration(parseInt(e.target.value))} />
                      </div>
                      
                      <div className="p-6 bg-slate-950 rounded-[2rem] border-2 border-amber-500/10 mt-4">
                        <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-4 text-center">Sections</p>
                        <input placeholder="Search questions..." className="w-full p-3 text-xs bg-slate-900 text-white rounded-xl mb-3 border border-slate-800 outline-none focus:border-amber-500 font-bold" value={qSearchQuery} onChange={e => setQSearchQuery(e.target.value)} />
                        {filteredQuestionsForArchitect.length > 0 && (
                          <div className="max-h-48 overflow-y-auto mb-4 space-y-2 no-scrollbar">
                             {filteredQuestionsForArchitect.map((q: Question) => (
                               <div key={q.id} onClick={() => toggleQuestionSelection(q.id)} className={`p-3 rounded-xl border transition-all cursor-pointer ${selectedQuestionIds.includes(q.id) ? 'border-amber-500 bg-amber-500/10' : 'border-slate-800 bg-slate-800/20'}`}>
                                  <p className="text-[9px] text-white font-bold line-clamp-2"><ScientificText text={q.text} /></p>
                               </div>
                             ))}
                          </div>
                        )}
                        <div className="flex items-center gap-3 mb-4">
                           <input placeholder="Section Name" className="flex-1 p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white font-bold" value={newSecName} onChange={e => setNewSecName(e.target.value)} />
                           <input type="number" className="w-14 p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs text-amber-500 text-center font-black" value={newSecPoints} onChange={e => setNewSecPoints(parseInt(e.target.value))} />
                        </div>
                        <button onClick={addSectionToTest} className="w-full py-4 bg-amber-500 text-slate-950 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-400 active:scale-95 transition-all">Add to Test ({selectedQuestionIds.length})</button>
                      </div>

                      {tSections.map((s: TestSection, idx: number) => (
                        <div key={idx} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex justify-between items-center">
                          <span className="text-[10px] font-black uppercase text-slate-900">{s.name}</span>
                          <span className="text-[9px] font-black text-slate-400">{s.questionIds.length} Qs</span>
                        </div>
                      ))}

                      <button onClick={handleCreateOfficialTest} className="w-full py-5 bg-slate-950 text-amber-500 rounded-[2rem] font-black uppercase text-xs tracking-widest mt-6 shadow-2xl active:scale-95 transition-all">Launch Test</button>
                   </div>
                </div>
              </div>
              <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                 {testList.filter((t: MockTest) => t.isApproved).map((test: MockTest) => (
                   <div key={test.id} className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm relative group h-fit flex flex-col">
                     <button onClick={() => deleteTest(test.id!)} className="absolute top-8 right-8 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                     <h4 className="text-lg font-black text-slate-950 mb-3 uppercase tracking-tight leading-tight">{test.name}</h4>
                     <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-4">{new Date(test.createdAt).toLocaleDateString()}</p>
                     
                     <div className="flex gap-2 mb-6">
                        <button 
                          onClick={() => setShowLeaderboard(test)}
                          className="text-[8px] font-black bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full text-amber-600 hover:bg-amber-500 hover:text-white transition-all active:scale-95 uppercase tracking-widest"
                        >
                          {participantCounts[test.id] || 0} Participants
                        </button>
                     </div>

                     <div className="flex flex-wrap gap-2 mb-8 flex-1">
                        {test.sections.map((s: TestSection, i: number) => <span key={i} className="text-[8px] font-black bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-full text-slate-400 uppercase">{s.name}</span>)}
                     </div>
                     
                     <button onClick={() => handleToggleApproval(test.id!, true)} className="w-full py-3 bg-slate-900 text-amber-500 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all mt-auto">Disable</button>
                   </div>
                 ))}
              </div>
            </div>
          )}

          {activeTab === 'approvals' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {testList.filter((t: MockTest) => !t.isApproved).map((test: MockTest) => (
                <div key={test.id} className="bg-white p-8 rounded-[2.5rem] border-2 border-amber-200 shadow-xl flex flex-col">
                  <h3 className="text-lg font-black text-slate-950 mb-4 uppercase tracking-tight leading-tight">{test.name}</h3>
                  <p className="text-[10px] text-slate-500 mb-6 italic flex-1 truncate">{test.description}</p>
                  <div className="flex gap-2 mb-8">
                     <span className="bg-slate-50 text-slate-400 text-[8px] font-black uppercase px-3 py-1.5 rounded-full border border-slate-100">{(test.sections[0]?.questionIds?.length || 0)} Qs</span>
                     <span className="bg-slate-50 text-slate-400 text-[8px] font-black uppercase px-3 py-1.5 rounded-full border border-slate-100">{test.totalDurationSeconds / 60} Mins</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => deleteTest(test.id!)} className="py-3 bg-red-50 text-red-600 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all">Reject</button>
                    <button onClick={() => handleToggleApproval(test.id!, false)} className="py-3 bg-emerald-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all shadow-md">Approve</button>
                  </div>
                </div>
              ))}
              {testList.filter((t: MockTest) => !t.isApproved).length === 0 && (
                <div className="col-span-full py-32 text-center bg-white rounded-[3rem] border-2 border-dashed border-slate-100 text-slate-300 font-black uppercase text-[10px] tracking-[0.4em]">Empty Queue</div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
