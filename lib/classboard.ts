import type {
  Announcement,
  AppNotification,
  ClassSession,
  NotificationPreference,
  NotificationType,
  User
} from '../types';

export const NOTIFICATION_TYPES: NotificationType[] = [
  'announcement_posted',
  'session_reminder',
  'schedule_updated',
  'grade_released',
  'deadline_approaching',
  'new_message'
];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  announcement_posted: 'Announcements',
  session_reminder: 'Session Reminders',
  schedule_updated: 'Schedule Updates',
  grade_released: 'Grade Releases',
  deadline_approaching: 'Deadlines',
  new_message: 'Messages'
};

export const isTeacherRole = (user?: User | null) => {
  return user?.role === 'admin' || user?.role === 'root-admin';
};

export const buildNotificationPreferenceId = (userId: string, type: NotificationType) => `${userId}_${type}`;
export const buildAnnouncementReadId = (announcementId: string, userId: string) => `${announcementId}_${userId}`;
export const buildPushSubscriptionId = (userId: string, endpoint: string) => {
  const safe = endpoint.replace(/[^a-z0-9]/gi, '').slice(-48) || 'subscription';
  return `${userId}_${safe}`;
};

export const getDefaultNotificationPreferences = (userId: string): NotificationPreference[] => {
  return NOTIFICATION_TYPES.map((notificationType) => ({
    id: buildNotificationPreferenceId(userId, notificationType),
    userId,
    notificationType,
    inApp: true,
    push: notificationType === 'announcement_posted' || notificationType === 'session_reminder' || notificationType === 'schedule_updated',
    email: false
  }));
};

export const escapeHtml = (value: string) => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export const sanitizeRichText = (raw: string) => {
  const safe = String(raw || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+="[^"]*"/gi, '')
    .replace(/\son[a-z]+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
  return safe.trim();
};

export const toPlainText = (html: string) => {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const getBodyPreview = (html: string, max = 140) => {
  const text = toPlainText(html);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
};

export const timeAgo = (value?: string) => {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms)) return 'just now';
  const diff = Date.now() - ms;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
  if (diff < day) return `${Math.max(1, Math.floor(diff / hour))}h ago`;
  if (diff < day * 7) return `${Math.max(1, Math.floor(diff / day))}d ago`;
  return new Date(ms).toLocaleDateString();
};

