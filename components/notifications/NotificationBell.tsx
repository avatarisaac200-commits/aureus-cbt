import React, { useMemo, useState } from 'react';
import type { AppNotification } from '../../types';
import { formatInBrowserTimezone, timeAgo } from '../../lib/classboard';

interface NotificationBellProps {
  items: AppNotification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

const NotificationBell: React.FC<NotificationBellProps> = ({ items, onMarkRead, onMarkAllRead }) => {
  const [open, setOpen] = useState(false);
  const unreadCount = useMemo(() => items.filter((item) => !item.isRead).length, [items]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative w-11 h-11 rounded-2xl border border-slate-200 bg-white text-slate-700 flex items-center justify-center shadow-sm"
        aria-label="Open notifications"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 8a6 6 0 1112 0v4c0 1.3.4 2.6 1.2 3.6L20 17H4l.8-1.4A6.7 6.7 0 006 12V8z" />
          <path d="M10 19a2 2 0 004 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-14 w-[min(90vw,360px)] rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl overflow-hidden z-50">
          <div className="px-4 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Notifications</p>
              <p className="text-sm font-black text-slate-900">{unreadCount} unread</p>
            </div>
            <button type="button" onClick={onMarkAllRead} className="text-[11px] font-black uppercase tracking-widest text-amber-700">
              Read all
            </button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs font-black uppercase tracking-widest text-slate-400">
                No notifications yet.
              </div>
            ) : (
              items.slice(0, 20).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onMarkRead(item.id)}
                  className={`w-full text-left px-4 py-4 border-b border-slate-100 last:border-b-0 ${item.isRead ? 'bg-white' : 'bg-amber-50/50'}`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-1 w-2.5 h-2.5 rounded-full ${item.isRead ? 'bg-slate-200' : 'bg-amber-500'}`}></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-black text-slate-900 truncate">{item.title}</p>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{timeAgo(item.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 line-clamp-2">{item.body}</p>
                      <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        {formatInBrowserTimezone(item.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
