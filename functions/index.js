const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
let webpush = null;

try {
  webpush = require('web-push');
} catch (err) {
  logger.warn('web-push not installed; browser push delivery disabled.');
}

admin.initializeApp();
const db = admin.firestore();
const WEB_PUSH_PUBLIC_KEY = process.env.WEB_PUSH_PUBLIC_KEY || '';
const WEB_PUSH_PRIVATE_KEY = process.env.WEB_PUSH_PRIVATE_KEY || '';
const WEB_PUSH_SUBJECT = process.env.WEB_PUSH_SUBJECT || 'mailto:support@example.com';

if (webpush && WEB_PUSH_PUBLIC_KEY && WEB_PUSH_PRIVATE_KEY) {
  webpush.setVapidDetails(WEB_PUSH_SUBJECT, WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY);
}

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
const toFixedTwo = (value) => Number(Number(value || 0).toFixed(2));
const toSortableTime = (value) => {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
};
const padNumber = (value, width) => String(Math.max(0, Math.trunc(value))).padStart(width, '0');
const toIso = (value) => {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
};
const toLeaderboardSortKey = ({ averagePercent, bestPercent, attempts, lastCompletedAt }) => {
  const avgBasisPoints = Math.round(clampPercent(averagePercent) * 100);
  const bestBasisPoints = Math.round(clampPercent(bestPercent) * 100);
  const lastCompletedMs = toSortableTime(lastCompletedAt);

  return [
    padNumber(avgBasisPoints, 5),
    padNumber(bestBasisPoints, 5),
    padNumber(Math.min(Math.max(0, Number(attempts) || 0), 99999), 5),
    padNumber(Math.min(lastCompletedMs, 9999999999999), 13)
  ].join(':');
};

const toTestLeaderboardPublicRow = (row) => {
  const score = Number(row?.score || 0);
  const maxScore = Number(row?.maxScore || 0);
  return {
    userId: String(row?.userId || ''),
    userName: typeof row?.userName === 'string' && row.userName.trim() ? row.userName.trim() : 'Unknown User',
    testId: String(row?.testId || ''),
    testName: typeof row?.testName === 'string' ? row.testName : '',
    score,
    maxScore,
    scorePercent: maxScore > 0 ? toFixedTwo((score / maxScore) * 100) : 0,
    completedAt: typeof row?.completedAt === 'string' ? row.completedAt : '',
    status: typeof row?.status === 'string' ? row.status : 'completed'
  };
};

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
  let lastCompletedAt = '';

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
    const completedAt = typeof row.completedAt === 'string' ? row.completedAt : '';
    if (toSortableTime(completedAt) >= toSortableTime(lastCompletedAt)) {
      lastCompletedAt = completedAt;
    }
  });

  const ref = db.collection('leaderboardPublic').doc(userId);
  if (attempts === 0) {
    await ref.delete().catch(() => undefined);
    return;
  }

  const averagePercent = attempts > 0 ? totalPercent / attempts : 0;
  const leaderboardRow = {
    userId,
    userName: latestName,
    attempts,
    averagePercent: toFixedTwo(averagePercent),
    bestPercent: toFixedTwo(bestPercent),
    lastCompletedAt,
    sortKey: toLeaderboardSortKey({
      averagePercent,
      bestPercent,
      attempts,
      lastCompletedAt
    }),
    updatedAt: new Date().toISOString()
  };

  await ref.set({
    ...leaderboardRow
  }, { merge: true });
};

