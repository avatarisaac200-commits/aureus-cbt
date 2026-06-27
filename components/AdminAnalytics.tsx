import React, { useEffect, useMemo, useState } from 'react';
import {
  Announcement,
  AnnouncementRead,
  AppNotification,
  ClassSession,
  CommunityProfile,
  Course,
  CourseSession,
  ExamResult,
  FriendRequest,
  Friendship,
  ForumThread,
  MockTest,
  NotificationPreference,
  PrepMode,
  Question,
  TestSection,
  User,
  VideoLesson,
  VideoProgress
} from '../types';
import { db } from '../firebase';
import { collection, getDocs, limit, orderBy, query } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { DEFAULT_PREP_MODE, PREP_MODE_LABELS, hasActivePrepLicense } from '../lib/prepModes';

type RangeFilter = '7d' | '30d' | '90d' | 'all';
type StatusFilter = 'all' | ExamResult['status'];
type QualityFilter = 'all' | 'passed' | 'failed' | 'incomplete';

interface AdminAnalyticsProps {
  prepModeFilter?: PrepMode | 'all';
}

type ResultMetric = ExamResult & {
  percent: number;
  completionRate: number;
  answeredCount: number;
  totalCount: number;
  completedMs: number;
};

type BrainstormMember = {
  id: string;
  userId: string;
  userName: string;
  strikeCount: number;
  blacklisted: boolean;
  createdAt?: string;
  updatedAt?: string;
  blacklistedAt?: string;
};

