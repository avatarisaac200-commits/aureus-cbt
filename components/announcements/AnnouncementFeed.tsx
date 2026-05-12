import React, { useEffect, useMemo, useRef } from 'react';
import type { Announcement, User } from '../../types';
import { formatInBrowserTimezone, isTeacherRole, sortAnnouncements, timeAgo } from '../../lib/classboard';
import ReadReceiptBadge from './ReadReceiptBadge';

interface AnnouncementFeedProps {
  user: User;
  items: Announcement[];
  unreadIds: Set<string>;
  readCounts: Record<string, number>;
  totalRecipientsByAnnouncement: Record<string, number>;
  onMarkRead: (announcementId: string) => void;
  onEdit: (announcement: Announcement) => void;
  onDelete: (announcement: Announcement) => void;
}

const AnnouncementFeed: React.FC<AnnouncementFeedProps> = ({
  user,
  items,
  unreadIds,
  readCounts,
  totalRecipientsByAnnouncement,
  onMarkRead,
  onEdit,
  onDelete
}) => {
  const ordered = useMemo(() => sortAnnouncements(items), [items]);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const target = entry.target as HTMLElement;
          const id = target.dataset.announcementId;
          if (id) onMarkRead(id);
        }
      });
    }, { threshold: 0.6 });
    return () => observerRef.current?.disconnect();
  }, [onMarkRead]);

  return (
    <div className="space-y-3">
      {ordered.length === 0 && (
        <div className="bg-white border border-dashed border-slate-200 rounded-[2rem] p-10 text-center text-xs font-black uppercase tracking-widest text-slate-400">
          No announcements yet.
        </div>
      )}
      {ordered.map((announcement) => (
        <article
          key={announcement.id}
          ref={(node) => {
            if (node && observerRef.current) observerRef.current.observe(node);
          }}
          data-announcement-id={announcement.id}
          className={`bg-white rounded-[2rem] border shadow-sm overflow-hidden ${unreadIds.has(announcement.id) ? 'border-amber-300 border-l-[6px]' : 'border-slate-100'}`}
        >
          <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {announcement.isPinned && (
                  <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-black uppercase tracking-widest">
                    Pinned
                  </span>
                )}
                <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest">
                  {announcement.classTitle}
                </span>
              </div>
              <h3 className="mt-2 text-base font-black uppercase text-slate-950">{announcement.title}</h3>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                {announcement.authorName} • {timeAgo(announcement.publishedAt || announcement.createdAt)}
                {announcement.editedAt ? ` • edited ${formatInBrowserTimezone(announcement.editedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
              </p>
            </div>
            {isTeacherRole(user) && (
              <div className="flex items-center gap-2 shrink-0">
                <ReadReceiptBadge
                  readCount={readCounts[announcement.id] || 0}
                  totalCount={totalRecipientsByAnnouncement[announcement.id] || 0}
                />
                <button type="button" onClick={() => onEdit(announcement)} className="px-3 py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Edit
                </button>
                <button type="button" onClick={() => onDelete(announcement)} className="px-3 py-2 rounded-xl border border-red-200 text-[10px] font-black uppercase tracking-widest text-red-600">
                  Delete
                </button>
              </div>
            )}
          </div>
          <div className="px-5 py-4">
            <div className="prose prose-sm max-w-none text-slate-700" dangerouslySetInnerHTML={{ __html: announcement.body }} />
            {(announcement.attachments || []).length > 0 && (
              <p className="mt-3 text-[11px] font-black uppercase tracking-widest text-slate-500">
                {(announcement.attachments || []).length} attachment{(announcement.attachments || []).length === 1 ? '' : 's'}
              </p>
            )}
          </div>
        </article>
      ))}
    </div>
  );
};

export default AnnouncementFeed;
