import webpush from 'web-push';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
  FIREBASE_TOKEN_URI?: string;
  WEB_PUSH_PUBLIC_KEY: string;
  WEB_PUSH_PRIVATE_KEY: string;
  WEB_PUSH_SUBJECT: string;
  WORKER_RUN_SECRET?: string;
}

type FirestoreDoc = {
  name: string;
  fields?: Record<string, any>;
  createTime?: string;
  updateTime?: string;
};

type ClassSession = {
  id: string;
  classId: string;
  classTitle: string;
  title: string;
  startTime: string;
  endTime: string;
  recurrence: 'none' | 'weekly' | 'custom';
  recurrenceDays?: number[];
  recurrenceEndDate?: string;
  isCancelled?: boolean;
  lastReminderOccurrence?: string;
};

const GOOGLE_OAUTH_SCOPE = 'https://www.googleapis.com/auth/datastore';
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const FIRESTORE_API_BASE = 'https://firestore.googleapis.com/v1';

const textEncoder = new TextEncoder();

const normalizePrivateKey = (value: string) => value.replace(/\\n/g, '\n');

const base64UrlEncode = (input: ArrayBuffer | Uint8Array | string) => {
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    bytes = textEncoder.encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }

  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const pemToArrayBuffer = (pem: string) => {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

const importServiceKey = async (privateKey: string) => {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(normalizePrivateKey(privateKey)),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );
};

const createGoogleAccessToken = async (env: Env) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = base64UrlEncode(JSON.stringify({
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: GOOGLE_OAUTH_SCOPE,
    aud: env.FIREBASE_TOKEN_URI || GOOGLE_TOKEN_URI,
    exp: now + 3600,
    iat: now
  }));
  const unsignedToken = `${header}.${claimSet}`;
  const key = await importServiceKey(env.FIREBASE_PRIVATE_KEY);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, textEncoder.encode(unsignedToken));
  const assertion = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const response = await fetch(env.FIREBASE_TOKEN_URI || GOOGLE_TOKEN_URI, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  if (!response.ok) {
    throw new Error(`Google token request failed: ${response.status}`);
  }

  const payload = await response.json<any>();
  return String(payload.access_token || '');
};

const docPath = (env: Env, collection: string, docId?: string) => {
  const base = `${FIRESTORE_API_BASE}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}`;
  return docId ? `${base}/${docId}` : base;
};

const toFirestoreValue = (value: Json): any => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => toFirestoreValue(item)) } };
  }
  return {
    mapValue: {
      fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toFirestoreValue(item as Json)]))
    }
  };
};

const fromFirestoreValue = (value: any): Json => {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue || 0);
  if ('doubleValue' in value) return Number(value.doubleValue || 0);
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return Array.isArray(value.arrayValue?.values) ? value.arrayValue.values.map(fromFirestoreValue) : [];
  if ('mapValue' in value) {
    return Object.fromEntries(Object.entries(value.mapValue?.fields || {}).map(([key, item]) => [key, fromFirestoreValue(item)]));
  }
  if ('timestampValue' in value) return value.timestampValue;
  return null;
};

const flattenDoc = <T = Record<string, Json>>(doc: FirestoreDoc): T & { id: string } => {
  const rawFields = Object.fromEntries(Object.entries(doc.fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)]));
  return {
    ...(rawFields as T),
    id: doc.name.split('/').pop() || ''
  };
};

const fetchCollection = async <T = Record<string, Json>>(env: Env, token: string, collection: string, pageSize = 200) => {
  const response = await fetch(`${docPath(env, collection)}?pageSize=${pageSize}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (response.status === 404) return [] as Array<T & { id: string }>;
  if (!response.ok) {
    throw new Error(`Failed to fetch ${collection}: ${response.status}`);
  }
  const payload = await response.json<any>();
  return Array.isArray(payload.documents) ? payload.documents.map((doc: FirestoreDoc) => flattenDoc<T>(doc)) : [];
};

const setDocument = async (env: Env, token: string, collection: string, docId: string, data: Record<string, Json>) => {
  const body = {
    fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)]))
  };
  const response = await fetch(docPath(env, collection, docId), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Failed to set ${collection}/${docId}: ${response.status}`);
  }
};

const createDocument = async (env: Env, token: string, collection: string, data: Record<string, Json>) => {
  const response = await fetch(docPath(env, collection), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)]))
    })
  });
  if (!response.ok) {
    throw new Error(`Failed to create ${collection} document: ${response.status}`);
  }
};