exports.syncLeaderboardPublicOnResultWrite = onDocumentWritten('results/{resultId}', async (event) => {
  try {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const affectedUserIds = new Set();
    const testLeaderboardRef = db.collection('testLeaderboardPublic').doc(event.params.resultId);

    if (before?.userId) affectedUserIds.add(String(before.userId));
    if (after?.userId) affectedUserIds.add(String(after.userId));

    const writes = Array.from(affectedUserIds).map((uid) => recomputeUserLeaderboard(uid));
    if (after?.userId && after?.testId) {
      writes.push(testLeaderboardRef.set(toTestLeaderboardPublicRow(after), { merge: true }));
    } else {
      writes.push(testLeaderboardRef.delete().catch(() => undefined));
    }

    await Promise.all(writes);
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

const getEnrollmentUserIds = async (courseId) => {
  if (!courseId) return [];
  const snap = await db.collection('courseEnrollmentsPublic').where('courseId', '==', courseId).get();
  return Array.from(new Set(snap.docs.map((docSnap) => String(docSnap.data()?.userId || '')).filter(Boolean)));
};

const getAnnouncementRecipients = async (announcement) => {
  const enrolledUserIds = await getEnrollmentUserIds(String(announcement?.classId || ''));
  if (!Array.isArray(announcement?.targetIds) || announcement.targetAudience === 'all') {
    return enrolledUserIds;
  }
  const allowed = new Set(announcement.targetIds.map((value) => String(value)));
  return enrolledUserIds.filter((userId) => allowed.has(userId));
};

const getNotificationPreference = async (userId, type) => {
  const snap = await db.collection('notificationPreferences')
    .where('userId', '==', userId)
    .where('notificationType', '==', type)
    .limit(1)
    .get();
  if (snap.empty) {
    return { inApp: true, push: true, email: false };
  }
  return snap.docs[0].data() || { inApp: true, push: true, email: false };
};

const sendWebPushToUser = async (userId, payload, attempt = 0) => {
  if (!webpush || !WEB_PUSH_PUBLIC_KEY || !WEB_PUSH_PRIVATE_KEY) return;
  const subscriptionsSnap = await db.collection('pushSubscriptions').where('userId', '==', userId).get();
  if (subscriptionsSnap.empty) return;

  await Promise.all(subscriptionsSnap.docs.map(async (docSnap) => {
    const sub = docSnap.data() || {};
    const subscription = {
      endpoint: sub.endpoint,
      keys: sub.keys || {}
    };
    if (!subscription.endpoint) return;
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
    } catch (err) {
      const statusCode = err?.statusCode || 0;
      if (attempt < 2) {
        const delayMs = [2000, 4000, 8000][attempt] || 8000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return sendWebPushToUser(userId, payload, attempt + 1);
      }
      await docSnap.ref.set({
        lastErrorAt: new Date().toISOString(),
        lastErrorCode: statusCode || 'send-failed'
      }, { merge: true });
    }
  }));
};

const createNotificationRecords = async (userIds, type, title, body, data = {}) => {
  const uniqueUserIds = Array.from(new Set((userIds || []).map((value) => String(value)).filter(Boolean)));
  if (uniqueUserIds.length === 0) return;

  await Promise.all(uniqueUserIds.map(async (userId) => {
    const pref = await getNotificationPreference(userId, type);
    if (!pref.inApp && !pref.push) return;

    await db.collection('notifications').add({
      userId,
      type,
      title,
      body,
      data,
      isRead: false,
      createdAt: new Date().toISOString()
    });

    if (pref.push) {
      await sendWebPushToUser(userId, {
        title,
        body,
        url: '/',
        data
      });
    }
  }));
};

const shouldNotifyAnnouncement = (before, after) => {
  if (!after || after.published === false) return false;
  if (!before) return true;
  if (before.published === false && after.published === true) return true;
  return String(before.title || '') !== String(after.title || '')
    || String(before.body || '') !== String(after.body || '')
    || String(before.updatedAt || '') !== String(after.updatedAt || '');
};

const shouldNotifySession = (before, after) => {
  if (!after || after.isCancelled) return false;
  if (!before) return true;
  return ['title', 'startTime', 'endTime', 'location', 'updatedAt'].some((key) => String(before[key] || '') !== String(after[key] || ''));
};

const getUpcomingRecurringOccurrence = (session, windowStartMs, windowEndMs) => {
  const startMs = Date.parse(String(session?.startTime || ''));
  const endMs = Date.parse(String(session?.endTime || ''));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const durationMs = Math.max(0, endMs - startMs);
  const baseDate = new Date(startMs);
  const recurrenceEndMs = Date.parse(String(session?.recurrenceEndDate || '')) || windowEndMs;

  for (let cursorMs = windowStartMs; cursorMs <= windowEndMs; cursorMs += 60 * 1000) {
    const cursor = new Date(cursorMs);
    if (cursorMs > recurrenceEndMs) break;
    const candidate = new Date(cursor);
    candidate.setSeconds(0, 0);
    candidate.setHours(baseDate.getHours(), baseDate.getMinutes(), 0, 0);
    const weekday = candidate.getDay();
    const isMatch = session.recurrence === 'weekly'
      ? weekday === baseDate.getDay()
      : Array.isArray(session.recurrenceDays) && session.recurrenceDays.includes(weekday);
    if (!isMatch || candidate.getTime() < startMs) continue;
    if (candidate.getTime() >= windowStartMs && candidate.getTime() <= windowEndMs) {
      return {
        startTime: candidate.toISOString(),
        endTime: new Date(candidate.getTime() + durationMs).toISOString()
      };
    }
  }
  return null;
};

exports.notifyOnAnnouncementWrite = onDocumentWritten('announcements/{announcementId}', async (event) => {
  try {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!shouldNotifyAnnouncement(before, after)) return;
    const recipients = await getAnnouncementRecipients(after);
    await createNotificationRecords(
      recipients,
      'announcement_posted',
      String(after.title || 'New announcement'),
      String(after.bodyPreview || 'A new class announcement was posted.'),
      { classId: String(after.classId || ''), announcementId: String(event.params.announcementId || '') }
    );
  } catch (err) {
    logger.error('notifyOnAnnouncementWrite failed', err);
  }
});

exports.notifyOnClassSessionWrite = onDocumentWritten('classSessions/{sessionId}', async (event) => {
  try {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!shouldNotifySession(before, after)) return;
    const recipients = await getEnrollmentUserIds(String(after.classId || ''));
    await createNotificationRecords(
      recipients,
      'schedule_updated',
      String(after.title || 'Schedule updated'),
      `Class schedule updated for ${String(after.classTitle || 'your class')}.`,
      { classId: String(after.classId || ''), sessionId: String(event.params.sessionId || ''), startTime: String(after.startTime || '') }
    );
  } catch (err) {
    logger.error('notifyOnClassSessionWrite failed', err);
  }
});