export const formatInBrowserTimezone = (value?: string, options?: Intl.DateTimeFormatOptions) => {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat(undefined, options || {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
};

export const toLocalDateInputValue = (value?: string) => {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const toLocalTimeInputValue = (value?: string) => {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

export const combineLocalDateAndTimeToUtcIso = (dateValue: string, timeValue: string) => {
  if (!dateValue || !timeValue) return '';
  const next = new Date(`${dateValue}T${timeValue}`);
  return Number.isFinite(next.getTime()) ? next.toISOString() : '';
};

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
export const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

export const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export const getWeekStart = (date: Date) => {
  const next = startOfDay(date);
  const delta = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - delta);
  return next;
};

export const isSameDay = (a?: Date, b?: Date) => {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};

export const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => {
  const startA = Date.parse(aStart);
  const endA = Date.parse(aEnd);
  const startB = Date.parse(bStart);
  const endB = Date.parse(bEnd);
  if (![startA, endA, startB, endB].every(Number.isFinite)) return false;
  return startA < endB && startB < endA;
};

export type ExpandedSessionOccurrence = {
  occurrenceId: string;
  sessionId: string;
  startTime: string;
  endTime: string;
  source: ClassSession;
};

export const expandSessionsInRange = (
  sessions: ClassSession[],
  rangeStart: Date,
  rangeEnd: Date
): ExpandedSessionOccurrence[] => {
  const startMs = startOfDay(rangeStart).getTime();
  const endMs = endOfDay(rangeEnd).getTime();
  const occurrences: ExpandedSessionOccurrence[] = [];

  sessions.forEach((session) => {
    if (session.isCancelled) return;
    const baseStartMs = Date.parse(session.startTime);
    const baseEndMs = Date.parse(session.endTime);
    if (!Number.isFinite(baseStartMs) || !Number.isFinite(baseEndMs)) return;
    const durationMs = Math.max(0, baseEndMs - baseStartMs);
    const recurrenceEndMs = Date.parse(session.recurrenceEndDate || '') || endMs;
    const cancelledDates = new Set((session.cancelledOccurrences || []).map((item) => String(item).slice(0, 10)));

    const pushOccurrence = (startIso: string) => {
      const start = Date.parse(startIso);
      if (!Number.isFinite(start)) return;
      if (start > endMs || start + durationMs < startMs) return;
      const dayKey = new Date(start).toISOString().slice(0, 10);
      if (cancelledDates.has(dayKey)) return;
      occurrences.push({
        occurrenceId: `${session.id}_${dayKey}`,
        sessionId: session.id,
        startTime: new Date(start).toISOString(),
        endTime: new Date(start + durationMs).toISOString(),
        source: session
      });
    };

    if (session.recurrence === 'none') {
      pushOccurrence(session.startTime);
      return;
    }

    const activeDays = session.recurrence === 'weekly'
      ? [new Date(baseStartMs).getDay()]
      : (session.recurrenceDays || []);

    let cursor = startOfDay(new Date(Math.max(baseStartMs, startMs)));
    const hardEnd = Math.min(recurrenceEndMs || endMs, endMs);
    while (cursor.getTime() <= hardEnd) {
      if (cursor.getDay() === new Date(baseStartMs).getDay() && session.recurrence === 'weekly') {
        const start = new Date(cursor);
        start.setHours(new Date(baseStartMs).getHours(), new Date(baseStartMs).getMinutes(), 0, 0);
        if (start.getTime() >= baseStartMs) pushOccurrence(start.toISOString());
      } else if (session.recurrence === 'custom' && activeDays.includes(cursor.getDay())) {
        const start = new Date(cursor);
        start.setHours(new Date(baseStartMs).getHours(), new Date(baseStartMs).getMinutes(), 0, 0);
        if (start.getTime() >= baseStartMs) pushOccurrence(start.toISOString());
      }
      cursor = addDays(cursor, 1);
    }
  });

  return occurrences.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
};

export const shouldSendBrowserPush = (
  preference: NotificationPreference | undefined,
  user: User | null | undefined
) => {
  if (!preference?.push) return false;
  const quietStart = String((user as any)?.quietStart || '').trim();
  const quietEnd = String((user as any)?.quietEnd || '').trim();
  if (!quietStart || !quietEnd) return true;
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const [startHour, startMinute] = quietStart.split(':').map((value) => Number(value) || 0);
  const [endHour, endMinute] = quietEnd.split(':').map((value) => Number(value) || 0);
  const quietStartMinutes = startHour * 60 + startMinute;
  const quietEndMinutes = endHour * 60 + endMinute;
  if (quietStartMinutes === quietEndMinutes) return true;
  if (quietStartMinutes < quietEndMinutes) {
    return !(minutesNow >= quietStartMinutes && minutesNow < quietEndMinutes);
  }
  return !(minutesNow >= quietStartMinutes || minutesNow < quietEndMinutes);
};

export const collapseDigestTitle = (items: AppNotification[], type: NotificationType) => {
  const count = items.length;
  if (count <= 1) return null;
  if (type === 'announcement_posted') return `You have ${count} new announcements`;
  if (type === 'schedule_updated') return `${count} class schedule updates`;
  if (type === 'session_reminder') return `${count} upcoming session reminders`;
  return `${count} new notifications`;
};

export const sortAnnouncements = (items: Announcement[]) => {
  return [...items].sort((a, b) => {
    if (Boolean(a.isPinned) !== Boolean(b.isPinned)) return a.isPinned ? -1 : 1;
    return Date.parse(b.publishedAt || b.createdAt) - Date.parse(a.publishedAt || a.createdAt);
  });
};
