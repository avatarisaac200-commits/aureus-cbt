import { VideoLesson } from '../types';

export const VIDEO_LESSONS_COLLECTION = 'videoLessons';
export const VIDEO_PROGRESS_COLLECTION = 'videoProgress';

export interface YoutubeParseResult {
  id: string;
  canonicalUrl: string;
  thumbnail: string;
}

const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export const extractYoutubeVideo = (rawUrl: string): YoutubeParseResult | null => {
  const value = String(rawUrl || '').trim();
  if (!value) return null;

  if (YOUTUBE_ID_PATTERN.test(value)) {
    return {
      id: value,
      canonicalUrl: `https://www.youtube.com/watch?v=${value}`,
      thumbnail: getYoutubeThumbnail(value)
    };
  }

  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    let id = '';

    if (host === 'youtu.be') {
      id = url.pathname.split('/').filter(Boolean)[0] || '';
    } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
      else if (url.pathname.startsWith('/embed/') || url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/live/')) {
        id = url.pathname.split('/').filter(Boolean)[1] || '';
      }
    }

    if (!YOUTUBE_ID_PATTERN.test(id)) return null;
    return {
      id,
      canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
      thumbnail: getYoutubeThumbnail(id)
    };
  } catch {
    return null;
  }
};

export const getYoutubeThumbnail = (videoId: string) => `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

export const getYoutubeEmbedUrl = (videoId: string, startSeconds = 0) => {
  const params = new URLSearchParams({
    enablejsapi: '1',
    modestbranding: '1',
    rel: '0',
    playsinline: '1',
    origin: typeof window !== 'undefined' ? window.location.origin : ''
  });
  if (startSeconds > 0) params.set('start', String(Math.floor(startSeconds)));
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
};

export const sanitizePlainText = (value: string, maxLength = 4000) =>
  String(value || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

export const parseTags = (value: string | string[]) => {
  const source = Array.isArray(value) ? value.join(',') : value;
  return source
    .split(',')
    .map((tag) => sanitizePlainText(tag, 32).toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
};

export const formatVideoDuration = (seconds: number) => {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
};

export const parseDurationInput = (value: string) => {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw) * 60;
  const parts = raw.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
};

export const videoProgressId = (userId: string, lessonId: string) => `${userId}_${lessonId}`;

export const sortVideoLessons = (items: VideoLesson[]) =>
  [...items].sort((a, b) => {
    const course = (a.course || '').localeCompare(b.course || '');
    if (course !== 0) return course;
    const category = (a.category || '').localeCompare(b.category || '');
    if (category !== 0) return category;
    const order = (a.order || 0) - (b.order || 0);
    if (order !== 0) return order;
    return a.title.localeCompare(b.title);
  });
