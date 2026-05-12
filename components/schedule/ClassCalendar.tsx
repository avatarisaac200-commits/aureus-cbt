import React, { useMemo, useState } from 'react';
import type { ClassSession, User } from '../../types';
import {
  addDays,
  expandSessionsInRange,
  formatInBrowserTimezone,
  getWeekStart,
  isSameDay,
  startOfDay
} from '../../lib/classboard';

type CalendarView = 'month' | 'week' | 'day';

interface ClassCalendarProps {
  user: User;
  sessions: ClassSession[];
  canEdit: boolean;
  onNewSession: (date?: Date) => void;
  onSelectSession: (session: ClassSession) => void;
}

const ClassCalendar: React.FC<ClassCalendarProps> = ({ user, sessions, canEdit, onNewSession, onSelectSession }) => {
  const [view, setView] = useState<CalendarView>('month');
  const [cursor, setCursor] = useState(new Date());

  const range = useMemo(() => {
    if (view === 'day') {
      const start = startOfDay(cursor);
      return { start, end: addDays(start, 0) };
    }
    if (view === 'week') {
      const start = getWeekStart(cursor);
      return { start, end: addDays(start, 6) };
    }
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = getWeekStart(monthStart);
    return { start: gridStart, end: addDays(gridStart, 41) };
  }, [cursor, view]);

  const occurrences = useMemo(() => expandSessionsInRange(sessions, range.start, range.end), [range.end, range.start, sessions]);
  const dayCells = useMemo(() => {
    const count = view === 'month' ? 42 : view === 'week' ? 7 : 1;
    return Array.from({ length: count }, (_, index) => addDays(range.start, index));
  }, [range.start, view]);

  const byDay = useMemo(() => {
    const map = new Map<string, typeof occurrences>();
    occurrences.forEach((item) => {
      const key = item.startTime.slice(0, 10);
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    });
    return map;
  }, [occurrences]);

  const moveCursor = (delta: number) => {
    const next = new Date(cursor);
    if (view === 'month') next.setMonth(next.getMonth() + delta);
    else next.setDate(next.getDate() + (view === 'week' ? delta * 7 : delta));
    setCursor(next);
  };

  return (
    <section className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-slate-500">Class Schedule</p>
          <h2 className="text-lg font-black uppercase text-slate-950">
            {view === 'month' && cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            {view === 'week' && `${range.start.toLocaleDateString()} - ${range.end.toLocaleDateString()}`}
            {view === 'day' && cursor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => moveCursor(-1)} className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-widest text-slate-600">Prev</button>
          <button type="button" onClick={() => setCursor(new Date())} className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-widest text-slate-600">Today</button>
          <button type="button" onClick={() => moveCursor(1)} className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-widest text-slate-600">Next</button>
          {(['month', 'week', 'day'] as CalendarView[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setView(item)}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${view === item ? 'bg-slate-950 text-amber-500' : 'bg-slate-100 text-slate-600'}`}
            >
              {item}
            </button>
          ))}
          {canEdit && (
            <button type="button" onClick={() => onNewSession(cursor)} className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-black uppercase tracking-widest">
              New Session
            </button>
          )}
        </div>
      </div>

      <div className={`${view === 'month' ? 'grid grid-cols-7' : 'grid grid-cols-1 md:grid-cols-7'} gap-px bg-slate-100`}>
        {dayCells.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const items = byDay.get(key) || [];
          return (
            <div key={key} className={`min-h-[150px] bg-white p-3 ${view === 'day' ? 'md:col-span-7 min-h-[420px]' : ''}`}>
              <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                  <p className={`text-xs font-black uppercase tracking-widest ${isSameDay(day, new Date()) ? 'text-amber-700' : 'text-slate-400'}`}>
                    {day.toLocaleDateString(undefined, { weekday: 'short' })}
                  </p>
                  <p className="text-sm font-black text-slate-900">{day.getDate()}</p>
                </div>
                {canEdit && (
                  <button type="button" onClick={() => onNewSession(day)} className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Add
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {items.length === 0 && view === 'day' && (
                  <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs font-black uppercase tracking-widest text-slate-400">
                    No sessions scheduled.
                  </div>
                )}
                {items.map((item) => (
                  <button
                    key={item.occurrenceId}
                    type="button"
                    onClick={() => onSelectSession(item.source)}
                    className="w-full text-left rounded-xl px-3 py-3 text-white shadow-sm"
                    style={{ backgroundColor: item.source.color || '#3B6D11' }}
                  >
                    <p className="text-xs font-black uppercase tracking-widest opacity-80">{item.source.classTitle}</p>
                    <p className="text-sm font-black">{item.source.title}</p>
                    <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">
                      {formatInBrowserTimezone(item.startTime, { hour: 'numeric', minute: '2-digit' })} - {formatInBrowserTimezone(item.endTime, { hour: 'numeric', minute: '2-digit' })}
                    </p>
                    {item.source.location && (
                      <p className="mt-1 text-[11px] opacity-80">{item.source.location}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default ClassCalendar;
