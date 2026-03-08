
import React, { useState, useEffect } from 'react';
import { ExamResult, MockTest, Question } from '../types';
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc, query, where, documentId, addDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import ScientificText from './ScientificText';
import logo from '../assets/logo.png';
import { getOrCreateAiExplanation } from './aiExplanationService';

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
  const [showMoreInfo, setShowMoreInfo] = useState(false);
  const [aiExplanation, setAiExplanation] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSource, setAiSource] = useState<'cache' | 'generated' | 'fallback' | ''>('');
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
  const [tagNote, setTagNote] = useState('');
  const [isSubmittingTag, setIsSubmittingTag] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const snapshotMap = result.questionSnapshot || {};
        if (result.testId.startsWith('quiz:')) {
          const quizId = result.testId.replace(/^quiz:/, '');
          const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
          if (quizDoc.exists()) {
            const quizData = quizDoc.data() as any;
            const ids = (quizData.questions || []).map((_: any, idx: number) => `quizq_${idx}`);
            setTest({
              id: result.testId,
              name: quizData.name || result.testName,
              description: quizData.description || '',
              sections: [{
                id: 'quiz_sec_1',
                name: 'Quiz',
                questionIds: ids,
                marksPerQuestion: 1
              }],
              totalDurationSeconds: Number(quizData.totalDurationSeconds || 0),
              allowRetake: Boolean(quizData.allowRetake),
              maxAttempts: quizData.maxAttempts ?? null,
              createdBy: quizData.createdBy || '',
              creatorName: quizData.creatorName || '',
              isApproved: true,
              createdAt: quizData.createdAt || new Date().toISOString(),
              generationMode: 'fixed'
            });

            const qMap: Record<string, Question> = {};
            (quizData.questions || []).forEach((q: any, idx: number) => {
              qMap[`quizq_${idx}`] = {
                id: `quizq_${idx}`,
                subject: 'Quiz',
                topic: 'General',
                text: q.text,
                options: q.options || [],
                correctAnswerIndex: Number(q.correctAnswerIndex || 0),
                explanation: q.explanation || '',
                createdBy: quizData.createdBy || '',
                createdAt: quizData.createdAt || new Date().toISOString()
              } as Question;
            });
            setQuestions({ ...qMap, ...snapshotMap });
            return;
          }
        }

        const testDoc = await getDoc(doc(db, 'tests', result.testId));
        if (testDoc.exists()) {
          const testData = { ...testDoc.data(), id: testDoc.id } as MockTest;
          setTest(testData);
          const sectionsToUse = result.resolvedSections && result.resolvedSections.length > 0
            ? result.resolvedSections
            : testData.sections;
          const ids = Array.from(new Set(sectionsToUse.flatMap(section => section.questionIds)));
          const qMap: Record<string, Question> = {};
          for (let i = 0; i < ids.length; i += 10) {
            const chunk = ids.slice(i, i + 10);
            const qSnap = await getDocs(query(collection(db, 'questions'), where(documentId(), 'in', chunk)));
            qSnap.docs.forEach(d => { qMap[d.id] = { ...d.data(), id: d.id } as Question; });
          }
          setQuestions({ ...qMap, ...snapshotMap });
          return;
        }

        if (result.resolvedSections && result.questionSnapshot) {
          setTest({
            id: result.testId,
            name: result.testName,
            description: '',
            sections: result.resolvedSections,
            totalDurationSeconds: 0,
            allowRetake: true,
            maxAttempts: null,
            createdBy: '',
            creatorName: '',
            isApproved: true,
            createdAt: result.completedAt,
            generationMode: 'fixed'
          });
          setQuestions(result.questionSnapshot);
        }
      } catch (err) {
        console.error("Error fetching review data:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [result.testId, result.resolvedSections, result.questionSnapshot]);

  const activeSection = test?.sections[activeSectionIndex];
  const currentQuestionId = activeSection?.questionIds[currentQuestionIndex];
  const currentQuestion = questions[currentQuestionId!];
  const isQuestionMissing = Boolean(currentQuestionId) && !currentQuestion;
  const userAnswer = result.userAnswers[currentQuestionId!];
  const isCorrect = userAnswer === currentQuestion?.correctAnswerIndex;

  useEffect(() => {
    setAiExplanation('');
    setAiError('');
    setAiSource('');
  }, [currentQuestionId]);

  useEffect(() => {
    if (!showMoreInfo || !currentQuestion) return;
    let cancelled = false;
    const run = async () => {
      try {
        setAiLoading(true);
        setAiError('');
        const result = await getOrCreateAiExplanation(currentQuestion);
        if (!cancelled) {
          setAiExplanation(result.text);
          setAiSource(result.source);
        }
      } catch (err: any) {
        if (!cancelled) setAiError(err?.message || 'Could not load AI explanation.');
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [showMoreInfo, currentQuestionId]);

  const submitQuestionTag = async (includeNote: boolean) => {
    if (!currentQuestion || !currentQuestionId || isSubmittingTag) return;
    setIsSubmittingTag(true);
    try {
      const noteValue = includeNote ? tagNote.trim() : '';
      await addDoc(collection(db, 'questionTagInsights'), {
        questionId: currentQuestionId,
        testId: result.testId,
        testName: result.testName,
        resultId: result.id,
        userId: result.userId,
        userName: result.userName,
        note: noteValue,
        createdAt: new Date().toISOString(),
        status: 'new'
      });
      alert(noteValue ? 'Tag submitted with note.' : 'Tag submitted.');
      setIsTagDialogOpen(false);
      setTagNote('');
    } catch (err: any) {
      alert(`Could not submit tag. ${err?.message || ''}`.trim());
    } finally {
      setIsSubmittingTag(false);
    }
  };

  if (loading) {
    return (
      <div className="v2-page h-full w-full flex flex-col items-center justify-center bg-slate-950 safe-top safe-bottom">
        <img src={logo} className="w-16 h-16 animate-spin mb-6" alt="Aureus Medicos CBT Logo" />
        <p className="text-[11px] font-black uppercase tracking-[0.4em] text-amber-500">Loading Review...</p>
      </div>
    );
  }

  if (!test) {
    return (
      <div className="v2-page h-full w-full flex flex-col items-center justify-center bg-slate-50 p-6 text-center safe-top safe-bottom">
        <img src={logo} className="w-16 h-16 mb-6" alt="Aureus Medicos CBT Logo" />
        <h2 className="text-xl font-bold text-slate-900 mb-2 uppercase">Review Unavailable</h2>
        <p className="text-slate-500 text-sm mb-6">We could not load this test.</p>
        <button onClick={onExit} className="px-8 py-3 bg-slate-950 text-amber-500 rounded-xl font-bold uppercase tracking-widest text-[10px]">Back</button>
      </div>
    );
  }

  return (
    <div className="v2-page flex flex-col h-full bg-slate-50 select-none overflow-hidden min-h-0 safe-top">
      <header className="v2-shell bg-slate-950 text-white px-6 py-5 flex justify-between items-center border-b-4 border-amber-500 z-30 shrink-0">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-10 h-10" alt="Aureus Medicos CBT Logo" />
          <div>
            <h1 className="text-[11px] font-black uppercase tracking-[0.4em] text-amber-500 leading-none">Review Mode</h1>
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

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative min-h-0">
        <aside className="flex flex-col w-full md:w-80 bg-white border-b md:border-b-0 md:border-r border-slate-100 shrink-0 max-h-[180px] md:max-h-none">
           <div className="p-6 border-b border-slate-50 bg-slate-50/50">
              <h3 className="text-[10px] font-black text-slate-950 uppercase tracking-[0.3em]">Question List</h3>
           </div>
           <div className="flex-1 v2-scroll p-3 md:p-6">
             <div className="flex md:block gap-4 md:gap-8">
              {test.sections.map((section, sIdx) => (
                <div key={sIdx} className="shrink-0">
                  <p className="text-[9px] font-black text-amber-600 uppercase mb-3 tracking-widest">{section.name}</p>
                  <div className="grid grid-flow-col auto-cols-[40px] md:grid-flow-row md:grid-cols-5 md:auto-cols-auto gap-2">
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
           </div>
        </aside>

        <main className="flex-1 flex flex-col p-4 md:p-10 overflow-hidden min-h-0">
          <div className="flex-1 bg-white rounded-[2.5rem] md:rounded-[4rem] shadow-sm border border-slate-100 v2-scroll p-10 md:p-20">
            <div className="mb-12 border-b border-slate-50 pb-6 flex justify-between items-center">
               <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">
                  {activeSection?.name} - Item {currentQuestionIndex + 1}
               </span>
               <div className="flex gap-3 overflow-x-auto no-scrollbar whitespace-nowrap">
                 <button
                   type="button"
                   onClick={() => setIsTagDialogOpen(true)}
                   className="text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest border text-amber-700 bg-amber-50 border-amber-200"
                 >
                   Add Tag
                 </button>
                 <button
                   type="button"
                   onClick={() => setShowMoreInfo(prev => !prev)}
                   className={`text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest border ${showMoreInfo ? 'text-sky-700 bg-sky-50 border-sky-200' : 'text-slate-500 bg-white border-slate-200'}`}
                 >
                   {showMoreInfo ? 'Hide More Info' : 'Show More Info'}
                 </button>
                 {userAnswer === undefined ? (
                   <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-4 py-1.5 rounded-full uppercase tracking-widest">Unattempted</span>
                 ) : isCorrect ? (
                   <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-4 py-1.5 rounded-full uppercase tracking-widest border border-emerald-100">Correct Response</span>
                 ) : (
                   <span className="text-[10px] font-black text-rose-700 bg-rose-50 px-4 py-1.5 rounded-full uppercase tracking-widest border border-rose-100">Incorrect Response</span>
                 )}
               </div>
            </div>

            <div className="text-[15px] md:text-3xl font-bold text-slate-900 mb-16 leading-tight tracking-tight">
              <ScientificText text={currentQuestion?.text || "Question unavailable for this attempt."} />
            </div>

            {isQuestionMissing && (
              <div className="mb-8 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-xs font-bold text-red-700">
                We could not load this question from the database. New attempts now save question snapshots, so future reviews will open correctly.
              </div>
            )}

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
                <h4 className="text-[11px] font-black text-amber-500 uppercase tracking-[0.4em] mb-6">Explanation</h4>
                <div className="text-base text-slate-300 leading-relaxed relative z-10 italic">
                  <ScientificText text={currentQuestion.explanation!} />
                </div>
                <div className="absolute top-0 right-0 p-8 opacity-5">
                   <img src={logo} className="w-40 h-40" alt="" />
                </div>
              </div>
            )}
            {showMoreInfo && (
              <div className="mt-10 p-8 bg-sky-50 rounded-[2rem] border border-sky-100 text-slate-800">
                <h4 className="text-[11px] font-black text-sky-700 uppercase tracking-[0.3em] mb-4">AI More Info</h4>
                {aiLoading && <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700">Loading explanation...</p>}
                {!aiLoading && aiError && <p className="text-[10px] font-bold uppercase tracking-widest text-red-600">{aiError}</p>}
                {!aiLoading && !aiError && aiSource === 'fallback' && (
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-amber-700 bg-amber-100 border border-amber-200 rounded-lg px-3 py-2">
                    AI quota is unavailable. Showing stored local explanation.
                  </p>
                )}
                {!aiLoading && !aiError && aiExplanation && (
                  <div className="text-sm leading-relaxed">
                    <ScientificText text={aiExplanation} />
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      <footer className="v2-shell bg-white border-t border-slate-100 p-6 md:p-10 px-10 md:px-20 flex justify-between items-center z-20 shrink-0 safe-bottom">
        <div className="hidden sm:block text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">
           Aureus Medicos CBT Review
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
      {isTagDialogOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm safe-top safe-bottom">
          <div className="w-full max-w-lg bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-slate-100">
            <div className="bg-slate-950 px-6 py-5 text-white flex justify-between items-center">
              <h3 className="text-sm font-bold uppercase tracking-widest">Tag This Question</h3>
              <button onClick={() => { if (!isSubmittingTag) setIsTagDialogOpen(false); }} className="text-slate-300 hover:text-white">Close</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-600">
                Flag this question for admin review. You can add only a tag, or include a note with your insight.
              </p>
              <textarea
                rows={4}
                value={tagNote}
                onChange={(e) => setTagNote(e.target.value)}
                placeholder="Optional note: What should admins check in this question?"
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  onClick={() => submitQuestionTag(false)}
                  disabled={isSubmittingTag}
                  className="py-3 bg-white border border-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                >
                  {isSubmittingTag ? 'Submitting...' : 'Add Tag Only'}
                </button>
                <button
                  onClick={() => submitQuestionTag(true)}
                  disabled={isSubmittingTag || !tagNote.trim()}
                  className="py-3 bg-slate-950 text-amber-500 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                >
                  {isSubmittingTag ? 'Submitting...' : 'Add Tag + Note'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewInterface;
