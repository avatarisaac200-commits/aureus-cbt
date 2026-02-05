
import React, { useState, useEffect, useMemo } from 'react';
import { User, Question, MockTest, TestSection } from '../types';
import { db } from '../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, updateDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import ScientificText from './ScientificText';
import logo from '../assets/logo.png';

interface AdminDashboardProps {
  user: User;
  onLogout: () => void;
  onSwitchToStudent: () => void;
}

// Fixed: Explicitly type the AdminTab to avoid inference overlap issues
type AdminTab = 'questions' | 'tests' | 'approvals';

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onLogout, onSwitchToStudent }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('questions');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [testList, setTestList] = useState<MockTest[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});
  
  // Question Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [qSubject, setQSubject] = useState('');
  const [qTopic, setQTopic] = useState('');
  const [qText, setQText] = useState('');
  const [qOptions, setQOptions] = useState(['', '', '', '']);
  const [qCorrect, setQCorrect] = useState(0);
  const [qExplanation, setQExplanation] = useState('');

  // Test Form State (Architect)
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

  const filteredQuestionsForArchitect = useMemo(() => {
    if (!qSearchQuery.trim()) return [];
    const queryLower = qSearchQuery.toLowerCase();
    return questions.filter(q => 
      q.subject.toLowerCase().includes(queryLower) || 
      q.topic.toLowerCase().includes(queryLower) || 
      q.text.toLowerCase().includes(queryLower)
    );
  }, [questions, qSearchQuery]);

  const handleToggleApproval = async (testId: string, currentStatus: boolean) => {
    try {
      setLoading(true);
      await updateDoc(doc(db, 'tests', testId), { isApproved: !currentStatus });
      fetchData();
    } catch (err) {
      alert("Approval action failed: " + err);
    } finally {
      setLoading(false);
    }
  };

  const deleteTest = async (id: string) => {
    if (window.confirm("Permanently delete this exam submission?")) {
      setLoading(true);
      await deleteDoc(doc(db, 'tests', id));
      fetchData();
    }
  };

  const handleAddOrUpdateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const qData = {
      subject: qSubject,
      topic: qTopic,
      text: qText,
      options: qOptions,
      correctAnswerIndex: qCorrect,
      explanation: qExplanation,
      updatedAt: new Date().toISOString()
    };
    try {
      if (editingId) {
        await updateDoc(doc(db, 'questions', editingId), qData);
      } else {
        await addDoc(collection(db, 'questions'), { ...qData, createdBy: user.id, createdAt: new Date().toISOString() });
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleQuestionSelection = (id: string) => {
    setSelectedQuestionIds(prev => 
      prev.includes(id) ? prev.filter(qId => qId !== id) : [...prev, id]
    );
  };

  const addSectionToTest = () => {
    if (!newSecName.trim() || selectedQuestionIds.length === 0) {
      alert("Please name the section and select at least one question.");
      return;
    }
    const newSection: TestSection = {
      id: `sec_${Date.now()}`,
      name: newSecName,
      questionIds: selectedQuestionIds,
      marksPerQuestion: newSecPoints
    };
    setTSections([...tSections, newSection]);
    setNewSecName('');
    setSelectedQuestionIds([]);
    setQSearchQuery('');
  };

  const handleCreateOfficialTest = async () => {
    if (tSections.length === 0) return alert("Add at least one section before publishing.");
    if (!tName.trim()) return alert("Exam title is required.");
    
    setLoading(true);
    try {
      const newTest: Omit<MockTest, 'id'> = {
        name: tName,
        description: tDesc,
        sections: tSections,
        totalDurationSeconds: tDuration * 60,
        allowRetake: tRetake,
        createdBy: user.id,
        creatorName: "Administrator",
        isApproved: true,
        createdAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'tests'), newTest);
      
      setTName(''); setTDesc(''); setTSections([]); setTDuration(60);
      fetchData();
      alert("Official Practice Test published live.");
    } catch (err) {
      alert("Error: " + err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pt-4 pb-8 md:pt-8 md:pb-12 px-4 md:px-8">
      <div className="max-w-7xl mx-auto w-full">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-10 gap-6 bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
             <img src={logo} className="w-14 h-14 md:w-16 md:h-16" alt="Logo" />
             <div>
                <h1 className="text-xl md:text-2xl font-black text-slate-950 uppercase tracking-tighter">Admin Console</h1>
                <p className="text-amber-600 text-[10px] font-black uppercase tracking-widest mt-1">Management Engine</p>
             </div>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <button onClick={onSwitchToStudent} className="flex-1 md:flex-none px-6 py-3 text-[10px] font-black text-slate-600 bg-white border border-slate-200 rounded-xl uppercase hover:shadow-md transition-all active:scale-95">Student View</button>
            <button onClick={onLogout} className="px-6 py-3 text-[10px] font-black text-red-600 bg-white border border-red-100 rounded-xl uppercase active:scale-95">Logout</button>
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="flex border-b border-gray-200 mb-10 overflow-x-auto no-scrollbar">
          <button onClick={() => setActiveTab('questions')} className={`px-8 py-5 text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${activeTab === 'questions' ? 'border-b-4 border-amber-500 text-slate-950' : 'text-slate-400'}`}>Cloud Bank</button>
          <button onClick={() => setActiveTab('tests')} className={`px-8 py-5 text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${activeTab === 'tests' ? 'border-b-4 border-amber-500 text-slate-950' : 'text-slate-400'}`}>Official Store</button>
          <button onClick={() => setActiveTab('approvals')} className={`px-8 py-5 text-[10px] font-black uppercase tracking-widest whitespace-nowrap flex items-center gap-2 ${activeTab === 'approvals' ? 'border-b-4 border-amber-500 text-slate-950' : 'text-slate-400'}`}>
            Approval Queue
            {testList.filter(t => !t.isApproved).length > 0 && <span className="bg-amber-500 text-slate-950 text-[8px] px-2 py-0.5 rounded-full animate-pulse">{testList.filter(t => !t.isApproved).length}</span>}
          </button>
        </nav>

        {/* Individual blocks are non-nested and independent */}
        {activeTab === 'questions' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
            <div className="xl:col-span-1">
               <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 sticky top-8">
                 <div className="flex justify-between items-center mb-8">
                   <h3 className="text-lg font-black text-slate-950 uppercase tracking-tight">{editingId ? 'Modify Record' : 'Manual Entry'}</h3>
                   {editingId && <button onClick={resetForm} className="text-[10px] font-black text-red-500 uppercase">Discard</button>}
                 </div>
                 <form onSubmit={handleAddOrUpdateQuestion} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <input placeholder="Subject" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold" value={qSubject} onChange={e => setQSubject(e.target.value)} required />
                      <input placeholder="Topic" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold" value={qTopic} onChange={e => setQTopic(e.target.value)} required />
                    </div>
                    <textarea placeholder="Text content..." className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold min-h-[120px]" value={qText} onChange={e => setQText(e.target.value)} required />
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
                    <button className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase text-xs tracking-widest mt-6 shadow-xl active:scale-95 transition-all">Save Cloud Data</button>
                 </form>
               </div>
            </div>
            <div className="xl:col-span-2 space-y-6">
               {Object.entries(groupedQuestions).map(([subject, qs]) => (
                 <div key={subject} className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                   <button onClick={() => setExpandedSubjects(p => ({...p, [subject]: !p[subject]}))} className="w-full flex justify-between items-center p-6 bg-slate-50 hover:bg-slate-100 transition-all group">
                     <span className="text-sm font-black uppercase text-slate-900 tracking-tight">{subject} <span className="text-slate-400 font-bold">({qs.length})</span></span>
                     <svg className={`w-5 h-5 transition-transform ${expandedSubjects[subject] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                   </button>
                   {expandedSubjects[subject] && (
                     <div className="p-4 space-y-4">
                       {qs.map(q => (
                         <div key={q.id} className="p-5 rounded-2xl border border-slate-100 hover:border-amber-200 transition-all group relative">
                           <div className="flex justify-between items-start mb-2">
                             <span className="text-[8px] font-black bg-amber-50 text-amber-600 px-3 py-1 rounded-full uppercase">{q.topic}</span>
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

        {/* Individual blocks are non-nested and independent */}
        {activeTab === 'tests' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
            {/* Left: Architect Form */}
            <div className="xl:col-span-1">
               <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 sticky top-8">
                 <h3 className="text-lg font-black text-slate-950 mb-6 uppercase tracking-tight">Official Test Architect</h3>
                 <div className="space-y-4">
                    <input placeholder="Exam Title" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-slate-950/5" value={tName} onChange={e => setTName(e.target.value)} />
                    <textarea placeholder="Instructions" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold min-h-[80px]" value={tDesc} onChange={e => setTDesc(e.target.value)} />
                    
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                      <span className="text-[10px] font-black text-slate-400 uppercase">Duration (Mins)</span>
                      <input type="number" className="w-20 p-2 bg-white border border-gray-100 rounded-xl text-xs text-center font-black" value={tDuration} onChange={e => setTDuration(parseInt(e.target.value))} />
                    </div>

                    <div className="p-6 bg-slate-950 rounded-[2rem] border-2 border-amber-500/20 mt-4">
                      <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-4 text-center">Section Config</p>
                      <input 
                        placeholder="Search bank (Subject/Topic)..." 
                        className="w-full p-3 text-xs bg-slate-900 text-white rounded-xl mb-3 outline-none border border-slate-800 focus:border-amber-500 font-bold" 
                        value={qSearchQuery} 
                        onChange={e => setQSearchQuery(e.target.value)} 
                      />
                      
                      {filteredQuestionsForArchitect.length > 0 && (
                        <div className="max-h-52 overflow-y-auto mb-4 p-2 bg-slate-900 rounded-xl border border-slate-800 space-y-2 no-scrollbar">
                           {filteredQuestionsForArchitect.map(q => (
                             <div key={q.id} onClick={() => toggleQuestionSelection(q.id)} className={`p-3 rounded-xl border transition-all cursor-pointer ${selectedQuestionIds.includes(q.id) ? 'border-amber-500 bg-amber-500/10' : 'border-slate-800 bg-slate-800/30'}`}>
                                <p className="text-[9px] text-white font-bold line-clamp-2"><ScientificText text={q.text} /></p>
                                <span className="text-[8px] text-slate-500 uppercase font-black">{q.subject} • {q.topic}</span>
                             </div>
                           ))}
                        </div>
                      )}

                      <div className="flex items-center gap-3 mb-4">
                         <input placeholder="Section Name" className="flex-1 p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white font-bold" value={newSecName} onChange={e => setNewSecName(e.target.value)} />
                         <input type="number" className="w-14 p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs text-amber-500 text-center font-black" value={newSecPoints} onChange={e => setNewSecPoints(parseInt(e.target.value))} />
                      </div>

                      <button onClick={addSectionToTest} className="w-full py-4 bg-amber-500 text-slate-950 rounded-2xl text-[10px] font-black uppercase hover:bg-amber-400 active:scale-95 transition-all">
                        Add Section ({selectedQuestionIds.length} Qs)
                      </button>
                    </div>

                    {tSections.length > 0 && (
                      <div className="space-y-2 py-2">
                        {tSections.map((s, idx) => (
                          <div key={idx} className="flex justify-between items-center p-3 bg-slate-50 border border-slate-100 rounded-xl">
                            <span className="text-[10px] font-black uppercase text-slate-900">{s.name}</span>
                            <span className="text-[9px] font-black text-slate-400">{s.questionIds.length} Qs • {s.marksPerQuestion} Pts</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <button onClick={handleCreateOfficialTest} className="w-full py-5 bg-slate-950 text-amber-500 rounded-[1.8rem] font-black uppercase text-xs tracking-widest mt-6 shadow-2xl active:scale-95 transition-all">
                      Publish Official Exam
                    </button>
                 </div>
               </div>
            </div>

            {/* Right: Existing Exams */}
            <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
               {testList.filter(t => t.isApproved).length === 0 ? (
                 <div className="col-span-full py-20 text-center bg-white rounded-[3rem] border-2 border-dashed border-slate-100">
                   <p className="text-slate-300 font-black uppercase text-xs tracking-widest">No active official exams.</p>
                 </div>
               ) : (
                 testList.filter(t => t.isApproved).map(test => (
                   <div key={test.id} className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm relative group hover:shadow-xl transition-all h-fit">
                     <button onClick={() => deleteTest(test.id!)} className="absolute top-8 right-8 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                     </button>
                     <h4 className="text-lg font-black text-slate-950 mb-3 uppercase tracking-tight leading-tight">{test.name}</h4>
                     <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-6">By {test.creatorName || 'System'}</p>
                     <div className="flex flex-wrap gap-2 mb-8">
                        {test.sections.map((s, i) => (
                          <span key={i} className="text-[8px] font-black bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-full text-slate-400 uppercase">{s.name} ({s.questionIds.length}Q)</span>
                        ))}
                     </div>
                     <button onClick={() => handleToggleApproval(test.id!, true)} className="w-full py-3.5 bg-slate-900 text-amber-500 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-slate-800 active:scale-95 shadow-md">Take Down / Unapprove</button>
                   </div>
                 ))
               )}
            </div>
          </div>
        )}

        {/* Individual blocks are non-nested and independent */}
        {activeTab === 'approvals' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {testList.filter(t => !t.isApproved).length === 0 ? (
               <div className="col-span-full py-20 text-center bg-white rounded-[3rem] border-2 border-dashed border-slate-100">
                  <p className="text-slate-300 font-black uppercase text-xs tracking-widest">No submissions awaiting review.</p>
               </div>
            ) : (
              testList.filter(t => !t.isApproved).map(test => (
                <div key={test.id} className="bg-white p-8 rounded-[2.5rem] border-2 border-amber-200 shadow-xl flex flex-col hover:shadow-2xl transition-all">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center font-black text-slate-950 uppercase shadow-md">{test.creatorName?.charAt(0) || 'U'}</div>
                    <div>
                      <h4 className="text-xs font-black uppercase text-slate-900 tracking-tight leading-none">{test.creatorName || 'Anonymous'}</h4>
                      <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest mt-1">Proposed Exam Structure</p>
                    </div>
                  </div>
                  <h3 className="text-lg font-black text-slate-950 mb-4 uppercase tracking-tight leading-tight">{test.name}</h3>
                  <p className="text-[10px] text-slate-500 line-clamp-3 mb-6 flex-1 italic">"{test.description}"</p>
                  <div className="flex flex-wrap gap-2 mb-8">
                     <span className="bg-slate-50 text-slate-400 text-[8px] font-black uppercase px-3 py-1.5 rounded-full border border-slate-100">{test.sections[0].questionIds.length} QUESTIONS</span>
                     <span className="bg-slate-50 text-slate-400 text-[8px] font-black uppercase px-3 py-1.5 rounded-full border border-slate-100">{test.totalDurationSeconds / 60} MINS</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => deleteTest(test.id!)} className="py-3.5 bg-red-50 text-red-600 rounded-xl text-[9px] font-black uppercase hover:bg-red-100 transition-all active:scale-95">Reject</button>
                    <button onClick={() => handleToggleApproval(test.id!, false)} className="py-3.5 bg-emerald-600 text-white rounded-xl text-[9px] font-black uppercase hover:bg-emerald-500 transition-all shadow-lg active:scale-95">Go Live</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
