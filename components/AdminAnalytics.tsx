import React, { useEffect, useMemo, useState } from 'react';
import { ExamResult, MockTest, Question } from '../types';
import { db } from '../firebase';
import { collection, getDocs, limit, query } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

type RangeFilter = '7d' | '30d' | '90d' | 'all';
type StatusFilter = 'all' | ExamResult['status'];

const fmtPct = (value: number) => `${Math.round(Number.isFinite(value) ? value : 0)}%`;
const safePct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);
const getMs = (value?: string) => {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
};
const startOfUtcDay = (iso: string) => {
  const ms = getMs(iso);
  if (ms === null) return 'Unknown date';
  const date = new Date(ms);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString().slice(0, 10);
};

const AdminAnalytics: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [results, setResults] = useState<ExamResult[]>([]);
  const [tests, setTests] = useState<MockTest[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);

  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('30d');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [testFilter, setTestFilter] = useState<string>('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');

  const loadAnalyticsData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [resultsSnap, testsSnap, questionsSnap] = await Promise.all([
        getDocs(query(collection(db, 'results'), limit(5000))),
        getDocs(query(collection(db, 'tests'), limit(500))),
        getDocs(query(collection(db, 'questions'), limit(5000)))
      ]);

      const loadedResults = resultsSnap.docs.map(d => ({ ...d.data(), id: d.id } as ExamResult));
      const loadedTests = testsSnap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest));
      const loadedQuestions = questionsSnap.docs.map(d => ({ ...d.data(), id: d.id } as Question));

      loadedResults.sort((a, b) => (getMs(b.completedAt) || 0) - (getMs(a.completedAt) || 0));
      loadedTests.sort((a, b) => (getMs(b.createdAt) || 0) - (getMs(a.createdAt) || 0));

      setResults(loadedResults);
      setTests(loadedTests);
      setQuestions(loadedQuestions);
    } catch (err: any) {
      console.error('Analytics load error:', err);
      setLoadError(err?.message || 'Could not load analytics data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAnalyticsData();
  }, []);

  const testsById = useMemo(() => {
    const map: Record<string, MockTest> = {};
    tests.forEach(test => {
      map[test.id] = test;
    });
    return map;
  }, [tests]);

  const questionsById = useMemo(() => {
    const map: Record<string, Question> = {};
    questions.forEach(question => {
      map[question.id] = question;
    });
    return map;
  }, [questions]);

  const questionSubjectsByTest = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    tests.forEach(test => {
      const subjects = new Set<string>();
      (test.sections || []).forEach(section => {
        (section.questionIds || []).forEach(qId => {
          const subject = questionsById[qId]?.subject?.trim() || 'General';
          subjects.add(subject);
        });
      });
      map[test.id] = subjects;
    });
    return map;
  }, [tests, questionsById]);

  const userOptions = useMemo(() => {
    const map = new Map<string, string>();
    results.forEach(result => {
      if (!map.has(result.userId)) map.set(result.userId, result.userName || 'Unknown');
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [results]);

  const subjectOptions = useMemo(() => {
    const subjects = new Set<string>();
    questions.forEach(q => subjects.add(q.subject?.trim() || 'General'));
    return Array.from(subjects).sort((a, b) => a.localeCompare(b));
  }, [questions]);

  const filteredResults = useMemo(() => {
    const now = Date.now();
    let minMs = 0;
    if (rangeFilter === '7d') minMs = now - (7 * 24 * 60 * 60 * 1000);
    if (rangeFilter === '30d') minMs = now - (30 * 24 * 60 * 60 * 1000);
    if (rangeFilter === '90d') minMs = now - (90 * 24 * 60 * 60 * 1000);

    return results.filter(result => {
      const completedMs = getMs(result.completedAt);
      if (completedMs === null) return false;
      if (minMs && completedMs < minMs) return false;
      if (statusFilter !== 'all' && result.status !== statusFilter) return false;
      if (testFilter !== 'all' && result.testId !== testFilter) return false;
      if (userFilter !== 'all' && result.userId !== userFilter) return false;
      if (subjectFilter !== 'all') {
        const subjects = questionSubjectsByTest[result.testId];
        if (!subjects || !subjects.has(subjectFilter)) return false;
      }
      return true;
    });
  }, [results, rangeFilter, statusFilter, testFilter, userFilter, subjectFilter, questionSubjectsByTest]);

  const kpis = useMemo(() => {
    const attempts = filteredResults.length;
    const uniqueCandidates = new Set(filteredResults.map(item => item.userId)).size;
    const avgScorePct = attempts > 0
      ? filteredResults.reduce((sum, item) => sum + safePct(item.score, item.maxScore || 1), 0) / attempts
      : 0;
    const passed = filteredResults.filter(item => safePct(item.score, item.maxScore || 1) >= 50).length;
    const excellent = filteredResults.filter(item => safePct(item.score, item.maxScore || 1) >= 70).length;
    const autoSubmitted = filteredResults.filter(item => item.status === 'auto-submitted').length;
    const abandoned = filteredResults.filter(item => item.status === 'abandoned').length;
    return {
      attempts,
      uniqueCandidates,
      avgScorePct,
      passRate: safePct(passed, attempts),
      excellentRate: safePct(excellent, attempts),
      autoSubmitRate: safePct(autoSubmitted, attempts),
      abandonmentRate: safePct(abandoned, attempts)
    };
  }, [filteredResults]);

  const trendRows = useMemo(() => {
    const grouped: Record<string, { attempts: number; pass: number; totalPct: number }> = {};
    filteredResults.forEach(result => {
      const key = startOfUtcDay(result.completedAt);
      if (!grouped[key]) grouped[key] = { attempts: 0, pass: 0, totalPct: 0 };
      grouped[key].attempts += 1;
      const pct = safePct(result.score, result.maxScore || 1);
      grouped[key].totalPct += pct;
      if (pct >= 50) grouped[key].pass += 1;
    });

    return Object.entries(grouped)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, item]) => ({
        date,
        attempts: item.attempts,
        avgScore: item.attempts > 0 ? item.totalPct / item.attempts : 0,
        passRate: safePct(item.pass, item.attempts)
      }));
  }, [filteredResults]);

  const testRows = useMemo(() => {
    const grouped: Record<string, ExamResult[]> = {};
    filteredResults.forEach(result => {
      if (!grouped[result.testId]) grouped[result.testId] = [];
      grouped[result.testId].push(result);
    });

    return Object.entries(grouped).map(([testId, rows]) => {
      const uniqueUsers = new Set(rows.map(item => item.userId)).size;
      const avgScore = rows.reduce((sum, item) => sum + safePct(item.score, item.maxScore || 1), 0) / rows.length;
      const passed = rows.filter(item => safePct(item.score, item.maxScore || 1) >= 50).length;

      const attemptsByUser = new Map<string, number>();
      rows.forEach(item => attemptsByUser.set(item.userId, (attemptsByUser.get(item.userId) || 0) + 1));
      const retakeUsers = Array.from(attemptsByUser.values()).filter(value => value > 1).length;

      const lastActivity = rows.reduce((latest, row) => {
        const latestMs = getMs(latest) || 0;
        const rowMs = getMs(row.completedAt) || 0;
        return rowMs > latestMs ? row.completedAt : latest;
      }, rows[0].completedAt);

      return {
        testId,
        testName: testsById[testId]?.name || rows[0].testName || 'Unknown test',
        attempts: rows.length,
        uniqueUsers,
        avgScore,
        passRate: safePct(passed, rows.length),
        retakeRate: safePct(retakeUsers, uniqueUsers || 1),
        lastActivity
      };
    }).sort((a, b) => b.attempts - a.attempts);
  }, [filteredResults, testsById]);

  const sectionRows = useMemo(() => {
    const grouped: Record<string, { totalPct: number; count: number }> = {};
    filteredResults.forEach(result => {
      (result.sectionBreakdown || []).forEach(section => {
        const key = section.sectionName || 'Untitled Section';
        if (!grouped[key]) grouped[key] = { totalPct: 0, count: 0 };
        grouped[key].totalPct += safePct(section.score, section.total || 1);
        grouped[key].count += 1;
      });
    });
    return Object.entries(grouped)
      .map(([name, value]) => ({
        name,
        attempts: value.count,
        avgPct: value.count > 0 ? value.totalPct / value.count : 0
      }))
      .sort((a, b) => a.avgPct - b.avgPct);
  }, [filteredResults]);

  const questionRows = useMemo(() => {
    const grouped: Record<string, {
      attempts: number;
      correct: number;
      unattempted: number;
      optionCounts: number[];
      prompt: string;
      subject: string;
    }> = {};

    filteredResults.forEach(result => {
      const test = testsById[result.testId];
      if (!test) return;

      (test.sections || []).forEach(section => {
        (section.questionIds || []).forEach(qId => {
          const q = questionsById[qId];
          if (!q) return;
          if (subjectFilter !== 'all' && (q.subject?.trim() || 'General') !== subjectFilter) return;

          if (!grouped[qId]) {
            grouped[qId] = {
              attempts: 0,
              correct: 0,
              unattempted: 0,
              optionCounts: [0, 0, 0, 0],
              prompt: q.text,
              subject: q.subject?.trim() || 'General'
            };
          }

          const selected = result.userAnswers?.[qId];
          grouped[qId].attempts += 1;
          if (selected === undefined) {
            grouped[qId].unattempted += 1;
          } else {
            if (selected >= 0 && selected < 4) grouped[qId].optionCounts[selected] += 1;
            if (selected === q.correctAnswerIndex) grouped[qId].correct += 1;
          }
        });
      });
    });

    return Object.entries(grouped).map(([id, item]) => ({
      id,
      prompt: item.prompt,
      subject: item.subject,
      attempts: item.attempts,
      correctRate: safePct(item.correct, item.attempts),
      unattemptedRate: safePct(item.unattempted, item.attempts),
      optionCounts: item.optionCounts
    }));
  }, [filteredResults, testsById, questionsById, subjectFilter]);

  const hardestQuestions = useMemo(
    () => [...questionRows].filter(row => row.attempts >= 3).sort((a, b) => a.correctRate - b.correctRate).slice(0, 8),
    [questionRows]
  );

  const mostSkippedQuestions = useMemo(
    () => [...questionRows].filter(row => row.attempts >= 3).sort((a, b) => b.unattemptedRate - a.unattemptedRate).slice(0, 8),
    [questionRows]
  );

  const topStudents = useMemo(() => {
    const grouped: Record<string, { name: string; attempts: number; best: number; first: number; delta: number }> = {};
    const byUser: Record<string, ExamResult[]> = {};
    filteredResults.forEach(result => {
      if (!byUser[result.userId]) byUser[result.userId] = [];
      byUser[result.userId].push(result);
    });

    Object.entries(byUser).forEach(([userId, rows]) => {
      const sorted = [...rows].sort((a, b) => (getMs(a.completedAt) || 0) - (getMs(b.completedAt) || 0));
      const first = safePct(sorted[0].score, sorted[0].maxScore || 1);
      const best = sorted.reduce((max, item) => Math.max(max, safePct(item.score, item.maxScore || 1)), 0);
      const last = safePct(sorted[sorted.length - 1].score, sorted[sorted.length - 1].maxScore || 1);
      grouped[userId] = {
        name: sorted[0].userName,
        attempts: sorted.length,
        best,
        first,
        delta: last - first
      };
    });

    return Object.values(grouped).sort((a, b) => b.best - a.best).slice(0, 10);
  }, [filteredResults]);

  const operational = useMemo(() => {
    const activeTests = tests.filter(test => !(test as any).isPaused).length;
    const pausedTests = tests.filter(test => Boolean((test as any).isPaused)).length;
    const approvedTests = tests.filter(test => test.isApproved).length;

    const questionBySubject: Record<string, number> = {};
    const questionByTopic: Record<string, number> = {};
    questions.forEach(question => {
      const subject = question.subject?.trim() || 'General';
      const topic = question.topic?.trim() || 'General';
      questionBySubject[subject] = (questionBySubject[subject] || 0) + 1;
      questionByTopic[topic] = (questionByTopic[topic] || 0) + 1;
    });

    const topSubjects = Object.entries(questionBySubject)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const topTopics = Object.entries(questionByTopic)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const recalculated = results.filter(item => Boolean((item as any).scoreRecalculatedAt)).length;

    const questionsLast30d = questions.filter(question => {
      const ms = getMs(question.createdAt);
      if (ms === null) return false;
      return ms >= Date.now() - (30 * 24 * 60 * 60 * 1000);
    }).length;

    return {
      activeTests,
      pausedTests,
      approvedTests,
      topSubjects,
      topTopics,
      recalculated,
      questionsLast30d
    };
  }, [questions, results, tests]);

  const maxTrendAttempts = Math.max(...trendRows.map(row => row.attempts), 1);
  const maxTrendScore = Math.max(...trendRows.map(row => row.avgScore), 1);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row gap-3">
          <select className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold" value={rangeFilter} onChange={(e) => setRangeFilter(e.target.value as RangeFilter)}>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>

          <select className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="auto-submitted">Auto-submitted</option>
            <option value="abandoned">Abandoned</option>
          </select>

          <select className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold" value={testFilter} onChange={(e) => setTestFilter(e.target.value)}>
            <option value="all">All tests</option>
            {tests.map(test => (
              <option key={test.id} value={test.id}>{test.name}</option>
            ))}
          </select>

          <select className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
            <option value="all">All candidates</option>
            {userOptions.map(user => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>

          <select className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold" value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
            <option value="all">All subjects</option>
            {subjectOptions.map(subject => (
              <option key={subject} value={subject}>{subject}</option>
            ))}
          </select>

          <button onClick={loadAnalyticsData} className="px-5 py-3 bg-slate-950 text-amber-500 rounded-xl text-[10px] font-bold uppercase tracking-widest">
            Refresh
          </button>
        </div>
        {loadError && (
          <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-red-600">{loadError}</p>
        )}
      </div>

      {isLoading ? (
        <div className="bg-white border border-slate-100 rounded-[2rem] p-12 text-center text-slate-400 text-[10px] font-bold uppercase tracking-widest">
          Loading analytics...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-100 rounded-2xl p-5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Total Attempts</p>
              <p className="text-2xl font-black text-slate-900 mt-2">{kpis.attempts}</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Unique Candidates</p>
              <p className="text-2xl font-black text-slate-900 mt-2">{kpis.uniqueCandidates}</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Average Score</p>
              <p className="text-2xl font-black text-slate-900 mt-2">{fmtPct(kpis.avgScorePct)}</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Pass Rate</p>
              <p className="text-2xl font-black text-slate-900 mt-2">{fmtPct(kpis.passRate)}</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Excellent (70%+)</p>
              <p className="text-2xl font-black text-slate-900 mt-2">{fmtPct(kpis.excellentRate)}</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Auto-submit Rate</p>
              <p className="text-2xl font-black text-slate-900 mt-2">{fmtPct(kpis.autoSubmitRate)}</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Abandonment Rate</p>
              <p className="text-2xl font-black text-slate-900 mt-2">{fmtPct(kpis.abandonmentRate)}</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Recalculated Results</p>
              <p className="text-2xl font-black text-slate-900 mt-2">{operational.recalculated}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Attempts Trend</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                {trendRows.length === 0 && <p className="text-[10px] font-bold text-slate-400 uppercase">No data for current filters.</p>}
                {trendRows.map(row => (
                  <div key={row.date} className="space-y-1">
                    <div className="flex justify-between text-[10px] font-bold text-slate-500">
                      <span>{row.date}</span>
                      <span>{row.attempts} attempts</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500" style={{ width: `${safePct(row.attempts, maxTrendAttempts)}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Average Score Trend</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                {trendRows.length === 0 && <p className="text-[10px] font-bold text-slate-400 uppercase">No data for current filters.</p>}
                {trendRows.map(row => (
                  <div key={row.date} className="space-y-1">
                    <div className="flex justify-between text-[10px] font-bold text-slate-500">
                      <span>{row.date}</span>
                      <span>{fmtPct(row.avgScore)}</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-slate-900" style={{ width: `${safePct(row.avgScore, maxTrendScore)}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Test-Level Analytics</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[900px]">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
                    <th className="py-3 pr-4">Test</th>
                    <th className="py-3 pr-4">Attempts</th>
                    <th className="py-3 pr-4">Candidates</th>
                    <th className="py-3 pr-4">Avg Score</th>
                    <th className="py-3 pr-4">Pass Rate</th>
                    <th className="py-3 pr-4">Retake Rate</th>
                    <th className="py-3 pr-4">Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {testRows.map(row => (
                    <tr key={row.testId} className="border-b border-slate-50 text-sm">
                      <td className="py-3 pr-4 font-bold text-slate-900">{row.testName}</td>
                      <td className="py-3 pr-4">{row.attempts}</td>
                      <td className="py-3 pr-4">{row.uniqueUsers}</td>
                      <td className="py-3 pr-4">{fmtPct(row.avgScore)}</td>
                      <td className="py-3 pr-4">{fmtPct(row.passRate)}</td>
                      <td className="py-3 pr-4">{fmtPct(row.retakeRate)}</td>
                      <td className="py-3 pr-4">{getMs(row.lastActivity) ? new Date(row.lastActivity).toLocaleDateString() : '-'}</td>
                    </tr>
                  ))}
                  {testRows.length === 0 && (
                    <tr>
                      <td className="py-8 text-[10px] font-bold uppercase text-slate-400" colSpan={7}>No tests in current filter set.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Section Difficulty</h3>
              <div className="space-y-3">
                {sectionRows.slice(0, 10).map(section => (
                  <div key={section.name}>
                    <div className="flex justify-between text-[10px] font-bold uppercase text-slate-500 mb-1">
                      <span>{section.name}</span>
                      <span>{fmtPct(section.avgPct)}</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500" style={{ width: `${section.avgPct}%` }}></div>
                    </div>
                  </div>
                ))}
                {sectionRows.length === 0 && <p className="text-[10px] font-bold uppercase text-slate-400">No section data for filters.</p>}
              </div>
            </div>

            <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Top Students</h3>
              <div className="space-y-2">
                {topStudents.map((student, idx) => (
                  <div key={`${student.name}-${idx}`} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                    <div>
                      <p className="text-xs font-bold text-slate-900 uppercase">{student.name}</p>
                      <p className="text-[9px] font-bold uppercase text-slate-400">{student.attempts} attempts</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-slate-900">{fmtPct(student.best)}</p>
                      <p className={`text-[9px] font-bold uppercase ${student.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {student.delta >= 0 ? '+' : ''}{Math.round(student.delta)} trend
                      </p>
                    </div>
                  </div>
                ))}
                {topStudents.length === 0 && <p className="text-[10px] font-bold uppercase text-slate-400">No student rows for filters.</p>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Hardest Questions</h3>
              <div className="space-y-3">
                {hardestQuestions.map(question => (
                  <div key={question.id} className="p-3 bg-slate-50 rounded-xl">
                    <p className="text-[9px] font-bold uppercase text-amber-600">{question.subject}</p>
                    <p className="text-xs font-bold text-slate-800 line-clamp-2 mt-1">{question.prompt}</p>
                    <p className="text-[10px] font-bold uppercase text-slate-500 mt-2">
                      Correct: {fmtPct(question.correctRate)} | Attempts: {question.attempts}
                    </p>
                  </div>
                ))}
                {hardestQuestions.length === 0 && <p className="text-[10px] font-bold uppercase text-slate-400">Not enough question-level attempts.</p>}
              </div>
            </div>

            <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Most Skipped Questions</h3>
              <div className="space-y-3">
                {mostSkippedQuestions.map(question => (
                  <div key={question.id} className="p-3 bg-slate-50 rounded-xl">
                    <p className="text-[9px] font-bold uppercase text-amber-600">{question.subject}</p>
                    <p className="text-xs font-bold text-slate-800 line-clamp-2 mt-1">{question.prompt}</p>
                    <p className="text-[10px] font-bold uppercase text-slate-500 mt-2">
                      Skipped: {fmtPct(question.unattemptedRate)} | Options: A{question.optionCounts[0]} B{question.optionCounts[1]} C{question.optionCounts[2]} D{question.optionCounts[3]}
                    </p>
                  </div>
                ))}
                {mostSkippedQuestions.length === 0 && <p className="text-[10px] font-bold uppercase text-slate-400">Not enough question-level attempts.</p>}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Operational Snapshot</h3>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              <div className="p-4 bg-slate-50 rounded-xl">
                <p className="text-[9px] font-bold uppercase text-slate-400">Active Tests</p>
                <p className="text-2xl font-black text-slate-900">{operational.activeTests}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl">
                <p className="text-[9px] font-bold uppercase text-slate-400">Paused Tests</p>
                <p className="text-2xl font-black text-slate-900">{operational.pausedTests}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl">
                <p className="text-[9px] font-bold uppercase text-slate-400">Approved Tests</p>
                <p className="text-2xl font-black text-slate-900">{operational.approvedTests}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl">
                <p className="text-[9px] font-bold uppercase text-slate-400">Questions Added (30d)</p>
                <p className="text-2xl font-black text-slate-900">{operational.questionsLast30d}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50 rounded-xl">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-3">Top Subjects</h4>
                <div className="space-y-2">
                  {operational.topSubjects.map(subject => (
                    <div key={subject.name} className="flex justify-between text-sm">
                      <span className="font-bold text-slate-900">{subject.name}</span>
                      <span className="font-bold text-slate-500">{subject.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-3">Top Topics</h4>
                <div className="space-y-2">
                  {operational.topTopics.map(topic => (
                    <div key={topic.name} className="flex justify-between text-sm">
                      <span className="font-bold text-slate-900">{topic.name}</span>
                      <span className="font-bold text-slate-500">{topic.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminAnalytics;
