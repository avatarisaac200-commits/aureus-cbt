import { collection, doc, getDocs, limit, query, setDoc, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { db } from '../firebase';
import { ExamResult } from '../types';

type StoredResult = Omit<ExamResult, 'id'> & { id?: string };

const clampPercent = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
const toSortableTime = (value?: string) => {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
};
const padNumber = (value: number, width: number) => String(Math.max(0, Math.trunc(value))).padStart(width, '0');

const toLeaderboardSortKey = (averagePercent: number, bestPercent: number, attempts: number, lastCompletedAt?: string) => {
  const avgBasisPoints = Math.round(clampPercent(averagePercent) * 100);
  const bestBasisPoints = Math.round(clampPercent(bestPercent) * 100);
  return [
    padNumber(avgBasisPoints, 5),
    padNumber(bestBasisPoints, 5),
    padNumber(Math.min(Math.max(0, attempts), 99999), 5),
    padNumber(Math.min(toSortableTime(lastCompletedAt), 9999999999999), 13)
  ].join(':');
};

export const toPublicLeaderboardRow = (result: StoredResult) => {
  const maxScore = Number(result.maxScore || 0);
  const score = Number(result.score || 0);
  return {
    userId: result.userId,
    userName: result.userName,
    testId: result.testId,
    testName: result.testName,
    score,
    maxScore,
    scorePercent: maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0,
    completedAt: result.completedAt,
    status: result.status
  };
};

export const refreshOwnLeaderboardPublic = async (userId: string, fallbackResult?: StoredResult) => {
  if (!userId) return;

  const snap = await getDocs(query(collection(db, 'results'), where('userId', '==', userId), limit(1000)));
  const rows = snap.docs.map(d => ({ ...d.data(), id: d.id } as StoredResult));

  if (fallbackResult?.userId === userId && !rows.some(row => row.id === fallbackResult.id)) {
    rows.push(fallbackResult);
  }

  let attempts = 0;
  let totalPercent = 0;
  let bestPercent = 0;
  let userName = fallbackResult?.userName || 'Unknown User';
  let lastCompletedAt = '';

  rows.forEach((row) => {
    const maxScore = Number(row.maxScore || 0);
    if (maxScore <= 0) return;
    const percent = clampPercent((Number(row.score || 0) / maxScore) * 100);
    attempts += 1;
    totalPercent += percent;
    bestPercent = Math.max(bestPercent, percent);
    if (row.userName?.trim()) userName = row.userName.trim();
    if (toSortableTime(row.completedAt) >= toSortableTime(lastCompletedAt)) {
      lastCompletedAt = row.completedAt;
    }
  });

  if (attempts === 0) return;

  const averagePercent = totalPercent / attempts;
  await setDoc(doc(db, 'leaderboardPublic', userId), {
    userId,
    userName,
    attempts,
    averagePercent: Number(averagePercent.toFixed(2)),
    bestPercent: Number(bestPercent.toFixed(2)),
    lastCompletedAt,
    sortKey: toLeaderboardSortKey(averagePercent, bestPercent, attempts, lastCompletedAt),
    updatedAt: new Date().toISOString()
  });
};