const webPushForEnv = (env: Env) => {
  webpush.setVapidDetails(env.WEB_PUSH_SUBJECT, env.WEB_PUSH_PUBLIC_KEY, env.WEB_PUSH_PRIVATE_KEY);
  return webpush;
};

const withinLastMinute = (iso?: string) => {
  const ms = Date.parse(String(iso || ''));
  return Number.isFinite(ms) && Date.now() - ms <= 60000;
};

const getEnrollmentUserIds = (enrollments: Array<{ courseId: string; userId: string }>, classId: string) => {
  return Array.from(new Set(enrollments.filter((row) => row.courseId === classId).map((row) => row.userId).filter(Boolean)));
};

const getRecipientsForAnnouncement = (
  announcement: { classId: string; targetAudience?: string; targetIds?: string[] },
  enrollments: Array<{ courseId: string; userId: string }>
) => {
  const enrolled = getEnrollmentUserIds(enrollments, announcement.classId);
  if (announcement.targetAudience === 'all' || !Array.isArray(announcement.targetIds) || announcement.targetIds.length === 0) {
    return enrolled;
  }
  const allowed = new Set(announcement.targetIds);
  return enrolled.filter((userId) => allowed.has(userId));
};

const notificationPreferenceFor = (
  preferences: Array<{ userId: string; notificationType: string; inApp?: boolean; push?: boolean; email?: boolean }>,
  userId: string,
  type: string
) => {
  return preferences.find((item) => item.userId === userId && item.notificationType === type) || {
    userId,
    notificationType: type,
    inApp: true,
    push: true,
    email: false
  };
};

const createNotificationRecords = async (
  env: Env,
  token: string,
  notifications: Array<{ userId: string; type: string; title: string; body: string; data?: Record<string, string> }>,
  preferences: Array<{ userId: string; notificationType: string; inApp?: boolean; push?: boolean }>,
  subscriptions: Array<{ userId: string; endpoint: string; keys?: { p256dh?: string; auth?: string } }>
) => {
  const pushClient = webPushForEnv(env);

  for (const item of notifications) {
    const preference = notificationPreferenceFor(preferences, item.userId, item.type);
    if (!preference.inApp && !preference.push) continue;

    await createDocument(env, token, 'notifications', {
      userId: item.userId,
      type: item.type,
      title: item.title,
      body: item.body,
      data: item.data || {},
      isRead: false,
      createdAt: new Date().toISOString()
    });

    if (!preference.push) continue;

    const userSubs = subscriptions.filter((sub) => sub.userId === item.userId && sub.endpoint);
    for (const subscription of userSubs) {
      try {
        await pushClient.sendNotification({
          endpoint: subscription.endpoint,
          keys: subscription.keys || {}
        } as any, JSON.stringify({
          title: item.title,
          body: item.body,
          url: '/',
          data: item.data || {}
        }));
      } catch {
        // Keep notification record even if push delivery fails.
      }
    }
  }
};

const getUpcomingOccurrence = (session: ClassSession, startWindowMs: number, endWindowMs: number) => {
  const baseStartMs = Date.parse(session.startTime || '');
  const baseEndMs = Date.parse(session.endTime || '');
  if (!Number.isFinite(baseStartMs) || !Number.isFinite(baseEndMs) || session.isCancelled) return null;
  const durationMs = Math.max(0, baseEndMs - baseStartMs);

  if (session.recurrence === 'none') {
    if (baseStartMs >= startWindowMs && baseStartMs <= endWindowMs) {
      return { startTime: new Date(baseStartMs).toISOString(), endTime: new Date(baseStartMs + durationMs).toISOString() };
    }
    return null;
  }

  const recurrenceEndMs = Date.parse(session.recurrenceEndDate || '') || endWindowMs;
  const baseStart = new Date(baseStartMs);
  const dayCandidates: number[] = [];
  for (let step = 0; step <= 2; step += 1) {
    dayCandidates.push(startWindowMs + step * 24 * 60 * 60 * 1000);
  }

  for (const candidateMs of dayCandidates) {
    if (candidateMs > recurrenceEndMs) break;
    const candidate = new Date(candidateMs);
    candidate.setHours(baseStart.getHours(), baseStart.getMinutes(), 0, 0);
    const weekday = candidate.getDay();
    const dayMatches = session.recurrence === 'weekly'
      ? weekday === baseStart.getDay()
      : Array.isArray(session.recurrenceDays) && session.recurrenceDays.includes(weekday);
    if (!dayMatches) continue;
    if (candidate.getTime() < baseStartMs) continue;
    if (candidate.getTime() >= startWindowMs && candidate.getTime() <= endWindowMs) {
      return {
        startTime: candidate.toISOString(),
        endTime: new Date(candidate.getTime() + durationMs).toISOString()
      };
    }
  }

  return null;
};

