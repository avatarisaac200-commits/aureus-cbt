import { addDoc, collection, doc, getDocs, query, setDoc, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { db } from '../firebase';
import type { AppNotification, NotificationType, User } from '../types';
import {
  buildNotificationPreferenceId,
  collapseDigestTitle,
  getDefaultNotificationPreferences,
  shouldSendBrowserPush
} from './classboard';

const getNotificationsCollection = () => collection(db, 'notifications');

export async function ensureNotificationPreferences(userId: string) {
  const prefsQuery = query(collection(db, 'notificationPreferences'), where('userId', '==', userId));
  const snap: any = await getDocs(prefsQuery);
  if (!snap.empty) return;
  const defaults = getDefaultNotificationPreferences(userId);
  await Promise.all(defaults.map((row) => setDoc(doc(db, 'notificationPreferences', row.id), row)));
}

export async function notify(
  userIds: string[],
  type: NotificationType,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) return;

  for (const userId of uniqueUserIds) {
    await ensureNotificationPreferences(userId);

    const prefsSnap: any = await getDocs(query(
      collection(db, 'notificationPreferences'),
      where('userId', '==', userId),
      where('notificationType', '==', type)
    ));
    const pref = prefsSnap.docs[0]?.data() || {
      id: buildNotificationPreferenceId(userId, type),
      userId,
      notificationType: type,
      inApp: true,
      push: true,
      email: false
    };

    if (!pref.inApp && !pref.push) continue;

    const recentSnap: any = await getDocs(query(
      collection(db, 'notifications'),
      where('userId', '==', userId),
      where('type', '==', type)
    ));
    const recentRows = recentSnap.docs
      .map((docSnap: any) => ({ id: docSnap.id, ...(docSnap.data() as Omit<AppNotification, 'id'>) } as AppNotification))
      .filter((item) => Date.now() - Date.parse(item.createdAt || '') <= 60000)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const digestTitle = recentRows.length >= 3 ? collapseDigestTitle(recentRows, type) : null;
    const nextTitle = digestTitle || title;
    const nextBody = digestTitle ? body : body;

    await addDoc(getNotificationsCollection(), {
      userId,
      type,
      title: nextTitle,
      body: nextBody,
      data: data || {},
      isRead: false,
      createdAt: new Date().toISOString()
    });
  }
}

export function maybeShowBrowserNotification(
  notification: AppNotification,
  preference: { push?: boolean } | undefined,
  user?: User | null
) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (!shouldSendBrowserPush(preference as any, user)) return;
  try {
    new Notification(notification.title, { body: notification.body || '' });
  } catch {
    // Ignore browser notification failures.
  }
}
