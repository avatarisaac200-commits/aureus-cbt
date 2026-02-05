
import React, { useState, useEffect } from 'react';
import { User, Question, MockTest, TestSection } from '../types';
import { db } from '../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import ScientificText from './ScientificText';

interface AdminDashboardProps {
  user: User;
  onLogout: () => void;
  onSwitchToStudent: () => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onLogout, onSwitchToStudent }) => {
  const [activeTab, setActiveTab] = useState<'questions' | 'tests'>('questions');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [tests, setTests] = useState<MockTest[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Question Form State
  const [qSubject, setQSubject] = useState('');
  const [qTopic, setQTopic] = useState('');
  const [qText, setQText] = useState('');
  const [qOptions, setQOptions] = useState(['', '', '', '']);
  const [qCorrect, setQCorrect] = useState(0);

  // Test Form State
  const [tName, setTName] = useState('');
  const [tDesc, setTDesc] = useState('');
  const [tDuration, setTDuration] = useState(60);
  const [tRetake, setTRetake] = useState(true);
  const [tSections, setTSections] = useState<TestSection[]>([]);
  
  const [newSecName, setNewSecName] = useState('');
  const [newSecPoints, setNewSecPoints] = useState(1);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [availableQuestionsForSubject, setAvailableQuestionsForSubject] = useState<Question[]>([]);

  const fetchData = async () => {
    setLoading(true);
    const qSnap = await getDocs(query(collection(db, 'questions'), orderBy('createdAt', 'desc')));
    setQuestions(qSnap.docs.map(d => ({ ...d.data(), id: d.id } as Question)));
    
    const tSnap = await getDocs(collection(db, 'tests'));
    setTests(tSnap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest)));
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (newSecName.trim()) {
      const filtered = questions.filter(q => 
        q.subject.toLowerCase().includes(newSecName.toLowerCase()) ||
        q.topic.toLowerCase().includes(newSecName.toLowerCase())
      );
      setAvailableQuestionsForSubject(filtered);
    } else {
      setAvailableQuestionsForSubject([]);
    }
  }, [newSecName, questions]);

  const handleAddQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const newQ = {
      subject: qSubject,
      topic: qTopic,
      text: qText,
      options: qOptions,
      correctAnswerIndex: qCorrect,
      createdAt: new Date().toISOString()
    };
    await addDoc(collection(db, 'questions'), newQ);
    setQText('');
    setQOptions(['', '', '', '']);
    fetchData();
    alert('Question added to cloud bank.');
  };

  const deleteQuestion = async (id: string) => {
    if (window.confirm("Delete this question from the cloud?")) {
      setLoading(true);
      await deleteDoc(doc(db, 'questions', id));
      fetchData();
    }
  };

  const deleteTest = async (id: string) => {
    if (window.confirm("Permanently delete this exam?")) {
      setLoading(true);
      await deleteDoc(doc(db, 'tests', id));
      fetchData();
    }
  };

  const toggleQuestionSelection = (id: string) => {
    setSelectedQuestionIds(prev => 
      prev.includes(id) ? prev.filter(qId => qId !== id) : [...prev, id]
    );
  };

  const addSectionToTest = () => {
    if (!newSecName || selectedQuestionIds.length === 0) {
      alert("Name the section and select questions.");
      return;
    }
    const newSection: TestSection = {
      id: `s_${Date.now()}`,
      name: newSecName,
      questionIds: selectedQuestionIds,
      marksPerQuestion: newSecPoints
    };
    setTSections([...tSections, newSection]);
    setNewSecName('');
    setSelectedQuestionIds([]);
  };

  const handleCreateTest = async () => {
    if (tSections.length === 0) return alert("Add at least one section.");
    setLoading(true);
    const newTest: Omit<MockTest, 'id'> = {
      name: tName,
      description: tDesc,
      sections: tSections,
      totalDurationSeconds: tDuration * 60,
      allowRetake: tRetake
    };
    await addDoc(collection(db, 'tests'), newTest);
    setTName('');
    setTDesc('');
    setTSections([]);
    fetchData();
    alert("Practice test published globally.");
  };

  return (
    <div className="max-w-7xl mx-auto p-8">
      <div className="flex flex-col md:flex-row justify-between items-center mb-10 gap-6">
        <div className="flex items-center gap-4">
           <img src="logo.png" className="w-16 h-16" alt="Logo" />
           <div>
              <h1 className="text-2xl font-black text-slate-950 uppercase tracking-tighter leading-none">Admin Console</h1>
              <p className="text-amber-600 text-[10px] font-black uppercase tracking-widest mt-1">Cloud Synchronized</p>
           </div>
        </div>
        <div className="flex gap-4">
          <button onClick={onSwitchToStudent} className="px-6 py-2 text-[10px] font-black text-slate-600 bg-white border border-slate-200 rounded-xl uppercase tracking-widest hover:shadow-md transition-all">Student View</button>
          <button onClick={onLogout} className="px-6 py-2 text-[10px] font-black text-red-600 bg-white border border-red-100 rounded-xl uppercase tracking-widest hover:shadow-md transition-all">Logout</button>
        </div>
      </div>

      <nav className="flex border-b border-gray-200 mb-10 overflow-x-auto no-scrollbar">
        <button onClick={() => setActiveTab('questions')} className={`px-10 py-5 text-[10px] font-black uppercase tracking-[0.3em] whitespace-nowrap ${activeTab === 'questions' ? 'border-b-4 border-amber-500 text-slate-950' : 'text-slate-400'}`}>Question Bank</button>
        <button onClick={() => setActiveTab('tests')} className={`px-10 py-5 text-[10px] font-black uppercase tracking-[0.3em] whitespace-nowrap ${activeTab === 'tests' ? 'border-b-4 border-amber-500 text-slate-950' : 'text-slate-400'}`}>Test Architect</button>
      </nav>

      {loading && (
        <div className="flex justify-center p-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
        </div>
      )}

      {!loading && activeTab === 'questions' ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
          <div className="xl:col-span-1">
             <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 sticky top-8">
               <h3 className="text-lg font-black text-slate-950 mb-8 uppercase tracking-tight">Add New Question</h3>
               <form onSubmit={handleAddQuestion} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <input placeholder="Subject" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold" value={qSubject} onChange={e => setQSubject(e.target.value)} required />
                    <input placeholder="Topic" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold" value={qTopic} onChange={e => setQTopic(e.target.value)} required />
                  </div>
                  <textarea placeholder="Supports notation: H_{2}O, 10^{3}, [a/b]" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold min-h-[120px] outline-none focus:ring-2 focus:ring-amber-500/20" value={qText} onChange={e => setQText(e.target.value)} required />
                  <div className="space-y-3">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Answer Options</p>
                    {qOptions.map((opt, idx) => (
                      <div key={idx} className="flex gap-3 items-center">
                        <input type="radio" checked={qCorrect === idx} onChange={() => setQCorrect(idx)} className="text-amber-500" />
                        <input placeholder={`Option ${String.fromCharCode(65+idx)}`} className="flex-1 p-3 bg-slate-50 border border-gray-100 rounded-xl text-xs font-bold" value={opt} onChange={e => {
                          const n = [...qOptions]; n[idx] = e.target.value; setQOptions(n);
                        }} required />
                      </div>
                    ))}
                  </div>
                  <button className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase text-xs tracking-[0.2em] mt-6 shadow-xl hover:bg-slate-800 transition-all">Save to Bank</button>
               </form>
             </div>
          </div>
          <div className="xl:col-span-2 space-y-4">
             {questions.length === 0 ? <p className="text-center py-40 text-slate-300 font-black uppercase tracking-widest text-xs">Question bank is empty.</p> : questions.map(q => (
               <div key={q.id} className="bg-white p-6 rounded-3xl border border-gray-100 hover:shadow-lg transition-all relative group">
                  <button onClick={() => deleteQuestion(q.id)} className="absolute top-6 right-6 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  </button>
                  <div className="flex gap-2 mb-3">
                    <span className="text-[9px] font-black bg-slate-100 px-3 py-1 rounded-full uppercase tracking-widest">{q.subject}</span>
                    <span className="text-[9px] font-black bg-amber-50 text-amber-600 px-3 py-1 rounded-full uppercase tracking-widest">{q.topic}</span>
                  </div>
                  <div className="text-sm font-bold text-slate-800 mb-6 leading-relaxed">
                    <ScientificText text={q.text} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {q.options.map((opt, i) => (
                      <div key={i} className={`p-3 rounded-xl border-2 text-[10px] ${i === q.correctAnswerIndex ? 'bg-amber-50 border-amber-500 font-black text-amber-800' : 'bg-slate-50 border-slate-50 text-slate-400 font-bold'}`}>
                        {String.fromCharCode(65+i)}. <ScientificText text={opt} />
                      </div>
                    ))}
                  </div>
               </div>
             ))}
          </div>
        </div>
      ) : !loading && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
          <div className="xl:col-span-1">
             <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 sticky top-8">
               <h3 className="text-lg font-black text-slate-950 mb-6 uppercase tracking-tight">New Practice Exam</h3>
               <div className="space-y-4">
                  <input placeholder="Test Title" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold" value={tName} onChange={e => setTName(e.target.value)} />
                  <textarea placeholder="Instructions" className="w-full p-4 bg-slate-50 border border-gray-100 rounded-2xl text-xs font-bold" value={tDesc} onChange={e => setTDesc(e.target.value)} />
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Duration (MINS)</span>
                    <input type="number" className="w-20 p-2 bg-white border border-gray-100 rounded-xl text-xs text-center font-black" value={tDuration} onChange={e => setTDuration(parseInt(e.target.value))} />
                  </div>
                  <label className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl cursor-pointer">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Allow Retakes</span>
                    <input type="checkbox" checked={tRetake} onChange={e => setTRetake(e.target.checked)} className="w-5 h-5 rounded border-gray-300 text-amber-500 focus:ring-amber-500" />
                  </label>

                  <div className="p-6 bg-slate-950 rounded-3xl border border-amber-500/20 mt-6">
                    <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-4 text-center">Add Section</p>
                    <input placeholder="Subject Search..." className="w-full p-3 text-xs bg-slate-900 text-white rounded-xl mb-3 outline-none border border-slate-800 focus:border-amber-500 font-bold" value={newSecName} onChange={e => setNewSecName(e.target.value)} />
                    
                    {availableQuestionsForSubject.length > 0 && (
                      <div className="max-h-60 overflow-y-auto mb-4 p-2 bg-slate-900 rounded-xl border border-slate-800 space-y-2 no-scrollbar">
                         {availableQuestionsForSubject.map(q => (
                           <div key={q.id} onClick={() => toggleQuestionSelection(q.id)} className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedQuestionIds.includes(q.id) ? 'border-amber-500 bg-amber-500/10' : 'border-slate-800 bg-slate-800/30'}`}>
                              <p className="text-[10px] text-white font-bold line-clamp-2"><ScientificText text={q.text} /></p>
                              <span className="text-[8px] text-slate-500 uppercase font-black">{q.topic}</span>
                           </div>
                         ))}
                      </div>
                    )}

                    <div className="flex gap-4 items-center mb-6">
                       <span className="text-[9px] text-amber-500/50 font-black uppercase">Marks per Q:</span>
                       <input type="number" className="w-16 p-2 bg-slate-900 text-amber-500 text-center text-xs font-bold rounded-lg border border-slate-800" value={newSecPoints} onChange={e => setNewSecPoints(parseInt(e.target.value))} />
                    </div>

                    <button onClick={addSectionToTest} className="w-full py-4 bg-amber-500 text-slate-950 rounded-2xl text-[10px] font-black uppercase hover:bg-amber-400 shadow-xl transition-all">Add Section ({selectedQuestionIds.length} Q Selected)</button>
                  </div>

                  {tSections.length > 0 && (
                    <div className="space-y-2 pt-4">
                       {tSections.map((s, i) => (
                         <div key={i} className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100 text-[10px] font-bold">
                            <span className="font-black uppercase text-slate-900">{s.name}</span>
                            <span className="text-slate-400">{s.questionIds.length} Questions</span>
                         </div>
                       ))}
                    </div>
                  )}

                  <button onClick={handleCreateTest} className="w-full py-5 bg-slate-950 text-amber-500 rounded-[1.5rem] font-black uppercase text-xs tracking-[0.3em] mt-10 shadow-2xl hover:bg-slate-800 transition-all">Publish Exam</button>
               </div>
             </div>
          </div>

          <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
             {tests.length === 0 ? <p className="col-span-full py-40 text-center text-slate-300 font-black uppercase tracking-widest text-xs">No active exams published.</p> : tests.map(test => (
                <div key={test.id} className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm relative group hover:shadow-xl transition-all">
                   <button onClick={() => deleteTest(test.id!)} className="absolute top-8 right-8 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                   </button>
                   <h4 className="text-lg font-black text-slate-950 mb-3 uppercase tracking-tight">{test.name}</h4>
                   <div className="flex gap-4 text-[9px] font-black text-amber-600 uppercase tracking-widest mb-8">
                      <span className="bg-amber-50 px-3 py-1 rounded-full">{test.totalDurationSeconds/60} Mins</span>
                      <span className="bg-amber-50 px-3 py-1 rounded-full">{test.sections.length} Sections</span>
                      {test.allowRetake ? <span className="bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full">Retakes Allowed</span> : <span className="bg-rose-50 text-rose-600 px-3 py-1 rounded-full">Single Attempt</span>}
                   </div>
                   <div className="flex flex-wrap gap-2">
                      {test.sections.map(s => <span key={s.id} className="text-[8px] font-black bg-slate-50 border border-slate-100 px-3 py-1 rounded-lg text-slate-400 uppercase tracking-widest">{s.name} ({s.questionIds.length}Q)</span>)}
                   </div>
                </div>
             ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