exports.publishScheduledAnnouncements = onSchedule('every 1 minutes', async () => {
  try {
    const nowIso = new Date().toISOString();
    const snap = await db.collection('announcements').where('published', '==', false).limit(100).get();
    const dueDocs = snap.docs.filter((docSnap) => {
      const row = docSnap.data() || {};
      return toSortableTime(row.scheduledAt) > 0 && toSortableTime(row.scheduledAt) <= Date.now();
    });

    await Promise.all(dueDocs.map(async (docSnap) => {
      const row = docSnap.data() || {};
      await docSnap.ref.set({
        published: true,
        publishedAt: nowIso,
        updatedAt: nowIso
      }, { merge: true });
      const recipients = await getAnnouncementRecipients(row);
      await createNotificationRecords(
        recipients,
        'announcement_posted',
        String(row.title || 'New announcement'),
        String(row.bodyPreview || 'A scheduled announcement has been published.'),
        { classId: String(row.classId || ''), announcementId: docSnap.id }
      );
    }));
  } catch (err) {
    logger.error('publishScheduledAnnouncements failed', err);
  }
});

exports.sendUpcomingSessionReminders = onSchedule('every 5 minutes', async () => {
  try {
    const now = Date.now();
    const windowStartMs = now + 14 * 60 * 1000;
    const windowEndMs = now + 16 * 60 * 1000;
    const snap = await db.collection('classSessions').limit(200).get();

    await Promise.all(snap.docs.map(async (docSnap) => {
      const row = docSnap.data() || {};
      if (row.isCancelled) return;

      let nextOccurrence = null;
      if (row.recurrence && row.recurrence !== 'none') {
        nextOccurrence = getUpcomingRecurringOccurrence(row, windowStartMs, windowEndMs);
      } else {
        const startMs = toSortableTime(row.startTime);
        if (startMs >= windowStartMs && startMs <= windowEndMs) {
          nextOccurrence = {
            startTime: String(row.startTime || ''),
            endTime: String(row.endTime || '')
          };
        }
      }

      if (!nextOccurrence) return;
      const occurrenceKey = String(nextOccurrence.startTime).slice(0, 16);
      if (String(row.lastReminderOccurrence || '') === occurrenceKey) return;

      const recipients = await getEnrollmentUserIds(String(row.classId || ''));
      await createNotificationRecords(
        recipients,
        'session_reminder',
        String(row.title || 'Upcoming class session'),
        `Starts at ${new Date(nextOccurrence.startTime).toLocaleTimeString()}.`,
        { classId: String(row.classId || ''), sessionId: docSnap.id, startTime: String(nextOccurrence.startTime || '') }
      );

      await docSnap.ref.set({
        lastReminderOccurrence: occurrenceKey,
        reminderSentAt: new Date().toISOString()
      }, { merge: true });
    }));
  } catch (err) {
    logger.error('sendUpcomingSessionReminders failed', err);
  }
});
