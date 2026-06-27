
import React, { useState, useEffect } from 'react';
import { ExamResult, MockTest, Question, TestAttempt, TestSection } from '../types';
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc, query, where, documentId, addDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import ScientificText from './ScientificText';
import logo from '../assets/scholar-main.png';
import { getOrCreateAiExplanation } from './aiExplanationService';
import { toast } from './ui/Toast';

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
        const tryBackfillResultArtifacts = async (patch: Record<string, any>) => {
          if (!result.id || Object.keys(patch).length === 0) return;
          try {
            await updateDoc(doc(db, 'results', result.id), patch);
          } catch {
            // Ignore backfill failures (e.g., permission-denied for students).
          }
        };
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

        let sectionsFromAttempt: TestSection[] | null = null;
        if (result.attemptSections && result.attemptSections.length > 0) {
          sectionsFromAttempt = result.attemptSections;
        } else if (result.attemptId) {
          const attemptDoc = await getDoc(doc(db, 'testAttempts', result.attemptId));
          if (attemptDoc.exists()) {
            const attemptData = attemptDoc.data() as TestAttempt;
            if (Array.isArray(attemptData.sections) && attemptData.sections.length > 0) {
              // Review should focus on attempted items only.
              const answered = new Set(Object.keys(result.userAnswers || {}));
              const attemptedOnly = attemptData.sections
                .map((section) => ({ ...section, questionIds: section.questionIds.filter((id) => answered.has(id)) }))
                .filter((section) => section.questionIds.length > 0);
              sectionsFromAttempt = attemptedOnly.length > 0 ? attemptedOnly : attemptData.sections;
            }
          }
        }
        if ((!sectionsFromAttempt || sectionsFromAttempt.length === 0) && result.attemptQuestionIds && result.attemptQuestionIds.length > 0) {
          sectionsFromAttempt = [{
            id: 'attempted_only',
            name: 'Attempted Questions',
            questionIds: result.attemptQuestionIds,
            marksPerQuestion: 1
          }];
        }

        const testDoc = await getDoc(doc(db, 'tests', result.testId));
        if (testDoc.exists()) {
          const testData = { ...testDoc.data(), id: testDoc.id } as MockTest;
          const sectionsToUse = sectionsFromAttempt
            || (result.resolvedSections && result.resolvedSections.length > 0 ? result.resolvedSections : null)
            || testData.sections;
          setTest({ ...testData, sections: sectionsToUse });
          const ids = Array.from(new Set(sectionsToUse.flatMap(section => section.questionIds)));
          const qMap: Record<string, Question> = {};
          for (let i = 0; i < ids.length; i += 10) {
            const chunk = ids.slice(i, i + 10);
            const qSnap = await getDocs(query(collection(db, 'questions'), where(documentId(), 'in', chunk)));
            qSnap.docs.forEach(d => { qMap[d.id] = { ...d.data(), id: d.id } as Question; });
          }
          const mergedSnapshot = { ...qMap, ...snapshotMap };
          setQuestions(mergedSnapshot);
          const backfillPatch: Record<string, any> = {};
          if ((!result.attemptSections || result.attemptSections.length === 0) && sectionsFromAttempt && sectionsFromAttempt.length > 0) {
            backfillPatch.attemptSections = sectionsFromAttempt;
          }
          if ((!result.attemptQuestionIds || result.attemptQuestionIds.length === 0) && sectionsToUse.length > 0) {
            backfillPatch.attemptQuestionIds = Array.from(new Set(sectionsToUse.flatMap(section => section.questionIds)));
          }
          if ((!result.questionSnapshot || Object.keys(result.questionSnapshot).length === 0) && Object.keys(mergedSnapshot).length > 0) {
            backfillPatch.questionSnapshot = mergedSnapshot;
          }
          await tryBackfillResultArtifacts(backfillPatch);
          return;
        }

        if ((sectionsFromAttempt && sectionsFromAttempt.length > 0) || (result.resolvedSections && result.resolvedSections.length > 0) || result.questionSnapshot) {
          const fallbackSections = (sectionsFromAttempt && sectionsFromAttempt.length > 0)
            ? sectionsFromAttempt
            : (result.resolvedSections && result.resolvedSections.length > 0)
              ? result.resolvedSections
              : [{
                id: 'answered_only',
                name: 'Answered Questions',
                questionIds: Object.keys(result.userAnswers || {}),
                marksPerQuestion: 1
              }];
          setTest({
            id: result.testId,
            name: result.testName,
            description: '',
            sections: fallbackSections,
            totalDurationSeconds: 0,
            allowRetake: true,
            maxAttempts: null,
            createdBy: '',
            creatorName: '',
            isApproved: true,
            createdAt: result.completedAt,
            generationMode: 'fixed'
          });
          const fallbackSnapshot = result.questionSnapshot || {};
          setQuestions(fallbackSnapshot);
          const fallbackBackfillPatch: Record<string, any> = {};
          if ((!result.attemptSections || result.attemptSections.length === 0) && sectionsFromAttempt && sectionsFromAttempt.length > 0) {
            fallbackBackfillPatch.attemptSections = sectionsFromAttempt;
          }
          if ((!result.attemptQuestionIds || result.attemptQuestionIds.length === 0) && fallbackSections.length > 0) {
            fallbackBackfillPatch.attemptQuestionIds = Array.from(new Set(fallbackSections.flatMap(section => section.questionIds)));
          }
          if ((!result.questionSnapshot || Object.keys(result.questionSnapshot).length === 0) && Object.keys(fallbackSnapshot).length > 0) {
            fallbackBackfillPatch.questionSnapshot = fallbackSnapshot;
          }
          await tryBackfillResultArtifacts(fallbackBackfillPatch);
        }
      } catch (err) {
        console.error("Error fetching review data:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [result.testId, result.resolvedSections, result.questionSnapshot]);

  const reviewedSections = (test?.sections || [])
    .map((section) => ({
      ...section,
      questionIds: section.questionIds.filter((id) => Object.prototype.hasOwnProperty.call(result.userAnswers, id))
    }))
    .filter((section) => section.questionIds.length > 0);

  const activeReviewedSection = reviewedSections[activeSectionIndex];
  const activeReviewedQuestionId = activeReviewedSection?.questionIds[currentQuestionIndex];
  const activeReviewedQuestion = questions[activeReviewedQuestionId!];
  const isReviewedQuestionMissing = Boolean(activeReviewedQuestionId) && !activeReviewedQuestion;
  const reviewedUserAnswer = result.userAnswers[activeReviewedQuestionId!];
  const isReviewedCorrect = reviewedUserAnswer === activeReviewedQuestion?.correctAnswerIndex;

  useEffect(() => {
    if (reviewedSections.length === 0) {
      if (activeSectionIndex !== 0) setActiveSectionIndex(0);
      if (currentQuestionIndex !== 0) setCurrentQuestionIndex(0);
      return;
    }
    if (activeSectionIndex >= reviewedSections.length) {
      setActiveSectionIndex(0);
      setCurrentQuestionIndex(0);
      return;
    }
    const active = reviewedSections[activeSectionIndex];
    if (!active || active.questionIds.length === 0 || currentQuestionIndex >= active.questionIds.length) {
      setCurrentQuestionIndex(0);
    }
  }, [reviewedSections, activeSectionIndex, currentQuestionIndex]);

  useEffect(() => {
    setAiExplanation('');
    setAiError('');
    setAiSource('');
  }, [activeReviewedQuestionId]);

  useEffect(() => {
    if (!showMoreInfo || !activeReviewedQuestion) return;
    let cancelled = false;
    const run = async () => {
      try {
        setAiLoading(true);
        setAiError('');
        const result = await getOrCreateAiExplanation(activeReviewedQuestion);
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
  }, [showMoreInfo, activeReviewedQuestionId]);

  const submitQuestionTag = async (includeNote: boolean) => {
    if (!activeReviewedQuestion || !activeReviewedQuestionId || isSubmittingTag) return;
    setIsSubmittingTag(true);
    try {
      const noteValue = includeNote ? tagNote.trim() : '';
      await addDoc(collection(db, 'questionTagInsights'), {
        questionId: activeReviewedQuestionId,
        testId: result.testId,
        testName: result.testName,
        resultId: result.id,
        userId: result.userId,
        userName: result.userName,
        note: noteValue,
        createdAt: new Date().toISOString(),
        status: 'new'
      });
      toast.success('Tag submitted', noteValue ? 'Tag submitted with note.' : 'Tag submitted.');
      setIsTagDialogOpen(false);
      setTagNote('');
    } catch (err: any) {
      toast.error('Tag submission failed', (err?.message || 'Could not submit tag.').trim());
    } finally {
      setIsSubmittingTag(false);
    }
  };

  if (loading) {
    return (
      <div className="v2-page h-full w-full flex flex-col items-center justify-center bg-slate-950 safe-top safe-bottom">
        <img src={logo} className="w-16 h-16 animate-spin mb-6" alt="Scholar! logo" />
        <p className="text-[11px] font-black uppercase tracking-[0.4em] text-amber-500">Loading Review...</p>
      </div>
    );
  }

  if (!test) {
    return (
      <div className="v2-page h-full w-full flex flex-col items-center justify-center bg-slate-50 p-6 text-center safe-top safe-bottom">
        <img src={logo} className="w-16 h-16 mb-6" alt="Scholar! logo" />
        <h2 className="text-xl font-bold text-slate-900 mb-2 uppercase">Review Unavailable</h2>
        <p className="text-slate-500 text-sm mb-6">We could not load this test.</p>
        <button onClick={onExit} className="px-8 py-3 bg-slate-950 text-amber-500 rounded-xl font-bold uppercase tracking-widest text-xs">Back</button>
      </div>
    );
  }

  if (reviewedSections.length === 0) {
    return (
      <div className="v2-page h-full w-full flex flex-col items-center justify-center bg-slate-50 p-6 text-center safe-top safe-bottom">
        <img src={logo} className="w-16 h-16 mb-6" alt="Scholar! logo" />
        <h2 className="text-xl font-bold text-slate-900 mb-2 uppercase">Nothing To Review</h2>
        <p className="text-slate-500 text-sm mb-6">Only answered questions appear in review. This attempt has no answered questions.</p>
        <button onClick={onExit} className="px-8 py-3 bg-slate-950 text-amber-500 rounded-xl font-bold uppercase tracking-widest text-xs">Back</button>
      </div>
    );
  }

  return (
    <div className="v2-page flex flex-col h-full bg-slate-50 overflow-hidden min-h-0 safe-top">
      <header className="v2-shell bg-slate-950 text-white px-6 py-5 flex justify-between items-center border-b-4 border-amber-500 z-30 shrink-0">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-10 h-10" alt="Scholar! logo" />
          <div>
            <h1 className="text-[11px] font-black uppercase tracking-[0.4em] text-amber-500 leading-none">Review Mode</h1>
            <p className="text-xs text-slate-400 font-bold uppercase truncate max-w-[200px] mt-1">{test.name}</p>
          </div>
        </div>
        <button 
          onClick={onExit}
          className="px-6 py-2.5 bg-slate-900 border border-slate-800 text-amber-500 text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-slate-800 transition-all shadow-lg"
        >
          Exit Review
        </button>
      </header>

      <div className="review-body flex-1 flex flex-col md:flex-row overflow-hidden relative min-h-0">
        <aside className="question-list-panel flex flex-col w-full md:w-80 bg-white border-b md:border-b-0 md:border-r border-slate-100 shrink-0 max-h-[180px] md:max-h-none">
           <div className="p-6 border-b border-slate-50 bg-slate-50/50">
              <h3 className="text-xs font-black text-slate-950 uppercase tracking-[0.3em]">Question List</h3>
           </div>
           <div className="flex-1 v2-scroll p-3 md:p-6">
             <div className="flex md:block gap-4 md:gap-8">
              {reviewedSections.map((section, sIdx) => (
                <div key={sIdx} className="shrink-0">
                  <p className="text-xs font-black text-amber-600 uppercase mb-3 tracking-widest">{section.name}</p>
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
                          className={`q-dot h-10 rounded-xl text-xs font-black border transition-all ${
                            isActive 
                              ? 'active border-amber-500 ring-4 ring-amber-500/20' 
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
                  {activeReviewedSection?.name} - Item {currentQuestionIndex + 1}
               </span>
               <div className="q-action-row flex gap-3 overflow-x-auto no-scrollbar whitespace-nowrap">
                 <button
                   type="button"
                   onClick={() => setIsTagDialogOpen(true)}
                   className="text-xs font-black px-4 py-1.5 rounded-full uppercase tracking-widest border text-amber-700 bg-amber-50 border-amber-200"
                 >
                   Add Tag
                 </button>
                 <button
                   type="button"
                   onClick={() => setShowMoreInfo(prev => !prev)}
                   className={`text-xs font-black px-4 py-1.5 rounded-full uppercase tracking-widest border ${showMoreInfo ? 'text-sky-700 bg-sky-50 border-sky-200' : 'text-slate-500 bg-white border-slate-200'}`}
                 >
                   {showMoreInfo ? 'Hide More Info' : 'Show More Info'}
                 </button>
                 {reviewedUserAnswer === undefined ? (
                   <span className="text-xs font-black text-slate-400 bg-slate-100 px-4 py-1.5 rounded-full uppercase tracking-widest">Unattempted</span>
                 ) : isReviewedCorrect ? (
                   <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-4 py-1.5 rounded-full uppercase tracking-widest border border-emerald-100">Correct Response</span>
                 ) : (
                   <span className="text-xs font-black text-rose-700 bg-rose-50 px-4 py-1.5 rounded-full uppercase tracking-widest border border-rose-100">Incorrect Response</span>
                 )}
               </div>
            </div>

            <div className="question-text text-[17px] md:text-3xl font-bold text-slate-900 mb-8 leading-tight tracking-tight">
              <ScientificText text={activeReviewedQuestion?.text || "Question unavailable for this attempt."} />
            </div>

            {activeReviewedQuestion?.imageUrl && (
              <div className="mb-12 rounded-2xl border border-slate-100 bg-slate-50 p-3 md:p-4">
                <img
                  src={activeReviewedQuestion.imageUrl}
                  alt={activeReviewedQuestion.imageAlt || 'Question diagram'}
                  loading="lazy"
                  className="mx-auto max-h-[48vh] w-full object-contain rounded-xl bg-white"
                />
              </div>
            )}

            {isReviewedQuestionMissing && (
              <div className="mb-8 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-xs font-bold text-red-700">
                We could not load this question from the database. New attempts now save question snapshots, so future reviews will open correctly.
              </div>
            )}

            <div className="space-y-5">
              {activeReviewedQuestion?.options.map((option, idx) => {
                const isSelected = reviewedUserAnswer === idx;
                const isCorrectOption = activeReviewedQuestion.correctAnswerIndex === idx;
                
                let cardStyle = "border-slate-50 bg-white text-slate-600";
                let badgeStyle = "bg-slate-100 text-slate-400";

                if (isCorrectOption) {
                  cardStyle = "border-emerald-500 bg-emerald-50 text-emerald-950 ring-4 ring-emerald-500/10";
                  badgeStyle = "bg-emerald-500 text-white";
                } else if (isSelected && !isReviewedCorrect) {
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
            
            {activeReviewedQuestion?.explanation && (
              <div className="mt-16 p-10 bg-slate-950 rounded-[2.5rem] border-t-8 border-amber-500 text-white shadow-2xl relative overflow-hidden">
                <h4 className="text-[11px] font-black text-amber-500 uppercase tracking-[0.4em] mb-6">Explanation</h4>
                <div className="text-base text-slate-300 leading-relaxed relative z-10 italic">
                  <ScientificText text={activeReviewedQuestion.explanation!} />
                </div>
                <div className="absolute top-0 right-0 p-8 opacity-5">
                   <img src={logo} className="w-40 h-40" alt="" />
                </div>
              </div>
            )}
            {showMoreInfo && (
              <div className="mt-10 p-8 bg-sky-50 rounded-[2rem] border border-sky-100 text-slate-800">
                <h4 className="text-[11px] font-black text-sky-700 uppercase tracking-[0.3em] mb-4">AI More Info</h4>
                {aiLoading && <p className="text-xs font-bold uppercase tracking-widest text-sky-700">Loading explanation...</p>}
                {!aiLoading && aiError && <p className="text-xs font-bold uppercase tracking-widest text-red-600">{aiError}</p>}
                {!aiLoading && !aiError && aiSource === 'fallback' && (
                  <p className="mb-3 text-xs font-bold uppercase tracking-widest text-amber-700 bg-amber-100 border border-amber-200 rounded-lg px-3 py-2">
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
        <div className="hidden sm:block text-xs font-black text-slate-400 uppercase tracking-[0.4em]">
           Scholar Review
         </div>
         
         <div className="flex gap-4 w-full sm:w-auto">
           <button 
             onClick={() => {
                if (currentQuestionIndex > 0) {
                  setCurrentQuestionIndex(currentQuestionIndex - 1);
                } else if (activeSectionIndex > 0) {
                  const prevSection = reviewedSections[activeSectionIndex - 1];
                  setActiveSectionIndex(activeSectionIndex - 1);
                  setCurrentQuestionIndex(prevSection.questionIds.length - 1);
                }
             }}
             className="flex-1 sm:flex-none px-8 py-4 border-2 border-slate-100 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-50 transition-all"
           >
             Prev Item
           </button>
           <button 
             onClick={() => {
                if (currentQuestionIndex < activeReviewedSection!.questionIds.length - 1) {
                  setCurrentQuestionIndex(currentQuestionIndex + 1);
                } else if (activeSectionIndex < reviewedSections.length - 1) {
                  setActiveSectionIndex(activeSectionIndex + 1);
                  setCurrentQuestionIndex(0);
                }
             }}
             className="flex-1 sm:flex-none px-8 py-4 bg-slate-950 text-amber-500 rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl transition-all"
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
                  className="py-3 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-40"
                >
                  {isSubmittingTag ? 'Submitting...' : 'Add Tag Only'}
                </button>
                <button
                  onClick={() => submitQuestionTag(true)}
                  disabled={isSubmittingTag || !tagNote.trim()}
                  className="py-3 bg-slate-950 text-amber-500 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-40"
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

