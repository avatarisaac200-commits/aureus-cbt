const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const clampPercent = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
};

const toPercent = (score, maxScore) => {
  const max = Number(maxScore || 0);
  if (!Number.isFinite(max) || max <= 0) return null;
  const pct = (Number(score || 0) / max) * 100;
  return clampPercent(pct);
};

const toFixedOne = (value) => Number(Number(value || 0).toFixed(1));

const recomputeCourseAnalytics = async (courseId) => {
  if (!courseId || typeof courseId !== 'string') return;

  const courseRef = db.collection('courses').doc(courseId);
  const courseSnap = await courseRef.get();
  if (!courseSnap.exists) return;

  const sessionsSnap = await db.collection('courseSessions').where('courseId', '==', courseId).get();

  let sessionCount = 0;
  let completedCount = 0;
  let progressTotal = 0;
  let elapsedTotal = 0;
  const learnerIds = new Set();

  sessionsSnap.forEach((docSnap) => {
    const row = docSnap.data() || {};
    sessionCount += 1;
    if (typeof row.userId === 'string' && row.userId.trim()) {
      learnerIds.add(row.userId.trim());
    }
    if (row.status === 'completed') {
      completedCount += 1;
    }
    progressTotal += clampPercent(row.progressPercent);
    elapsedTotal += Math.max(0, Number(row.elapsedSeconds) || 0);
  });

  const enrollmentCount = learnerIds.size;
  const completionRate = sessionCount > 0 ? toFixedOne((completedCount / sessionCount) * 100) : 0;
  const averageProgressPercent = sessionCount > 0 ? toFixedOne(progressTotal / sessionCount) : 0;
  const averageElapsedSeconds = sessionCount > 0 ? Math.round(elapsedTotal / sessionCount) : 0;

  await courseRef.set({
    enrollmentCount,
    sessionCount,
    completionRate,
    averageProgressPercent,
    averageElapsedSeconds,
    analyticsUpdatedAt: new Date().toISOString()
  }, { merge: true });
};

const recomputeUserLeaderboard = async (userId) => {
  if (!userId || typeof userId !== 'string') return;

  const resultsSnap = await db.collection('results').where('userId', '==', userId).get();

  let attempts = 0;
  let totalPercent = 0;
  let bestPercent = 0;
  let latestName = 'Unknown User';

  resultsSnap.docs.forEach((docSnap) => {
    const row = docSnap.data() || {};
    const pct = toPercent(row.score, row.maxScore);
    if (pct === null) return;
    attempts += 1;
    totalPercent += pct;
    bestPercent = Math.max(bestPercent, pct);
    if (typeof row.userName === 'string' && row.userName.trim()) {
      latestName = row.userName.trim();
    }
  });

  const ref = db.collection('leaderboardPublic').doc(userId);
  if (attempts === 0) {
    await ref.delete().catch(() => undefined);
    return;
  }

  const averagePercent = attempts > 0 ? totalPercent / attempts : 0;
  await ref.set({
    userId,
    userName: latestName,
    attempts,
    averagePercent: Number(averagePercent.toFixed(2)),
    bestPercent: Number(bestPercent.toFixed(2)),
    updatedAt: new Date().toISOString()
  }, { merge: true });
};

exports.syncLeaderboardPublicOnResultWrite = onDocumentWritten('results/{resultId}', async (event) => {
  try {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const affectedUserIds = new Set();

    if (before?.userId) affectedUserIds.add(String(before.userId));
    if (after?.userId) affectedUserIds.add(String(after.userId));

    await Promise.all(Array.from(affectedUserIds).map((uid) => recomputeUserLeaderboard(uid)));
  } catch (err) {
    logger.error('syncLeaderboardPublicOnResultWrite failed', err);
  }
});

exports.syncCourseAnalyticsOnSessionWrite = onDocumentWritten('courseSessions/{sessionId}', async (event) => {
  try {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const affectedCourseIds = new Set();

    if (before?.courseId) affectedCourseIds.add(String(before.courseId));
    if (after?.courseId) affectedCourseIds.add(String(after.courseId));

    await Promise.all(Array.from(affectedCourseIds).map((courseId) => recomputeCourseAnalytics(courseId)));
  } catch (err) {
    logger.error('syncCourseAnalyticsOnSessionWrite failed', err);
  }
});
