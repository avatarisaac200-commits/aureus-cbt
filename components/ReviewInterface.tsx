
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
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-950 safe-top safe-bottom">
        <img src={logo} className="w-16 h-16 animate-spin mb-6" alt="Aureus Logo" />
        <p className="text-[11px] font-black uppercase tracking-[0.4em] text-amber-500">Recalibrating Transcript...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 select-none overflow-hidden safe-top">
      <header className="bg-slate-950 text-white px-6 py-5 flex justify-between items-center border-b-4 border-amber-500 z-30 shrink-0">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-10 h-10" alt="Aureus Logo" />
          <div>
            <h1 className="text-[11px] font-black uppercase tracking-[0.4em] text-amber-500 leading-none">Aureus Review</h1>
            <p className="text-[9px] text-slate-400 font-bold uppercase truncate max-w-[200px] mt-1">{test.name}</p>
          </div>
        </div>
        <button 
          onClick={onExit}
          className="px-6 py-2.5 bg-slate-900 border border-slate-800 text-amber-500 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-slate-800 transition-all shadow-lg"
        >
          Exit Review
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        <aside className="hidden md:flex md:flex-col w-80 bg-white border-r border-slate-100 shrink-0">
           <div className="p-6 border-b border-slate-50 bg-slate-50/50">
              <h3 className="text-[10px] font-black text-slate-950 uppercase tracking-[0.3em]">Transcript Matrix</h3>
           </div>
           <div className="flex-1 overflow-y-auto p-6 space-y-8 no-scrollbar">
              {test.sections.map((section, sIdx) => (
                <div key={sIdx}>
                  <p className="text-[9px] font-black text-amber-600 uppercase mb-3 tracking-widest">{section.name}</p>
                  <div className="grid grid-cols-5 gap-2">
                    {section.questionIds.map((id, qIdx) => {
                      const qUserAns = result.userAnswers[id];
                      const qCorrectAns = questions[id]?.correctAnswerIndex;
                      const qIsCorrect = qUserAns === qCorrectAns;
                      const isActive = activeSectionIndex === sIdx && currentQuestionIndex === qIdx;
                      
                      return (
                        <button
                          key={id}
                          onClick={() => { setActiveSectionIndex(sIdx); setCurrentQuestionIndex(qIdx); }}
                          className={`h-10 rounded-xl text-[10px] font-black border transition-all ${
                            isActive 
                              ? 'border-slate-950 ring-4 ring-slate-950/10' 
                              : ''
                          } ${
                            qUserAns === undefined
                              ? 'bg-slate-50 text-slate-300'
                              : qIsCorrect 
                                ? 'bg-emerald-500 text-white border-emerald-500 shadow-md' 
                                : 'bg-rose-500 text-white border-rose-500 shadow-md'
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
        </aside>

        <main className="flex-1 flex flex-col p-4 md:p-10 overflow-hidden">
          <div className="flex-1 bg-white rounded-[2.5rem] md:rounded-[4rem] shadow-sm border border-slate-100 overflow-y-auto p-10 md:p-20 no-scrollbar">
            <div className="mb-12 border-b border-slate-50 pb-6 flex justify-between items-center">
               <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">
                  {activeSection?.name} • Item {currentQuestionIndex + 1}
               </span>
               <div className="flex gap-3">
                 {userAnswer === undefined ? (
                   <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-4 py-1.5 rounded-full uppercase tracking-widest">Unattempted</span>
                 ) : isCorrect ? (
                   <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-4 py-1.5 rounded-full uppercase tracking-widest border border-emerald-100">Correct Response</span>
                 ) : (
                   <span className="text-[10px] font-black text-rose-700 bg-rose-50 px-4 py-1.5 rounded-full uppercase tracking-widest border border-rose-100">Incorrect Response</span>
                 )}
               </div>
            </div>

            <div className="text-xl md:text-3xl font-bold text-slate-900 mb-16 leading-tight tracking-tight">
              <ScientificText text={currentQuestion?.text || "Recalibrating clinical dataset..."} />
            </div>

            <div className="space-y-5">
              {currentQuestion?.options.map((option, idx) => {
                const isSelected = userAnswer === idx;
                const isCorrectOption = currentQuestion.correctAnswerIndex === idx;
                
                let cardStyle = "border-slate-50 bg-white text-slate-600";
                let badgeStyle = "bg-slate-100 text-slate-400";

                if (isCorrectOption) {
                  cardStyle = "border-emerald-500 bg-emerald-50 text-emerald-950 ring-4 ring-emerald-500/10";
                  badgeStyle = "bg-emerald-500 text-white";
                } else if (isSelected && !isCorrect) {
                  cardStyle = "border-rose-500 bg-rose-50 text-rose-950 ring-4 ring-rose-500/10";
                  badgeStyle = "bg-rose-500 text-white";
                }

                return (
                  <div key={idx} className={`w-full text-left p-6 md:p-8 rounded-[2rem] border-2 transition-all flex items-center ${cardStyle}`}>
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mr-8 font-black text-lg flex-shrink-0 shadow-sm ${badgeStyle}`}>
                      {String.fromCharCode(65 + idx)}
                    </div>
                    <div className="flex-1">
                      <ScientificText text={option} className="text-lg md:text-xl font-bold" />
                    </div>
                  </div>
                );
              })}
            </div>
            
            {currentQuestion?.explanation && (
              <div className="mt-16 p-10 bg-slate-950 rounded-[2.5rem] border-t-8 border-amber-500 text-white shadow-2xl relative overflow-hidden">
                <h4 className="text-[11px] font-black text-amber-500 uppercase tracking-[0.4em] mb-6">Expert Rationale</h4>
                <div className="text-base text-slate-300 leading-relaxed relative z-10 italic">
                  <ScientificText text={currentQuestion.explanation!} />
                </div>
                <div className="absolute top-0 right-0 p-8 opacity-5">
                   <img src={logo} className="w-40 h-40" alt="" />
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      <footer className="bg-white border-t border-slate-100 p-6 md:p-10 px-10 md:px-20 flex justify-between items-center z-20 shrink-0 safe-bottom">
         <div className="hidden sm:block text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">
           Aureus Medicos Clinical Dataset
         </div>
         
         <div className="flex gap-4 w-full sm:w-auto">
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
             className="flex-1 sm:flex-none px-8 py-4 border-2 border-slate-100 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all"
           >
             Prev Item
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
             className="flex-1 sm:flex-none px-8 py-4 bg-slate-950 text-amber-500 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl transition-all"
           >
             Next Item
           </button>
         </div>
      </footer>
    </div>
  );
};

export default ReviewInterface;