type BrainstormCheckin = {
  id: string;
  userId: string;
  userName: string;
  dateKey: string;
  checkedWindowIds?: string[];
  missedWindowIds?: string[];
  dailyStrikeApplied?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type LicenseKeyRow = {
  id: string;
  key?: string;
  status?: string;
  redeemedBy?: string;
  redeemedAt?: string;
  expiresAt?: string;
  createdAt?: string;
};

type PushSubscriptionRow = {
  id: string;
  userId: string;
  createdAt?: string;
  updatedAt?: string;
};

const PASS_MARK = 50;
const EXCELLENT_MARK = 70;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const fmtPct = (value: number, decimals = 0) => `${(Number.isFinite(value) ? value : 0).toFixed(decimals)}%`;
const fmtNumber = (value: number) => new Intl.NumberFormat().format(Number.isFinite(value) ? value : 0);
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
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
const formatDate = (value?: string) => {
  const ms = getMs(value);
  return ms === null ? '-' : new Date(ms).toLocaleDateString();
};
const average = (values: number[]) => values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const deltaLabel = (value: number, decimals = 0) => {
  if (!Number.isFinite(value) || Math.abs(value) < 0.01) return '0';
  return `${value > 0 ? '+' : ''}${value.toFixed(decimals)}`;
};
const normalizeLabel = (value?: string, fallback = 'General') => value?.trim() || fallback;
const hasAnswer = (answers: Record<string, number> | undefined, qId: string) => (
  Boolean(answers) && Object.prototype.hasOwnProperty.call(answers, qId)
);
const uniq = <T,>(items: T[]) => Array.from(new Set(items));
const inRange = (iso: string | undefined, currentStart: number) => {
  const ms = getMs(iso);
  if (ms === null) return false;
  return !currentStart || ms >= currentStart;
};
const countBy = <T,>(items: T[], getKey: (item: T) => string | undefined, fallback = 'General') => {
  const map: Record<string, number> = {};
  items.forEach((item) => {
    const key = normalizeLabel(getKey(item), fallback);
    map[key] = (map[key] || 0) + 1;
  });
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

const questionIdsFromSections = (sections?: TestSection[]) => (
  uniq((sections || []).flatMap(section => section.questionIds || []))
);

const getQuestionIdsForResult = (result: ExamResult, test?: MockTest) => {
  if (result.attemptQuestionIds?.length) return uniq(result.attemptQuestionIds);
  const attemptIds = questionIdsFromSections(result.attemptSections);
  if (attemptIds.length) return attemptIds;
  const resolvedIds = questionIdsFromSections(result.resolvedSections);
  if (resolvedIds.length) return resolvedIds;
  return questionIdsFromSections(test?.sections);
};

const getQuestionForResult = (result: ExamResult, questionId: string, questionsById: Record<string, Question>) => (
  result.questionSnapshot?.[questionId] || questionsById[questionId]
);

const getMetric = (result: ExamResult): ResultMetric => {
  const maxScore = Math.max(0, Number(result.maxScore || 0));
  const score = Math.max(0, Number(result.score || 0));
  const answeredCount = Number.isFinite(Number(result.answeredQuestionCount))
    ? Math.max(0, Number(result.answeredQuestionCount))
    : Object.keys(result.userAnswers || {}).length;
  const totalCount = Number.isFinite(Number(result.totalQuestionCount)) && Number(result.totalQuestionCount) > 0
    ? Number(result.totalQuestionCount)
    : Math.max(answeredCount, getQuestionIdsForResult(result).length);
  return {
    ...result,
    percent: safePct(score, maxScore || 1),
    completionRate: safePct(answeredCount, totalCount || 1),
    answeredCount,
    totalCount,
    completedMs: getMs(result.completedAt) || 0
  };
};

const getRangeWindow = (range: RangeFilter, now = Date.now()) => {
  if (range === 'all') return { currentStart: 0, previousStart: 0, previousEnd: 0, days: null as number | null };
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const currentStart = now - (days * MS_PER_DAY);
  return {
    currentStart,
    previousStart: currentStart - (days * MS_PER_DAY),
    previousEnd: currentStart,
    days
  };
};

const AdminAnalytics: React.FC<AdminAnalyticsProps> = ({ prepModeFilter = 'all' }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [results, setResults] = useState<ExamResult[]>([]);
  const [tests, setTests] = useState<MockTest[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseSessions, setCourseSessions] = useState<CourseSession[]>([]);
  const [videoLessons, setVideoLessons] = useState<VideoLesson[]>([]);
  const [videoProgress, setVideoProgress] = useState<VideoProgress[]>([]);
  const [attendanceMembers, setAttendanceMembers] = useState<BrainstormMember[]>([]);
  const [attendanceCheckins, setAttendanceCheckins] = useState<BrainstormCheckin[]>([]);
  const [attendanceBlacklist, setAttendanceBlacklist] = useState<BrainstormMember[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementReads, setAnnouncementReads] = useState<AnnouncementRead[]>([]);
  const [classSessions, setClassSessions] = useState<ClassSession[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreference[]>([]);
  const [communityProfiles, setCommunityProfiles] = useState<CommunityProfile[]>([]);
  const [forumThreads, setForumThreads] = useState<ForumThread[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [licenseKeys, setLicenseKeys] = useState<LicenseKeyRow[]>([]);
  const [pushSubscriptions, setPushSubscriptions] = useState<PushSubscriptionRow[]>([]);
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('30d');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all');
  const [testFilter, setTestFilter] = useState<string>('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [showMore, setShowMore] = useState(false);

  const loadAnalyticsData = async () => {
    setIsLoading(true);
    setLoadError(null);
    setLoadWarnings([]);
    try {
      const warnings: string[] = [];
      const loadCollection = async <T,>(name: string, rowLimit: number, orderedBy?: string): Promise<T[]> => {
        try {
          const q = orderedBy
            ? query(collection(db, name), orderBy(orderedBy, 'desc'), limit(rowLimit))
            : query(collection(db, name), limit(rowLimit));
          const snap = await getDocs(q);
          return snap.docs.map(d => ({ ...d.data(), id: d.id } as T));
        } catch (err: any) {
          warnings.push(`${name}: ${err?.message || 'unavailable'}`);
          return [];
        }
      };

      const [
        loadedResults,
        loadedTests,
        loadedQuestions,
        loadedUsers,
        loadedCourses,
        loadedCourseSessions,
        loadedVideoLessons,
        loadedVideoProgress,
        loadedAttendanceMembers,
        loadedAttendanceCheckins,
        loadedAttendanceBlacklist,
        loadedAnnouncements,
        loadedAnnouncementReads,
        loadedClassSessions,
        loadedNotifications,
        loadedNotificationPreferences,
        loadedCommunityProfiles,
        loadedForumThreads,
        loadedFriendRequests,
        loadedFriendships,
        loadedLicenseKeys,
        loadedPushSubscriptions
      ] = await Promise.all([
        loadCollection<ExamResult>('results', 10000, 'completedAt'),
        loadCollection<MockTest>('tests', 1000, 'createdAt'),
        loadCollection<Question>('questions', 10000),
        loadCollection<User>('users', 5000),
        loadCollection<Course>('courses', 1000),
        loadCollection<CourseSession>('courseSessions', 10000),
        loadCollection<VideoLesson>('videoLessons', 1000),
        loadCollection<VideoProgress>('videoProgress', 10000),
        loadCollection<BrainstormMember>('brainstormMembers', 5000),
        loadCollection<BrainstormCheckin>('brainstormCheckins', 10000),
        loadCollection<BrainstormMember>('brainstormBlacklist', 5000),
        loadCollection<Announcement>('announcements', 3000),
        loadCollection<AnnouncementRead>('announcementReads', 10000),
        loadCollection<ClassSession>('classSessions', 3000),
        loadCollection<AppNotification>('notifications', 10000),
        loadCollection<NotificationPreference>('notificationPreferences', 10000),
        loadCollection<CommunityProfile>('communityProfiles', 5000),
        loadCollection<ForumThread>('forumThreads', 3000),
        loadCollection<FriendRequest>('friendRequests', 5000),
        loadCollection<Friendship>('friendships', 5000),
        loadCollection<LicenseKeyRow>('licenseKeys', 5000),
        loadCollection<PushSubscriptionRow>('pushSubscriptions', 5000)
      ]);

      loadedResults.sort((a, b) => (getMs(b.completedAt) || 0) - (getMs(a.completedAt) || 0));
      loadedTests.sort((a, b) => (getMs(b.createdAt) || 0) - (getMs(a.createdAt) || 0));

      setResults(loadedResults);
      setTests(loadedTests);
      setQuestions(loadedQuestions);
      setUsers(loadedUsers);
      setCourses(loadedCourses);
      setCourseSessions(loadedCourseSessions);
      setVideoLessons(loadedVideoLessons);
      setVideoProgress(loadedVideoProgress);
      setAttendanceMembers(loadedAttendanceMembers);
      setAttendanceCheckins(loadedAttendanceCheckins);
      setAttendanceBlacklist(loadedAttendanceBlacklist);
      setAnnouncements(loadedAnnouncements);
      setAnnouncementReads(loadedAnnouncementReads);
      setClassSessions(loadedClassSessions);
      setNotifications(loadedNotifications);
      setNotificationPreferences(loadedNotificationPreferences);
      setCommunityProfiles(loadedCommunityProfiles);
      setForumThreads(loadedForumThreads);
      setFriendRequests(loadedFriendRequests);
      setFriendships(loadedFriendships);
      setLicenseKeys(loadedLicenseKeys);
      setPushSubscriptions(loadedPushSubscriptions);
      setLoadWarnings(warnings);
      setLoadedAt(new Date().toISOString());
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
    tests.forEach(test => { map[test.id] = test; });
    return map;
  }, [tests]);

  const questionsById = useMemo(() => {
    const map: Record<string, Question> = {};
    questions.forEach(question => { map[question.id] = question; });
    return map;
  }, [questions]);

  const filteredTestsForPrep = useMemo(() => {
    if (prepModeFilter === 'all') return tests;
    return tests.filter(test => ((test.prepMode as PrepMode) || DEFAULT_PREP_MODE) === prepModeFilter);
  }, [tests, prepModeFilter]);

  const filteredQuestionsForPrep = useMemo(() => {
    if (prepModeFilter === 'all') return questions;
    return questions.filter(question => ((question.prepMode as PrepMode) || DEFAULT_PREP_MODE) === prepModeFilter);
  }, [questions, prepModeFilter]);

  const filteredResultsForPrep = useMemo(() => {
    if (prepModeFilter === 'all') return results;
    return results.filter(result => {
      const resultPrepMode = (result.prepMode as PrepMode) || ((testsById[result.testId]?.prepMode as PrepMode) || DEFAULT_PREP_MODE);
      return resultPrepMode === prepModeFilter;
    });
  }, [results, testsById, prepModeFilter]);

  const filteredLicenseKeysForPrep = useMemo(() => {
    if (prepModeFilter === 'all') return licenseKeys;
    return licenseKeys.filter(key => ((key as any).prepMode || DEFAULT_PREP_MODE) === prepModeFilter);
  }, [licenseKeys, prepModeFilter]);

  useEffect(() => {
    if (testFilter === 'all') return;
    if (filteredTestsForPrep.some(test => test.id === testFilter)) return;
    setTestFilter('all');
  }, [filteredTestsForPrep, testFilter]);

  const resultMetrics = useMemo(() => filteredResultsForPrep.map(getMetric), [filteredResultsForPrep]);

  const userOptions = useMemo(() => {
    const map = new Map<string, string>();
    filteredResultsForPrep.forEach(result => {
      if (!map.has(result.userId)) map.set(result.userId, result.userName || 'Unknown');
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredResultsForPrep]);

  const subjectOptions = useMemo(() => {
    const subjects = new Set<string>();
    filteredQuestionsForPrep.forEach(q => subjects.add(normalizeLabel(q.subject)));
    filteredResultsForPrep.forEach(result => {
      Object.values(result.questionSnapshot || {}).forEach(q => subjects.add(normalizeLabel(q.subject)));
    });
    return Array.from(subjects).sort((a, b) => a.localeCompare(b));
  }, [filteredQuestionsForPrep, filteredResultsForPrep]);

  const filteredResults = useMemo(() => {
    const { currentStart } = getRangeWindow(rangeFilter);

    return resultMetrics.filter(result => {
      if (!result.completedMs) return false;
      if (currentStart && result.completedMs < currentStart) return false;
      if (statusFilter !== 'all' && result.status !== statusFilter) return false;
      if (testFilter !== 'all' && result.testId !== testFilter) return false;
      if (userFilter !== 'all' && result.userId !== userFilter) return false;
      if (qualityFilter === 'passed' && result.percent < PASS_MARK) return false;
      if (qualityFilter === 'failed' && result.percent >= PASS_MARK) return false;
      if (qualityFilter === 'incomplete' && result.completionRate >= 90) return false;
      if (subjectFilter !== 'all') {
        const questionIds = getQuestionIdsForResult(result, testsById[result.testId]);
        const hasSubject = questionIds.some(qId => normalizeLabel(getQuestionForResult(result, qId, questionsById)?.subject) === subjectFilter);
        if (!hasSubject) return false;
      }
      return true;
    });
  }, [resultMetrics, rangeFilter, statusFilter, qualityFilter, testFilter, userFilter, subjectFilter, testsById, questionsById]);

  const comparisonResults = useMemo(() => {
    const { days, previousStart, previousEnd } = getRangeWindow(rangeFilter);
    if (!days) return [];
    return resultMetrics.filter(result => (
      result.completedMs >= previousStart &&
      result.completedMs < previousEnd &&
      (statusFilter === 'all' || result.status === statusFilter) &&
      (testFilter === 'all' || result.testId === testFilter) &&
      (userFilter === 'all' || result.userId === userFilter)
    ));
  }, [resultMetrics, rangeFilter, statusFilter, testFilter, userFilter]);

  const summarize = (rows: ResultMetric[]) => {
    const attempts = rows.length;
    const scores = rows.map(item => item.percent);
    const passed = rows.filter(item => item.percent >= PASS_MARK).length;
    const excellent = rows.filter(item => item.percent >= EXCELLENT_MARK).length;
    const autoSubmitted = rows.filter(item => item.status === 'auto-submitted').length;
    const abandoned = rows.filter(item => item.status === 'abandoned').length;
    const completed = rows.filter(item => item.status === 'completed').length;
    return {
      attempts,
      uniqueCandidates: new Set(rows.map(item => item.userId)).size,
      avgScorePct: average(scores),
      medianScorePct: median(scores),
      passRate: safePct(passed, attempts),
      excellentRate: safePct(excellent, attempts),
      completionRate: average(rows.map(item => item.completionRate)),
      completedRate: safePct(completed, attempts),
      autoSubmitRate: safePct(autoSubmitted, attempts),
      abandonmentRate: safePct(abandoned, attempts)
    };
  };

  const kpis = useMemo(() => summarize(filteredResults), [filteredResults]);
  const previousKpis = useMemo(() => summarize(comparisonResults), [comparisonResults]);

  const trendRows = useMemo(() => {
    const grouped: Record<string, { attempts: number; pass: number; totalPct: number; completion: number }> = {};
    filteredResults.forEach(result => {
      const key = startOfUtcDay(result.completedAt);
      if (!grouped[key]) grouped[key] = { attempts: 0, pass: 0, totalPct: 0, completion: 0 };
      grouped[key].attempts += 1;
      grouped[key].totalPct += result.percent;
      grouped[key].completion += result.completionRate;
      if (result.percent >= PASS_MARK) grouped[key].pass += 1;
    });

    return Object.entries(grouped)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, item]) => ({
        date,
        attempts: item.attempts,
        avgScore: item.attempts > 0 ? item.totalPct / item.attempts : 0,
        passRate: safePct(item.pass, item.attempts),
        completionRate: item.attempts > 0 ? item.completion / item.attempts : 0
      }));
  }, [filteredResults]);

  const scoreDistribution = useMemo(() => {
    const bands = [
      { label: '0-39', min: 0, max: 39.999, tone: 'bg-rose-500' },
      { label: '40-49', min: 40, max: 49.999, tone: 'bg-red-500' },
      { label: '50-69', min: 50, max: 69.999, tone: 'bg-amber-500' },
      { label: '70-100', min: 70, max: 100, tone: 'bg-emerald-500' }
    ];
    return bands.map(band => ({
      ...band,
      count: filteredResults.filter(row => row.percent >= band.min && row.percent <= band.max).length
    }));
  }, [filteredResults]);

  const testRows = useMemo(() => {
    const grouped: Record<string, ResultMetric[]> = {};
    filteredResults.forEach(result => {
      if (!grouped[result.testId]) grouped[result.testId] = [];
      grouped[result.testId].push(result);
    });

    return Object.entries(grouped).map(([testId, rows]) => {
      const scores = rows.map(item => item.percent);
      const uniqueUsers = new Set(rows.map(item => item.userId)).size;
      const passed = rows.filter(item => item.percent >= PASS_MARK).length;
      const attemptsByUser = new Map<string, number>();
      rows.forEach(item => attemptsByUser.set(item.userId, (attemptsByUser.get(item.userId) || 0) + 1));
      const retakeUsers = Array.from(attemptsByUser.values()).filter(value => value > 1).length;
      const lastActivity = rows.reduce((latest, row) => row.completedMs > latest.completedMs ? row : latest, rows[0]);
      const lowCompletion = rows.filter(row => row.completionRate < 90).length;
      const autoSubmitted = rows.filter(row => row.status === 'auto-submitted').length;
      const abandoned = rows.filter(row => row.status === 'abandoned').length;
      const riskScore = (safePct(lowCompletion + autoSubmitted + abandoned, rows.length * 3) * 0.5) + ((100 - safePct(passed, rows.length)) * 0.5);

      return {
        testId,
        testName: testsById[testId]?.name || rows[0].testName || 'Unknown test',
        attempts: rows.length,
        uniqueUsers,
        avgScore: average(scores),
        medianScore: median(scores),
        passRate: safePct(passed, rows.length),
        retakeRate: safePct(retakeUsers, uniqueUsers || 1),
        completionRate: average(rows.map(row => row.completionRate)),
        riskScore,
        lastActivity: lastActivity.completedAt
      };
    }).sort((a, b) => b.riskScore - a.riskScore || b.attempts - a.attempts);
  }, [filteredResults, testsById]);

  const sectionRows = useMemo(() => {
    const grouped: Record<string, { totalPct: number; count: number; pass: number }> = {};
    filteredResults.forEach(result => {
      (result.sectionBreakdown || []).forEach(section => {
        const key = section.sectionName || 'Untitled Section';
        if (!grouped[key]) grouped[key] = { totalPct: 0, count: 0, pass: 0 };
        const pct = safePct(section.score, section.total || 1);
        grouped[key].totalPct += pct;
        grouped[key].count += 1;
        if (pct >= PASS_MARK) grouped[key].pass += 1;
      });
    });
    return Object.entries(grouped)
      .map(([name, value]) => ({
        name,
        attempts: value.count,
        avgPct: value.count > 0 ? value.totalPct / value.count : 0,
        passRate: safePct(value.pass, value.count)
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
      topic: string;
      difficulty: string;
      correctIndex: number;
    }> = {};

    filteredResults.forEach(result => {
      const questionIds = getQuestionIdsForResult(result, testsById[result.testId]);

      questionIds.forEach(qId => {
        const q = getQuestionForResult(result, qId, questionsById);
        if (!q) return;
        const subject = normalizeLabel(q.subject);
        if (subjectFilter !== 'all' && subject !== subjectFilter) return;

        if (!grouped[qId]) {
          grouped[qId] = {
            attempts: 0,
            correct: 0,
            unattempted: 0,
            optionCounts: Array.from({ length: Math.max(q.options?.length || 4, 4) }, () => 0),
            prompt: q.text,
            subject,
            topic: normalizeLabel(q.topic),
            difficulty: q.difficulty || 'unset',
            correctIndex: q.correctAnswerIndex
          };
        }

        grouped[qId].attempts += 1;
        if (!hasAnswer(result.userAnswers, qId)) {
          grouped[qId].unattempted += 1;
          return;
        }

        const selected = result.userAnswers[qId];
        if (selected >= 0 && selected < grouped[qId].optionCounts.length) grouped[qId].optionCounts[selected] += 1;
        if (selected === q.correctAnswerIndex) grouped[qId].correct += 1;
      });
    });

    return Object.entries(grouped).map(([id, item]) => {
      const wrongAttempts = Math.max(0, item.attempts - item.correct - item.unattempted);
      const strongestDistractorCount = item.optionCounts.reduce((max, count, idx) => idx === item.correctIndex ? max : Math.max(max, count), 0);
      return {
        id,
        prompt: item.prompt,
        subject: item.subject,
        topic: item.topic,
        difficulty: item.difficulty,
        attempts: item.attempts,
        correctRate: safePct(item.correct, item.attempts),
        unattemptedRate: safePct(item.unattempted, item.attempts),
        distractorRate: safePct(strongestDistractorCount, Math.max(1, wrongAttempts + item.correct)),
        optionCounts: item.optionCounts,
        correctIndex: item.correctIndex
      };
    });
  }, [filteredResults, testsById, questionsById, subjectFilter]);

  const subjectRows = useMemo(() => {
    const grouped: Record<string, { attempts: number; correct: number; skipped: number; totalCompletion: number; questionIds: Set<string> }> = {};
    questionRows.forEach(question => {
      if (!grouped[question.subject]) grouped[question.subject] = { attempts: 0, correct: 0, skipped: 0, totalCompletion: 0, questionIds: new Set() };
      grouped[question.subject].attempts += question.attempts;
      grouped[question.subject].correct += Math.round((question.correctRate / 100) * question.attempts);
      grouped[question.subject].skipped += Math.round((question.unattemptedRate / 100) * question.attempts);
      grouped[question.subject].totalCompletion += (100 - question.unattemptedRate) * question.attempts;
      grouped[question.subject].questionIds.add(question.id);
    });

    return Object.entries(grouped).map(([subject, row]) => ({
      subject,
      questions: row.questionIds.size,
      attempts: row.attempts,
      correctRate: safePct(row.correct, row.attempts),
      skipRate: safePct(row.skipped, row.attempts),
      completionRate: row.attempts > 0 ? row.totalCompletion / row.attempts : 0
    })).sort((a, b) => a.correctRate - b.correctRate);
  }, [questionRows]);

  const hardestQuestions = useMemo(
    () => [...questionRows].filter(row => row.attempts >= 3).sort((a, b) => a.correctRate - b.correctRate).slice(0, 10),
    [questionRows]
  );

  const mostSkippedQuestions = useMemo(
    () => [...questionRows].filter(row => row.attempts >= 3).sort((a, b) => b.unattemptedRate - a.unattemptedRate).slice(0, 10),
    [questionRows]
  );

  const strongestDistractors = useMemo(
    () => [...questionRows].filter(row => row.attempts >= 3).sort((a, b) => b.distractorRate - a.distractorRate).slice(0, 10),
    [questionRows]
  );

  const studentRows = useMemo(() => {
    const byUser: Record<string, ResultMetric[]> = {};
    filteredResults.forEach(result => {
      if (!byUser[result.userId]) byUser[result.userId] = [];
      byUser[result.userId].push(result);
    });

    return Object.entries(byUser).map(([userId, rows]) => {
      const sorted = [...rows].sort((a, b) => a.completedMs - b.completedMs);
      const scores = sorted.map(row => row.percent);
      const first = scores[0] || 0;
      const last = scores[scores.length - 1] || 0;
      const best = Math.max(...scores, 0);
      const avg = average(scores);
      const lowScores = sorted.filter(row => row.percent < PASS_MARK).length;
      const incomplete = sorted.filter(row => row.completionRate < 90).length;
      return {
        userId,
        name: sorted[0]?.userName || 'Unknown',
        attempts: sorted.length,
        avg,
        best,
        first,
        last,
        delta: last - first,
        completionRate: average(sorted.map(row => row.completionRate)),
        riskScore: safePct(lowScores + incomplete, sorted.length * 2),
        lastActivity: sorted[sorted.length - 1]?.completedAt
      };
    }).sort((a, b) => b.riskScore - a.riskScore || a.avg - b.avg);
  }, [filteredResults]);

  const topStudents = useMemo(() => [...studentRows].sort((a, b) => b.best - a.best || b.avg - a.avg).slice(0, 10), [studentRows]);
  const atRiskStudents = useMemo(() => studentRows.filter(row => row.attempts >= 2).slice(0, 10), [studentRows]);

  const operational = useMemo(() => {
    const activeTests = filteredTestsForPrep.filter(test => !(test as any).isPaused && !(test as any).isArchived).length;
    const pausedTests = filteredTestsForPrep.filter(test => Boolean((test as any).isPaused)).length;
    const archivedTests = filteredTestsForPrep.filter(test => Boolean((test as any).isArchived)).length;
    const approvedTests = filteredTestsForPrep.filter(test => test.isApproved).length;
    const dynamicTests = filteredTestsForPrep.filter(test => test.generationMode && test.generationMode !== 'fixed').length;

    const questionBySubject: Record<string, number> = {};
    const questionByTopic: Record<string, number> = {};
    filteredQuestionsForPrep.forEach(question => {
      const subject = normalizeLabel(question.subject);
      const topic = normalizeLabel(question.topic);
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

    const recalculated = filteredResultsForPrep.filter(item => Boolean((item as any).scoreRecalculatedAt)).length;
    const questionsLast30d = filteredQuestionsForPrep.filter(question => {
      const ms = getMs(question.createdAt);
      return ms !== null && ms >= Date.now() - (30 * MS_PER_DAY);
    }).length;

    return {
      activeTests,
      pausedTests,
      archivedTests,
      approvedTests,
      dynamicTests,
      topSubjects,
      topTopics,
      recalculated,
      questionsLast30d
    };
  }, [filteredQuestionsForPrep, filteredResultsForPrep, filteredTestsForPrep]);

  const ecosystem = useMemo(() => {
    const { currentStart } = getRangeWindow(rangeFilter);
    const rangeCourseSessions = courseSessions.filter(session => inRange(session.endedAt, currentStart));
    const rangeVideoProgress = videoProgress.filter(progress => inRange(progress.lastWatchedAt, currentStart));
    const rangeCheckins = attendanceCheckins.filter(row => inRange(row.updatedAt || row.createdAt || row.dateKey, currentStart));
    const rangeAnnouncements = announcements.filter(row => inRange(row.publishedAt || row.createdAt, currentStart));
    const rangeClassSessions = classSessions.filter(row => inRange(row.startTime || row.createdAt, currentStart));
    const rangeNotifications = notifications.filter(row => inRange(row.createdAt, currentStart));
    const rangeForumThreads = forumThreads.filter(row => inRange(row.latestActivityAt || row.createdAt, currentStart));
    const rangeFriendRequests = friendRequests.filter(row => inRange(row.createdAt, currentStart));
    const rangeLicenseKeys = filteredLicenseKeysForPrep.filter(row => inRange(row.createdAt || row.redeemedAt, currentStart));

    const activeLearners = new Set([
      ...filteredResults.map(row => row.userId),
      ...rangeCourseSessions.map(row => row.userId),
      ...rangeVideoProgress.map(row => row.userId),
      ...rangeCheckins.map(row => row.userId)
    ]).size;

    const completedCourseSessions = rangeCourseSessions.filter(row => row.status === 'completed').length;
    const timedOutCourseSessions = rangeCourseSessions.filter(row => row.status === 'timed-out').length;
    const abandonedCourseSessions = rangeCourseSessions.filter(row => row.status === 'abandoned').length;
    const videoCompletions = rangeVideoProgress.filter(row => row.completed).length;
    const videoBookmarks = rangeVideoProgress.filter(row => row.bookmarked).length;
    const videoWatchSeconds = rangeVideoProgress.reduce((sum, row) => sum + Math.min(Number(row.lastPositionSeconds || 0), Number(row.durationSeconds || 0) || Number(row.lastPositionSeconds || 0)), 0);
    const attendanceWindowsChecked = rangeCheckins.reduce((sum, row) => sum + (row.checkedWindowIds || []).length, 0);
    const attendanceWindowsMissed = rangeCheckins.reduce((sum, row) => sum + (row.missedWindowIds || []).length, 0);
    const dailyStrikes = rangeCheckins.filter(row => row.dailyStrikeApplied).length;
    const activeSubscriptions = prepModeFilter === 'all'
      ? users.filter(user => ['utme', 'oau', 'putme'].some(mode => hasActivePrepLicense(user, mode as PrepMode))).length
      : users.filter(user => hasActivePrepLicense(user, prepModeFilter)).length;
    const expiredSubscriptions = prepModeFilter === 'all'
      ? users.filter(user => user.subscriptionStatus === 'expired').length
      : users.filter(user => user.licenses?.[prepModeFilter]?.status === 'expired').length;
    const inactiveSubscriptions = Math.max(0, users.length - activeSubscriptions - expiredSubscriptions);
    const unreadNotifications = rangeNotifications.filter(row => !row.isRead).length;
    const pushEnabledPrefs = notificationPreferences.filter(row => row.push).length;
    const emailEnabledPrefs = notificationPreferences.filter(row => row.email).length;
    const readAnnouncements = new Set(announcementReads.map(row => `${row.announcementId}:${row.userId}`)).size;
    const publishedAnnouncements = announcements.filter(row => row.published !== false).length;
    const activeClassSessions = rangeClassSessions.filter(row => !row.isCancelled).length;
    const cancelledClassSessions = rangeClassSessions.filter(row => row.isCancelled).length;
    const redeemedKeys = filteredLicenseKeysForPrep.filter(row => row.redeemedBy || row.redeemedAt || row.status === 'redeemed').length;
    const keysCreated = rangeLicenseKeys.length;
    const rangeRedeemedKeys = rangeLicenseKeys.filter(row => row.redeemedBy || row.redeemedAt || row.status === 'redeemed').length;

    return {
      activeLearners,
      usersTotal: users.length,
      admins: users.filter(user => user.role === 'admin' || user.role === 'root-admin').length,
      verifiedUsers: users.filter(user => user.emailVerified).length,
      activeSubscriptions,
      expiredSubscriptions,
      inactiveSubscriptions,
      coursesTotal: courses.length,
      publishedCourses: courses.filter(course => course.isPublished).length,
      courseSessions: rangeCourseSessions.length,
      courseCompletionRate: safePct(completedCourseSessions, rangeCourseSessions.length),
      courseAbandonRate: safePct(abandonedCourseSessions + timedOutCourseSessions, rangeCourseSessions.length),
      averageCourseProgress: average(rangeCourseSessions.map(row => Number(row.progressPercent || 0))),
      averageCourseMinutes: average(rangeCourseSessions.map(row => Number(row.elapsedSeconds || 0))) / 60,
      topCourses: countBy(rangeCourseSessions, row => row.courseTitle).slice(0, 6),
      videoLessonsTotal: videoLessons.length,
      publishedVideos: videoLessons.filter(lesson => lesson.isPublished !== false && lesson.visibility !== 'draft').length,
      videoLearners: new Set(rangeVideoProgress.map(row => row.userId)).size,
      videoCompletions,
      videoCompletionRate: safePct(videoCompletions, rangeVideoProgress.length),
      videoBookmarks,
      videoWatchHours: videoWatchSeconds / 3600,
      topVideoCourses: countBy(rangeVideoProgress, row => row.course).slice(0, 6),
      attendanceMembers: attendanceMembers.length,
      blacklistedMembers: attendanceBlacklist.length || attendanceMembers.filter(row => row.blacklisted).length,
      attendanceRecords: rangeCheckins.length,
      attendanceWindowCompletion: safePct(attendanceWindowsChecked, attendanceWindowsChecked + attendanceWindowsMissed),
      dailyStrikes,
      strikeRiskMembers: attendanceMembers.filter(row => !row.blacklisted && Number(row.strikeCount || 0) > 0).length,
      announcements: rangeAnnouncements.length,
      publishedAnnouncements,
      announcementReadEvents: readAnnouncements,
      notificationVolume: rangeNotifications.length,
      unreadNotifications,
      notificationReadRate: safePct(rangeNotifications.length - unreadNotifications, rangeNotifications.length),
      pushEnabledPrefs,
      emailEnabledPrefs,
      pushSubscriptions: pushSubscriptions.length,
      classSessions: rangeClassSessions.length,
      activeClassSessions,
      cancelledClassSessions,
      communityProfiles: communityProfiles.length,
      discoverableProfiles: communityProfiles.filter(profile => profile.discoverable).length,
      forumThreads: rangeForumThreads.length,
      forumReplies: forumThreads.reduce((sum, thread) => sum + Number(thread.replyCount || 0), 0),
      friendRequests: rangeFriendRequests.length,
      friendships: friendships.length,
      licenseKeys: filteredLicenseKeysForPrep.length,
      redeemedKeys,
      keysCreated,
      keysRedeemed: rangeRedeemedKeys,
      keyRedemptionRate: safePct(redeemedKeys, filteredLicenseKeysForPrep.length)
    };
  }, [
    announcements,
    announcementReads,
    attendanceBlacklist,
    attendanceCheckins,
    attendanceMembers,
    classSessions,
    communityProfiles,
    courseSessions,
    courses,
    filteredResults,
    forumThreads,
    friendRequests,
    friendships,
    filteredLicenseKeysForPrep,
    notificationPreferences,
    notifications,
    pushSubscriptions,
    rangeFilter,
    prepModeFilter,
    users,
    videoLessons,
    videoProgress
  ]);

  const insights = useMemo(() => {
    const items: { title: string; detail: string; tone: string }[] = [];
    const riskiestTest = testRows[0];
    if (riskiestTest) {
      items.push({
        title: 'Highest-risk test',
        detail: `${riskiestTest.testName} has ${fmtPct(riskiestTest.passRate)} pass rate, ${fmtPct(riskiestTest.completionRate)} completion, and ${riskiestTest.attempts} attempt(s).`,
        tone: riskiestTest.riskScore >= 45 ? 'text-rose-600' : 'text-amber-600'
      });
    }
    const weakestSubject = subjectRows[0];
    if (weakestSubject) {
      items.push({
        title: 'Weakest subject',
        detail: `${weakestSubject.subject} is averaging ${fmtPct(weakestSubject.correctRate)} correct across ${fmtNumber(weakestSubject.attempts)} question exposures.`,
        tone: weakestSubject.correctRate < PASS_MARK ? 'text-rose-600' : 'text-amber-600'
      });
    }
    const skipped = mostSkippedQuestions[0];
    if (skipped && skipped.unattemptedRate >= 25) {
      items.push({
        title: 'Skip pattern',
        detail: `${skipped.subject} has a question skipped by ${fmtPct(skipped.unattemptedRate)} of candidates; check wording, length, or placement.`,
        tone: 'text-sky-700'
      });
    }
    if (kpis.abandonmentRate + kpis.autoSubmitRate >= 15) {
      items.push({
        title: 'Completion pressure',
        detail: `${fmtPct(kpis.abandonmentRate + kpis.autoSubmitRate)} of attempts are abandoned or auto-submitted in this view.`,
        tone: 'text-rose-600'
      });
    }
    if (ecosystem.attendanceWindowCompletion > 0 && ecosystem.attendanceWindowCompletion < 75) {
      items.push({
        title: 'Attendance reliability',
        detail: `Attendance window completion is ${fmtPct(ecosystem.attendanceWindowCompletion)} with ${fmtNumber(ecosystem.dailyStrikes)} strike day(s) in range.`,
        tone: 'text-rose-600'
      });
    }
    if (ecosystem.courseSessions > 0 && ecosystem.courseAbandonRate >= 25) {
      items.push({
        title: 'Course completion drag',
        detail: `${fmtPct(ecosystem.courseAbandonRate)} of course sessions are abandoned or timed out in the current range.`,
        tone: 'text-amber-700'
      });
    }
    if (ecosystem.notificationVolume > 0 && ecosystem.notificationReadRate < 60) {
      items.push({
        title: 'Notification reach',
        detail: `Notification read rate is ${fmtPct(ecosystem.notificationReadRate)} across ${fmtNumber(ecosystem.notificationVolume)} delivered in-app item(s).`,
        tone: 'text-sky-700'
      });
    }
    if (items.length === 0) {
      items.push({
        title: 'No major risk signal',
        detail: 'Current filters do not show a strong quality or completion issue.',
        tone: 'text-emerald-600'
      });
    }
    return items.slice(0, 4);
  }, [testRows, subjectRows, mostSkippedQuestions, kpis, ecosystem]);

  const maxTrendAttempts = Math.max(...trendRows.map(row => row.attempts), 1);
  const maxDistributionCount = Math.max(...scoreDistribution.map(row => row.count), 1);
  const prepSummaryPrefix = prepModeFilter === 'all' ? 'all prep modes' : PREP_MODE_LABELS[prepModeFilter];
  const loadedSummary = `${prepSummaryPrefix}: ${fmtNumber(filteredResultsForPrep.length)} result(s), ${fmtNumber(filteredTestsForPrep.length)} test(s), ${fmtNumber(filteredQuestionsForPrep.length)} question(s), ${fmtNumber(users.length)} user(s), ${fmtNumber(courses.length)} course(s), ${fmtNumber(videoLessons.length)} video(s)`;

  const KpiCard = ({ label, value, delta, suffix }: { label: string; value: string; delta?: number; suffix?: string }) => (
    <div className="bg-white border border-slate-100 rounded-2xl p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="text-2xl font-black text-slate-900 mt-2">{value}</p>
      {delta !== undefined && rangeFilter !== 'all' && (
        <p className={`text-xs font-bold uppercase tracking-widest mt-2 ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
          {deltaLabel(delta)}{suffix || ''} vs prior period
        </p>
      )}
    </div>
  );

  const MetricTile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="p-4 bg-slate-50 rounded-xl">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="text-xl font-black text-slate-900 mt-1">{value}</p>
      {sub && <p className="text-xs font-bold text-slate-500 mt-1">{sub}</p>}
    </div>
  );

  const RankedList = ({ rows, empty }: { rows: Array<{ name: string; count: number }>; empty: string }) => (
    <div className="space-y-2">
      {rows.map(row => (
        <div key={row.name} className="flex justify-between gap-3 text-sm">
          <span className="font-bold text-slate-900 truncate">{row.name}</span>
          <span className="font-bold text-slate-500">{fmtNumber(row.count)}</span>
        </div>
      ))}
      {rows.length === 0 && <p className="text-xs font-bold uppercase text-slate-400">{empty}</p>}
    </div>
  );

  return (
    <div className="v2-page space-y-6">
      <div className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm">
        <div className="flex flex-col xl:flex-row xl:items-end gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3 flex-1">
            <label className="m-0">
              <span className="sr-only">Range</span>
              <select className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold" value={rangeFilter} onChange={(e) => setRangeFilter(e.target.value as RangeFilter)}>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="all">All time</option>
              </select>
            </label>

            <label className="m-0">
              <span className="sr-only">Status</span>
              <select className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="all">All statuses</option>
                <option value="completed">Completed</option>
                <option value="auto-submitted">Auto-submitted</option>
                <option value="abandoned">Abandoned</option>
              </select>
            </label>

            <label className="m-0">
              <span className="sr-only">Quality</span>
              <select className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold" value={qualityFilter} onChange={(e) => setQualityFilter(e.target.value as QualityFilter)}>
                <option value="all">All outcomes</option>
                <option value="passed">Passed only</option>
                <option value="failed">Failed only</option>
                <option value="incomplete">Incomplete only</option>
              </select>
            </label>

            <label className="m-0">
              <span className="sr-only">Test</span>
              <select className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold" value={testFilter} onChange={(e) => setTestFilter(e.target.value)}>
                <option value="all">All tests</option>
                {filteredTestsForPrep.map(test => (
                  <option key={test.id} value={test.id}>{test.name}</option>
                ))}
              </select>
            </label>

            <label className="m-0">
              <span className="sr-only">Candidate</span>
              <select className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
                <option value="all">All candidates</option>
                {userOptions.map(user => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
            </label>

            <label className="m-0">
              <span className="sr-only">Subject</span>
              <select className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold" value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
                <option value="all">All subjects</option>
                {subjectOptions.map(subject => (
                  <option key={subject} value={subject}>{subject}</option>
                ))}
              </select>
            </label>
          </div>

          <button onClick={loadAnalyticsData} className="px-5 py-3 bg-slate-950 text-amber-500 rounded-xl text-xs font-bold uppercase tracking-widest">
            Refresh
          </button>
        </div>
        <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Showing {fmtNumber(filteredResults.length)} of {loadedSummary}
          </p>
          {loadedAt && (
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Updated {new Date(loadedAt).toLocaleString()}</p>
          )}
        </div>
        {loadError && (
          <p className="mt-3 text-xs font-bold uppercase tracking-widest text-red-600">{loadError}</p>
        )}
        {loadWarnings.length > 0 && (
          <p className="mt-3 text-xs font-bold uppercase tracking-widest text-amber-700">
            Partial data: {loadWarnings.slice(0, 3).join(' | ')}{loadWarnings.length > 3 ? ` +${loadWarnings.length - 3} more` : ''}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="bg-white border border-slate-100 rounded-[2rem] p-12 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">
          Loading analytics...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard label="Total Attempts" value={fmtNumber(kpis.attempts)} delta={kpis.attempts - previousKpis.attempts} />
            <KpiCard label="Unique Candidates" value={fmtNumber(kpis.uniqueCandidates)} delta={kpis.uniqueCandidates - previousKpis.uniqueCandidates} />
            <KpiCard label="Average Score" value={fmtPct(kpis.avgScorePct)} delta={kpis.avgScorePct - previousKpis.avgScorePct} suffix=" pts" />
            <KpiCard label="Median Score" value={fmtPct(kpis.medianScorePct)} delta={kpis.medianScorePct - previousKpis.medianScorePct} suffix=" pts" />
            <KpiCard label="Pass Rate" value={fmtPct(kpis.passRate)} delta={kpis.passRate - previousKpis.passRate} suffix=" pts" />
            <KpiCard label="Excellent Rate" value={fmtPct(kpis.excellentRate)} delta={kpis.excellentRate - previousKpis.excellentRate} suffix=" pts" />
            <KpiCard label="Answer Completion" value={fmtPct(kpis.completionRate)} delta={kpis.completionRate - previousKpis.completionRate} suffix=" pts" />
            <KpiCard label="Abandoned / Auto" value={fmtPct(kpis.abandonmentRate + kpis.autoSubmitRate)} delta={(kpis.abandonmentRate + kpis.autoSubmitRate) - (previousKpis.abandonmentRate + previousKpis.autoSubmitRate)} suffix=" pts" />
          </div>

          <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-5">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900">App-Wide Health</h3>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Range-aware across exams, courses, videos, attendance, and communications</p>
            </div>
            <div className="grid grid-cols-2 xl:grid-cols-6 gap-4">
              <MetricTile label="Active Learners" value={fmtNumber(ecosystem.activeLearners)} sub={`${fmtNumber(ecosystem.usersTotal)} total users`} />
              <MetricTile label="Course Sessions" value={fmtNumber(ecosystem.courseSessions)} sub={`${fmtPct(ecosystem.courseCompletionRate)} complete`} />
              <MetricTile label="Video Learners" value={fmtNumber(ecosystem.videoLearners)} sub={`${fmtNumber(ecosystem.videoCompletions)} completions`} />
              <MetricTile label="Attendance" value={fmtPct(ecosystem.attendanceWindowCompletion)} sub={`${fmtNumber(ecosystem.dailyStrikes)} strike days`} />
              <MetricTile label="Notifications" value={fmtPct(ecosystem.notificationReadRate)} sub={`${fmtNumber(ecosystem.unreadNotifications)} unread`} />
              <MetricTile label="Community" value={fmtNumber(ecosystem.forumThreads + ecosystem.friendRequests)} sub={`${fmtNumber(ecosystem.friendships)} friendships`} />
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Course Learning</h3>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <MetricTile label="Published" value={fmtNumber(ecosystem.publishedCourses)} sub={`${fmtNumber(ecosystem.coursesTotal)} total`} />
                <MetricTile label="Avg Progress" value={fmtPct(ecosystem.averageCourseProgress)} sub={`${ecosystem.averageCourseMinutes.toFixed(1)} avg mins`} />
                <MetricTile label="Drop-Off" value={fmtPct(ecosystem.courseAbandonRate)} sub="abandoned/timed out" />
                <MetricTile label="Sessions" value={fmtNumber(ecosystem.courseSessions)} sub="current range" />
              </div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Top Courses</h4>
              <RankedList rows={ecosystem.topCourses} empty="No course session data." />
            </div>

            <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Video Learning</h3>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <MetricTile label="Published" value={fmtNumber(ecosystem.publishedVideos)} sub={`${fmtNumber(ecosystem.videoLessonsTotal)} lessons`} />
                <MetricTile label="Completion" value={fmtPct(ecosystem.videoCompletionRate)} sub={`${fmtNumber(ecosystem.videoBookmarks)} bookmarks`} />
                <MetricTile label="Watch Time" value={ecosystem.videoWatchHours.toFixed(1)} sub="hours resumed" />
                <MetricTile label="Learners" value={fmtNumber(ecosystem.videoLearners)} sub="current range" />
              </div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Top Video Courses</h4>
              <RankedList rows={ecosystem.topVideoCourses} empty="No video progress data." />
            </div>

            <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Attendance & Access</h3>
              <div className="grid grid-cols-2 gap-3">
                <MetricTile label="Members" value={fmtNumber(ecosystem.attendanceMembers)} sub={`${fmtNumber(ecosystem.blacklistedMembers)} blacklisted`} />
                <MetricTile label="Records" value={fmtNumber(ecosystem.attendanceRecords)} sub="current range" />
                <MetricTile label="Strike Risk" value={fmtNumber(ecosystem.strikeRiskMembers)} sub="non-blacklisted" />
                <MetricTile label="Active Subs" value={fmtNumber(ecosystem.activeSubscriptions)} sub={`${fmtNumber(ecosystem.expiredSubscriptions)} expired`} />
                <MetricTile label="Keys Created" value={fmtNumber(ecosystem.keysCreated)} sub="current range" />
                <MetricTile label="Key Redeem" value={fmtPct(ecosystem.keyRedemptionRate)} sub={`${fmtNumber(ecosystem.redeemedKeys)} redeemed`} />
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Communication & Class Operations</h3>
            <div className="grid grid-cols-2 xl:grid-cols-8 gap-4">
              <MetricTile label="Announcements" value={fmtNumber(ecosystem.announcements)} sub={`${fmtNumber(ecosystem.publishedAnnouncements)} published total`} />
              <MetricTile label="Read Events" value={fmtNumber(ecosystem.announcementReadEvents)} sub="announcement reads" />
              <MetricTile label="Class Sessions" value={fmtNumber(ecosystem.classSessions)} sub={`${fmtNumber(ecosystem.cancelledClassSessions)} cancelled`} />
              <MetricTile label="Notify Volume" value={fmtNumber(ecosystem.notificationVolume)} sub={`${fmtPct(ecosystem.notificationReadRate)} read`} />
              <MetricTile label="Push Subs" value={fmtNumber(ecosystem.pushSubscriptions)} sub={`${fmtNumber(ecosystem.pushEnabledPrefs)} push prefs`} />
              <MetricTile label="Profiles" value={fmtNumber(ecosystem.communityProfiles)} sub={`${fmtNumber(ecosystem.discoverableProfiles)} discoverable`} />
              <MetricTile label="Forum Replies" value={fmtNumber(ecosystem.forumReplies)} sub={`${fmtNumber(ecosystem.forumThreads)} active threads`} />
              <MetricTile label="Friend Requests" value={fmtNumber(ecosystem.friendRequests)} sub="current range" />
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="bg-white border border-slate-100 rounded-[2rem] p-6 xl:col-span-2">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Daily Performance</h3>
              <div className="space-y-3 max-h-80 overflow-y-auto pr-2">
                {trendRows.length === 0 && <p className="text-xs font-bold text-slate-400 uppercase">No data for current filters.</p>}
                {trendRows.map(row => (
                  <div key={row.date} className="space-y-2">
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1 text-xs font-bold text-slate-500">
                      <span>{row.date}</span>
                      <span>{row.attempts} attempts - {fmtPct(row.avgScore)} avg - {fmtPct(row.passRate)} pass</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-amber-500" style={{ width: `${safePct(row.attempts, maxTrendAttempts)}%` }}></div></div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-slate-900" style={{ width: `${clamp(row.avgScore)}%` }}></div></div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${clamp(row.completionRate)}%` }}></div></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Score Distribution</h3>
              <div className="space-y-4">
                {scoreDistribution.map(row => (
                  <div key={row.label}>
                    <div className="flex justify-between text-xs font-bold uppercase text-slate-500 mb-1">
                      <span>{row.label}%</span>
                      <span>{fmtNumber(row.count)}</span>
                    </div>
                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${row.tone}`} style={{ width: `${safePct(row.count, maxDistributionCount)}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 space-y-3">
                {insights.map((item) => (
                  <div key={item.title} className="p-3 bg-slate-50 rounded-xl">
                    <p className={`text-xs font-black uppercase tracking-widest ${item.tone}`}>{item.title}</p>
                    <p className="text-xs font-bold text-slate-600 mt-1 leading-relaxed">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Test-Level Risk</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[1100px]">
                <thead>
                  <tr className="text-xs font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
                    <th className="py-3 pr-4">Test</th>
                    <th className="py-3 pr-4">Attempts</th>
                    <th className="py-3 pr-4">Candidates</th>
                    <th className="py-3 pr-4">Avg</th>
                    <th className="py-3 pr-4">Median</th>
                    <th className="py-3 pr-4">Pass</th>
                    <th className="py-3 pr-4">Completion</th>
                    <th className="py-3 pr-4">Retake</th>
                    <th className="py-3 pr-4">Risk</th>
                    <th className="py-3 pr-4">Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {testRows.map(row => (
                    <tr key={row.testId} className="border-b border-slate-50 text-sm">
                      <td className="py-3 pr-4 font-bold text-slate-900">{row.testName}</td>
                      <td className="py-3 pr-4">{fmtNumber(row.attempts)}</td>
                      <td className="py-3 pr-4">{fmtNumber(row.uniqueUsers)}</td>
                      <td className="py-3 pr-4">{fmtPct(row.avgScore)}</td>
                      <td className="py-3 pr-4">{fmtPct(row.medianScore)}</td>
                      <td className="py-3 pr-4">{fmtPct(row.passRate)}</td>
                      <td className="py-3 pr-4">{fmtPct(row.completionRate)}</td>
                      <td className="py-3 pr-4">{fmtPct(row.retakeRate)}</td>
                      <td className={`py-3 pr-4 font-black ${row.riskScore >= 45 ? 'text-rose-600' : 'text-amber-600'}`}>{fmtPct(row.riskScore)}</td>
                      <td className="py-3 pr-4">{formatDate(row.lastActivity)}</td>
                    </tr>
                  ))}
                  {testRows.length === 0 && (
                    <tr>
                      <td className="py-8 text-xs font-bold uppercase text-slate-400" colSpan={10}>No tests in current filter set.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Subject Mastery</h3>
              <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                {subjectRows.slice(0, 12).map(subject => (
                  <div key={subject.subject}>
                    <div className="flex justify-between text-xs font-bold uppercase text-slate-500 mb-1">
                      <span>{subject.subject}</span>
                      <span>{fmtPct(subject.correctRate)} correct - {fmtPct(subject.skipRate)} skipped</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-slate-900" style={{ width: `${clamp(subject.correctRate)}%` }}></div>
                    </div>
                    <p className="text-xs font-bold text-slate-400 mt-1">{fmtNumber(subject.questions)} question(s), {fmtNumber(subject.attempts)} exposure(s)</p>
                  </div>
                ))}
                {subjectRows.length === 0 && <p className="text-xs font-bold uppercase text-slate-400">No subject data for filters.</p>}
              </div>
            </div>

            <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Candidates Needing Attention</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                {atRiskStudents.map(student => (
                  <div key={student.userId} className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl">
                    <div>
                      <p className="text-xs font-bold text-slate-900 uppercase">{student.name}</p>
                      <p className="text-xs font-bold uppercase text-slate-400">{student.attempts} attempts - last {formatDate(student.lastActivity)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-slate-900">{fmtPct(student.avg)} avg</p>
                      <p className={`text-xs font-bold uppercase ${student.riskScore >= 50 ? 'text-rose-600' : 'text-amber-600'}`}>{fmtPct(student.riskScore)} risk</p>
                    </div>
                  </div>
                ))}
                {atRiskStudents.length === 0 && <p className="text-xs font-bold uppercase text-slate-400">No candidate risk rows for filters.</p>}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowMore((prev) => !prev)}
            >
              {showMore ? 'Show Less' : 'Show More'}
            </button>
          </div>

          {showMore && (
            <>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Section Difficulty</h3>
                  <div className="space-y-3">
                    {sectionRows.slice(0, 12).map(section => (
                      <div key={section.name}>
                        <div className="flex justify-between text-xs font-bold uppercase text-slate-500 mb-1">
                          <span>{section.name}</span>
                          <span>{fmtPct(section.avgPct)} avg - {fmtPct(section.passRate)} pass</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-500" style={{ width: `${clamp(section.avgPct)}%` }}></div>
                        </div>
                      </div>
                    ))}
                    {sectionRows.length === 0 && <p className="text-xs font-bold uppercase text-slate-400">No section data for filters.</p>}
                  </div>
                </div>

                <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Top Students</h3>
                  <div className="space-y-2">
                    {topStudents.map(student => (
                      <div key={student.userId} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                        <div>
                          <p className="text-xs font-bold text-slate-900 uppercase">{student.name}</p>
                          <p className="text-xs font-bold uppercase text-slate-400">{student.attempts} attempts - {fmtPct(student.completionRate)} completion</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-slate-900">{fmtPct(student.best)}</p>
                          <p className={`text-xs font-bold uppercase ${student.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {deltaLabel(student.delta)} pts trend
                          </p>
                        </div>
                      </div>
                    ))}
                    {topStudents.length === 0 && <p className="text-xs font-bold uppercase text-slate-400">No student rows for filters.</p>}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Hardest Questions</h3>
                  <div className="space-y-3">
                    {hardestQuestions.map(question => (
                      <div key={question.id} className="p-3 bg-slate-50 rounded-xl">
                        <p className="text-xs font-bold uppercase text-amber-600">{question.subject} - {question.topic}</p>
                        <p className="text-xs font-bold text-slate-800 line-clamp-2 mt-1">{question.prompt}</p>
                        <p className="text-xs font-bold uppercase text-slate-500 mt-2">Correct: {fmtPct(question.correctRate)} - Attempts: {question.attempts}</p>
                      </div>
                    ))}
                    {hardestQuestions.length === 0 && <p className="text-xs font-bold uppercase text-slate-400">Not enough question-level attempts.</p>}
                  </div>
                </div>

                <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Most Skipped</h3>
                  <div className="space-y-3">
                    {mostSkippedQuestions.map(question => (
                      <div key={question.id} className="p-3 bg-slate-50 rounded-xl">
                        <p className="text-xs font-bold uppercase text-amber-600">{question.subject} - {question.difficulty}</p>
                        <p className="text-xs font-bold text-slate-800 line-clamp-2 mt-1">{question.prompt}</p>
                        <p className="text-xs font-bold uppercase text-slate-500 mt-2">Skipped: {fmtPct(question.unattemptedRate)} - Attempts: {question.attempts}</p>
                      </div>
                    ))}
                    {mostSkippedQuestions.length === 0 && <p className="text-xs font-bold uppercase text-slate-400">Not enough skipped-question data.</p>}
                  </div>
                </div>

                <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Distractor Flags</h3>
                  <div className="space-y-3">
                    {strongestDistractors.map(question => (
                      <div key={question.id} className="p-3 bg-slate-50 rounded-xl">
                        <p className="text-xs font-bold uppercase text-amber-600">{question.subject} - Correct {String.fromCharCode(65 + question.correctIndex)}</p>
                        <p className="text-xs font-bold text-slate-800 line-clamp-2 mt-1">{question.prompt}</p>
                        <p className="text-xs font-bold uppercase text-slate-500 mt-2">
                          Distractor pull: {fmtPct(question.distractorRate)} - A{question.optionCounts[0] || 0} B{question.optionCounts[1] || 0} C{question.optionCounts[2] || 0} D{question.optionCounts[3] || 0}
                        </p>
                      </div>
                    ))}
                    {strongestDistractors.length === 0 && <p className="text-xs font-bold uppercase text-slate-400">Not enough distractor data.</p>}
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-100 rounded-[2rem] p-6">
                <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4">Operational Snapshot</h3>
                <div className="grid grid-cols-2 xl:grid-cols-6 gap-4 mb-6">
                  <div className="p-4 bg-slate-50 rounded-xl"><p className="text-xs font-bold uppercase text-slate-400">Active Tests</p><p className="text-2xl font-black text-slate-900">{operational.activeTests}</p></div>
                  <div className="p-4 bg-slate-50 rounded-xl"><p className="text-xs font-bold uppercase text-slate-400">Paused Tests</p><p className="text-2xl font-black text-slate-900">{operational.pausedTests}</p></div>
                  <div className="p-4 bg-slate-50 rounded-xl"><p className="text-xs font-bold uppercase text-slate-400">Archived Tests</p><p className="text-2xl font-black text-slate-900">{operational.archivedTests}</p></div>
                  <div className="p-4 bg-slate-50 rounded-xl"><p className="text-xs font-bold uppercase text-slate-400">Approved Tests</p><p className="text-2xl font-black text-slate-900">{operational.approvedTests}</p></div>
                  <div className="p-4 bg-slate-50 rounded-xl"><p className="text-xs font-bold uppercase text-slate-400">Dynamic Tests</p><p className="text-2xl font-black text-slate-900">{operational.dynamicTests}</p></div>
                  <div className="p-4 bg-slate-50 rounded-xl"><p className="text-xs font-bold uppercase text-slate-400">Questions Added 30d</p><p className="text-2xl font-black text-slate-900">{operational.questionsLast30d}</p></div>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-xl">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3">Question Bank Subjects</h4>
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
                    <h4 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3">Question Bank Topics</h4>
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
        </>
      )}
    </div>
  );
};

export default AdminAnalytics;
