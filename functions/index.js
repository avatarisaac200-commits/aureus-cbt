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
