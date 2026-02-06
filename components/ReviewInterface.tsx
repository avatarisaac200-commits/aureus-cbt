
import React, { useState, useEffect } from 'react';
import { ExamResult, MockTest, Question } from '../types';
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import ScientificText from './ScientificText';
import logo from '../assets/logo.png';

interface ReviewInterfaceProps {
  result: ExamResult;
  onExit: () => void;
}

const ReviewInterface: React.FC<ReviewInterfaceProps> = ({ result, onExit }) => {
  const [test, setTest] = useState<MockTest | null>(null);
  const [questions, setQuestions] = useState<Record<string, Question>>({});
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const testDoc = await getDoc(doc(db, 'tests', result.testId));
        if (testDoc.exists()) {
          setTest({ ...testDoc.data(), id: testDoc.id } as MockTest);
        }

        const qSnap = await getDocs(collection(db, 'questions'));
        const qMap: Record<string, Question> = {};
        qSnap.docs.forEach(d => { qMap[d.id] = { ...d.data(), id: d.id } as Question; });
        setQuestions(qMap);
      } catch (err) {
        console.error("Error fetching review data:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [result.testId]);

  const activeSection = test?.sections[activeSectionIndex];
  const currentQuestionId = activeSection?.questionIds[currentQuestionIndex];
  const currentQuestion = questions[currentQuestionId!];
  const userAnswer = result.userAnswers[currentQuestionId!];
  const isCorrect = userAnswer === currentQuestion?.correctAnswerIndex;

  if (loading || !test) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mb-4"></div>
        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Authenticating...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 select-none overflow-hidden">
      <header className="bg-slate-950 text-white px-6 py-4 flex justify-between items-center border-b-4 border-amber-500 z-30 shrink-0 safe-top">
        <div className="flex items-center gap-3">
          <img src={logo} className="w-8 h-8" alt="Logo" />
          <div>
            <h1 className="text-[10px] font-black uppercase tracking-widest text-amber-500">Aureus Medicos Review</h1>
            <p className="text-[8px] text-slate-400 font-bold uppercase truncate max-w-[150px]">{test.name}</p>
          </div>
        </div>
        <button 
          onClick={onExit}
          className="px-4 py-2 bg-slate-900 border border-slate-800 text-amber-500 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all"
        >
          Exit
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        <aside className="hidden md:flex md:flex-col w-72 bg-white border-r border-gray-200 shrink-0">
           <div className="p-4 border-b border-gray-100 bg-slate-50">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Question Map</h3>
           </div>
           <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
              {test.sections.map((section, sIdx) => (
                <div key={sIdx}>
                  <p className="text-[8px] font-black text-slate-300 uppercase mb-2">{section.name}</p>
                  <div className="grid grid-cols-5 gap-1">
                    {section.questionIds.map((id, qIdx) => {
                      const qUserAns = result.userAnswers[id];
                      const qCorrectAns = questions[id]?.correctAnswerIndex;
                      const qIsCorrect = qUserAns === qCorrectAns;
                      const isActive = activeSectionIndex === sIdx && currentQuestionIndex === qIdx;
                      
                      return (
                        <button
                          key={id}
                          onClick={() => { setActiveSectionIndex(sIdx); setCurrentQuestionIndex(qIdx); }}
                          className={`h-8 rounded-lg text-[9px] font-black border transition-all ${
                            isActive 
                              ? 'border-amber-500 ring-2 ring-amber-500/20' 
                              : ''
                          } ${
                            qUserAns === undefined
                              ? 'bg-slate-50 text-slate-300'
                              : qIsCorrect 
                                ? 'bg-emerald-500 text-white border-emerald-500' 
                                : 'bg-rose-500 text-white border-rose-500'
                          }`}
                        >
                          {qIdx + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
           </div>
           <div className="p-4 border-t border-gray-50 bg-slate-50 text-center">
              <p className="text-[7px] font-black text-slate-300 uppercase tracking-widest italic">Aureus Medicos CBT Practice App</p>
           </div>
        </aside>

        <main className="flex-1 flex flex-col p-4 md:p-8 overflow-hidden">
          <div className="flex-1 bg-white rounded-[2rem] md:rounded-[3rem] shadow-sm border border-gray-200 overflow-y-auto p-8 md:p-14 no-scrollbar">
            <div className="mb-8 border-b border-gray-100 pb-4 flex justify-between items-center">
               <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {activeSection?.name} • Question {currentQuestionIndex + 1}
               </span>
               <div className="flex gap-2">
                 {userAnswer === undefined ? (
                   <span className="text-[8px] font-black text-slate-400 bg-slate-100 px-3 py-1 rounded-full uppercase">Unanswered</span>
                 ) : isCorrect ? (
                   <span className="text-[8px] font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full uppercase border border-emerald-100">Correct</span>
                 ) : (
                   <span className="text-[8px] font-black text-rose-600 bg-rose-50 px-3 py-1 rounded-full uppercase border border-rose-100">Incorrect</span>
                 )}
               </div>
            </div>

            <div className="text-lg md:text-2xl font-bold text-slate-900 mb-12 leading-relaxed">
              <ScientificText text={currentQuestion?.text || "Syncing..."} />
            </div>

            <div className="space-y-4">
              {currentQuestion?.options.map((option, idx) => {
                const isSelected = userAnswer === idx;
                const isCorrectOption = currentQuestion.correctAnswerIndex === idx;
                
                let cardStyle = "border-gray-50 bg-white text-slate-600";
                let badgeStyle = "bg-slate-100 text-slate-400";

                if (isCorrectOption) {
                  cardStyle = "border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/10";
                  badgeStyle = "bg-emerald-500 text-white";
                } else if (isSelected && !isCorrect) {
                  cardStyle = "border-rose-500 bg-rose-50 text-rose-900 ring-2 ring-rose-500/10";
                  badgeStyle = "bg-rose-500 text-white";
                }

                return (
                  <div key={idx} className={`w-full text-left p-6 rounded-2xl border-2 transition-all flex items-center ${cardStyle}`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mr-6 font-black text-sm flex-shrink-0 ${badgeStyle}`}>
                      {String.fromCharCode(65 + idx)}
                    </div>
                    <div className="flex-1">
                      <ScientificText text={option} className="text-base font-semibold" />
                      {isCorrectOption && <p className="text-[8px] font-black uppercase tracking-widest text-emerald-600 mt-1">Keyed Answer</p>}
                      {isSelected && !isCorrect && <p className="text-[8px] font-black uppercase tracking-widest text-rose-600 mt-1">Your Selection</p>}
                    </div>
                  </div>
                );
              })}
            </div>
            
            {currentQuestion?.explanation && (
              <div className="mt-12 p-8 bg-slate-900 rounded-3xl border border-slate-800 text-white shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                   <img src={logo} className="w-20 h-20 grayscale brightness-200" alt="" />
                </div>
                <h4 className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-4">Aureus Medicos Rationale</h4>
                <div className="text-sm text-slate-300 leading-relaxed relative z-10">
                  <ScientificText text={currentQuestion.explanation!} />
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      <footer className="bg-white border-t border-gray-200 p-6 md:p-8 px-8 md:px-12 flex justify-between items-center z-20 shrink-0 safe-bottom">
         <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest hidden sm:block">
           Aureus Medicos CBT Practice App
         </div>
         
         <div className="flex gap-2 w-full sm:w-auto">
           <button 
             onClick={() => {
                if (currentQuestionIndex > 0) {
                  setCurrentQuestionIndex(currentQuestionIndex - 1);
                } else if (activeSectionIndex > 0) {
                  const prevSection = test.sections[activeSectionIndex - 1];
                  setActiveSectionIndex(activeSectionIndex - 1);
                  setCurrentQuestionIndex(prevSection.questionIds.length - 1);
                }
             }}
             className="flex-1 sm:flex-none px-6 py-3 border border-slate-200 rounded-xl text-[10px] font-black uppercase hover:bg-slate-50 transition-all"
           >
             Back
           </button>
           <button 
             onClick={() => {
                if (currentQuestionIndex < activeSection!.questionIds.length - 1) {
                  setCurrentQuestionIndex(currentQuestionIndex + 1);
                } else if (activeSectionIndex < test.sections.length - 1) {
                  setActiveSectionIndex(activeSectionIndex + 1);
                  setCurrentQuestionIndex(0);
                }
             }}
             className="flex-1 sm:flex-none px-6 py-3 bg-slate-950 text-amber-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all"
           >
             Next
           </button>
         </div>
      </footer>
    </div>
  );
};

export default ReviewInterface;
