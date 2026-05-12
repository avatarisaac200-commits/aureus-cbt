import React, { useEffect, useState } from 'react';
import type { ClassSession, Course } from '../../types';
import {
  combineLocalDateAndTimeToUtcIso,
  isTeacherRole,
  toLocalDateInputValue,
  toLocalTimeInputValue
} from '../../lib/classboard';

interface SessionModalProps {
  open: boolean;
  classes: Course[];
  initialValue?: ClassSession | null;
  canEdit: boolean;
  onClose: () => void;
  onSave: (payload: {
    classId: string;
    classTitle: string;
    title: string;
    description?: string;
    location?: string;
    lessonPlan?: string;
    startTime: string;
    endTime: string;
    recurrence: 'none' | 'weekly' | 'custom';
    recurrenceDays: number[];
    recurrenceEndDate?: string;
    color: string;
  }) => Promise<void>;
}

const weekdayOptions = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 }
];

const SessionModal: React.FC<SessionModalProps> = ({ open, classes, initialValue, canEdit, onClose, onSave }) => {
  const [classId, setClassId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [lessonPlan, setLessonPlan] = useState('');
  const [dateValue, setDateValue] = useState('');
  const [startValue, setStartValue] = useState('');
  const [endValue, setEndValue] = useState('');
  const [recurrence, setRecurrence] = useState<'none' | 'weekly' | 'custom'>('none');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [color, setColor] = useState('#3B6D11');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClassId(initialValue?.classId || classes[0]?.id || '');
    setTitle(initialValue?.title || '');
    setDescription(initialValue?.description || '');
    setLocation(initialValue?.location || '');
    setLessonPlan(initialValue?.lessonPlan || '');
    setDateValue(toLocalDateInputValue(initialValue?.startTime) || toLocalDateInputValue(new Date().toISOString()));
    setStartValue(toLocalTimeInputValue(initialValue?.startTime) || '09:00');
    setEndValue(toLocalTimeInputValue(initialValue?.endTime) || '10:00');
    setRecurrence(initialValue?.recurrence || 'none');
    setRecurrenceDays(initialValue?.recurrenceDays || []);
    setRecurrenceEndDate(initialValue?.recurrenceEndDate ? initialValue.recurrenceEndDate.slice(0, 10) : '');
    setColor(initialValue?.color || '#3B6D11');
  }, [classes, initialValue, open]);

  if (!open) return null;

  const selectedClass = classes.find((item) => item.id === classId);

  return (
    <div className="fixed inset-0 z-[175] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 safe-top safe-bottom">
      <div className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto bg-white rounded-[2rem] border border-slate-200 shadow-2xl">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">Class Session</p>
            <h2 className="text-lg font-black uppercase text-slate-950">{initialValue ? 'Edit Session' : 'New Session'}</h2>
          </div>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-widest text-slate-600">
            Close
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
              Class
              <select disabled={!canEdit} value={classId} onChange={(e) => setClassId(e.target.value)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold">
                {classes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
            <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
              Session Color
              <input disabled={!canEdit} type="color" value={color} onChange={(e) => setColor(e.target.value)} className="mt-2 w-full h-12 p-1 rounded-2xl border border-slate-200 bg-white" />
            </label>
          </div>
          <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
            Title
            <input disabled={!canEdit} value={title} onChange={(e) => setTitle(e.target.value)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold" />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
              Date
              <input disabled={!canEdit} type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold" />
            </label>
            <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
              Start Time
              <input disabled={!canEdit} type="time" value={startValue} onChange={(e) => setStartValue(e.target.value)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold" />
            </label>
            <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
              End Time
              <input disabled={!canEdit} type="time" value={endValue} onChange={(e) => setEndValue(e.target.value)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold" />
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
              Location
              <input disabled={!canEdit} value={location} onChange={(e) => setLocation(e.target.value)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm" />
            </label>
            <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
              Recurrence
              <select disabled={!canEdit} value={recurrence} onChange={(e) => setRecurrence(e.target.value as any)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold">
                <option value="none">None</option>
                <option value="weekly">Weekly</option>
                <option value="custom">Custom Days</option>
              </select>
            </label>
          </div>
          {recurrence === 'custom' && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">Repeat On</p>
              <div className="flex gap-2 flex-wrap">
                {weekdayOptions.map((item) => {
                  const active = recurrenceDays.includes(item.value);
                  return (
                    <button
                      key={item.value}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setRecurrenceDays((prev) => active ? prev.filter((value) => value !== item.value) : [...prev, item.value].sort())}
                      className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${active ? 'bg-slate-950 text-amber-500' : 'bg-white border border-slate-200 text-slate-600'}`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {recurrence !== 'none' && (
            <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
              Recurrence End Date
              <input disabled={!canEdit} type="date" value={recurrenceEndDate} onChange={(e) => setRecurrenceEndDate(e.target.value)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold" />
            </label>
          )}
          <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
            Description
            <textarea disabled={!canEdit} value={description} onChange={(e) => setDescription(e.target.value)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm min-h-24" />
          </label>
          <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
            Lesson Plan / Notes
            <textarea disabled={!canEdit} value={lessonPlan} onChange={(e) => setLessonPlan(e.target.value)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm min-h-24" />
          </label>
          {canEdit && (
            <button
              type="button"
              disabled={saving || !selectedClass || !title.trim()}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave({
                    classId,
                    classTitle: selectedClass?.title || 'Class',
                    title: title.trim(),
                    description: description.trim(),
                    location: location.trim(),
                    lessonPlan: lessonPlan.trim(),
                    startTime: combineLocalDateAndTimeToUtcIso(dateValue, startValue),
                    endTime: combineLocalDateAndTimeToUtcIso(dateValue, endValue),
                    recurrence,
                    recurrenceDays,
                    recurrenceEndDate: recurrenceEndDate ? new Date(`${recurrenceEndDate}T23:59:59`).toISOString() : undefined,
                    color
                  });
                } finally {
                  setSaving(false);
                }
              }}
              className="w-full py-4 rounded-2xl bg-slate-950 text-amber-500 text-xs font-black uppercase tracking-widest disabled:opacity-40"
            >
              {saving ? 'Saving...' : 'Save Session'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SessionModal;