const runScheduledAnnouncementPublish = async (env: Env, token: string) => {
  const announcements = await fetchCollection<any>(env, token, 'announcements', 300);
  const enrollments = await fetchCollection<any>(env, token, 'courseEnrollmentsPublic', 5000);
  const preferences = await fetchCollection<any>(env, token, 'notificationPreferences', 5000);
  const subscriptions = await fetchCollection<any>(env, token, 'pushSubscriptions', 5000);

  const due = announcements.filter((item) => item.published === false && Date.parse(String(item.scheduledAt || '')) <= Date.now());

  for (const announcement of due) {
    const now = new Date().toISOString();
    await setDocument(env, token, 'announcements', announcement.id, {
      ...announcement,
      published: true,
      publishedAt: now,
      updatedAt: now
    });

    const recipients = getRecipientsForAnnouncement(announcement, enrollments);
    await createNotificationRecords(
      env,
      token,
      recipients.map((userId) => ({
        userId,
        type: 'announcement_posted',
        title: String(announcement.title || 'New announcement'),
        body: String(announcement.bodyPreview || 'A scheduled announcement has been published.'),
        data: {
          announcementId: announcement.id,
          classId: String(announcement.classId || '')
        }
      })),
      preferences,
      subscriptions
    );
  }

  return { publishedCount: due.length };
};

const runSessionReminderSweep = async (env: Env, token: string) => {
  const sessions = await fetchCollection<ClassSession>(env, token, 'classSessions', 500);
  const enrollments = await fetchCollection<any>(env, token, 'courseEnrollmentsPublic', 5000);
  const preferences = await fetchCollection<any>(env, token, 'notificationPreferences', 5000);
  const subscriptions = await fetchCollection<any>(env, token, 'pushSubscriptions', 5000);

  const startWindowMs = Date.now() + 14 * 60 * 1000;
  const endWindowMs = Date.now() + 16 * 60 * 1000;
  let reminderCount = 0;

  for (const session of sessions) {
    const upcoming = getUpcomingOccurrence(session, startWindowMs, endWindowMs);
    if (!upcoming) continue;

    const occurrenceKey = upcoming.startTime.slice(0, 16);
    if (session.lastReminderOccurrence === occurrenceKey) continue;

    const recipients = getEnrollmentUserIds(enrollments, session.classId);
    await createNotificationRecords(
      env,
      token,
      recipients.map((userId) => ({
        userId,
        type: 'session_reminder',
        title: String(session.title || 'Upcoming class'),
        body: `Starts at ${new Date(upcoming.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`,
        data: {
          sessionId: session.id,
          classId: String(session.classId || ''),
          startTime: upcoming.startTime
        }
      })),
      preferences,
      subscriptions
    );

    await setDocument(env, token, 'classSessions', session.id, {
      ...session,
      lastReminderOccurrence: occurrenceKey,
      reminderSentAt: new Date().toISOString()
    } as Record<string, Json>);
    reminderCount += 1;
  }

  return { reminderCount };
};

const ensureAuthorized = (request: Request, env: Env) => {
  if (!env.WORKER_RUN_SECRET) return true;
  const auth = request.headers.get('authorization') || '';
  return auth === `Bearer ${env.WORKER_RUN_SECRET}`;
};

const jsonResponse = (data: Record<string, Json>, status = 200) => {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return jsonResponse({ ok: true, service: 'classboard-worker' });
    }

    if (!ensureAuthorized(request, env)) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
    }

    const token = await createGoogleAccessToken(env);

    if (url.pathname === '/run/publish-announcements') {
      const result = await runScheduledAnnouncementPublish(env, token);
      return jsonResponse({ ok: true, ...result });
    }

    if (url.pathname === '/run/session-reminders') {
      const result = await runSessionReminderSweep(env, token);
      return jsonResponse({ ok: true, ...result });
    }

    if (url.pathname === '/run/all') {
      const [publish, reminders] = await Promise.all([
        runScheduledAnnouncementPublish(env, token),
        runSessionReminderSweep(env, token)
      ]);
      return jsonResponse({ ok: true, publish, reminders });
    }

    return jsonResponse({ ok: false, error: 'not-found' }, 404);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    const token = await createGoogleAccessToken(env);
    if (controller.cron === '*/1 * * * *') {
      ctx.waitUntil(runScheduledAnnouncementPublish(env, token));
      return;
    }
    ctx.waitUntil(runSessionReminderSweep(env, token));
  }
} satisfies ExportedHandler<Env>;
