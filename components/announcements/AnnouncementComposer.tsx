import React, { useEffect, useMemo, useState } from 'react';
import type { Announcement, Course, User } from '../../types';
import { sanitizeRichText } from '../../lib/classboard';

interface AnnouncementComposerProps {
  open: boolean;
  user: User;
  classes: Course[];
  students: Array<{ id: string; name: string }>;
  initialValue?: Announcement | null;
  onClose: () => void;
  onSave: (payload: {
    classId: string;
    classTitle: string;
    title: string;
    body: string;
    targetAudience: 'all' | 'group' | 'individual';
    targetIds: string[];
    isPinned: boolean;
    scheduledAt?: string;
    attachments: string[];
  }) => Promise<void>;
}

const AnnouncementComposer: React.FC<AnnouncementComposerProps> = ({
  open,
  user,
  classes,
  students,
  initialValue,
  onClose,
  onSave
}) => {
  const [classId, setClassId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetAudience, setTargetAudience] = useState<'all' | 'group' | 'individual'>('all');
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [isPinned, setIsPinned] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [attachments, setAttachments] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClassId(initialValue?.classId || classes[0]?.id || '');
    setTitle(initialValue?.title || '');
    setBody(initialValue?.body || `<p>Hello ${user.name},</p><p></p>`);
    setTargetAudience(initialValue?.targetAudience || 'all');
    setTargetIds(initialValue?.targetIds || []);
    setIsPinned(Boolean(initialValue?.isPinned));
    setScheduleEnabled(Boolean(initialValue?.scheduledAt && !initialValue?.published));
    setScheduledAt(initialValue?.scheduledAt ? initialValue.scheduledAt.slice(0, 16) : '');
    setAttachments((initialValue?.attachments || []).join('\n'));
  }, [classes, initialValue, open, user.name]);

  const selectedClassTitle = useMemo(() => classes.find((item) => item.id === classId)?.title || 'Class', [classId, classes]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[170] bg-slate-950/65 backdrop-blur-sm flex justify-end safe-top safe-bottom">
      <div className="w-full max-w-2xl bg-white h-full overflow-y-auto shadow-2xl border-l border-slate-200">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">Announcement Composer</p>
            <h2 className="text-lg font-black uppercase text-slate-950">{initialValue ? 'Edit Notice' : 'New Notice'}</h2>
          </div>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-widest text-slate-600">
            Close
          </button>
        </div>
        <div className="p-6 space-y-4">
          <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
            Class
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold">
              {classes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
          <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold" />
          </label>
          <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
            Rich Body
            <div
              contentEditable
              suppressContentEditableWarning
              className="mt-2 min-h-48 w-full px-4 py-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 text-sm outline-none"
              onInput={(e) => setBody((e.target as HTMLDivElement).innerHTML)}
              dangerouslySetInnerHTML={{ __html: body }}
            />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
              Audience
              <select value={targetAudience} onChange={(e) => setTargetAudience(e.target.value as any)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold">
                <option value="all">All</option>
                <option value="group">Group</option>
                <option value="individual">Individual</option>
              </select>
            </label>
            <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
              Attachments
              <textarea value={attachments} onChange={(e) => setAttachments(e.target.value)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm min-h-24" placeholder="Paste one URL per line" />
            </label>
          </div>
          {targetAudience !== 'all' && (
            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">Recipients</p>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {students.map((student) => {
                  const checked = targetIds.includes(student.id);
                  return (
                    <label key={student.id} className="flex items-center gap-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setTargetIds((prev) => e.target.checked ? [...prev, student.id] : prev.filter((id) => id !== student.id));
                        }}
                      />
                      <span className="font-semibold">{student.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-600">
              <span>Pin announcement</span>
              <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
            </label>
            <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-600">
              <span>Schedule publish</span>
              <input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} />
            </label>
          </div>
          {scheduleEnabled && (
            <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
              Publish At
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold" />
            </label>
          )}
          <button
            type="button"
            disabled={saving || !classId || !title.trim() || !sanitizeRichText(body)}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  classId,
                  classTitle: selectedClassTitle,
                  title: title.trim(),
                  body: sanitizeRichText(body),
                  targetAudience,
                  targetIds,
                  isPinned,
                  scheduledAt: scheduleEnabled && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
                  attachments: attachments.split('\n').map((item) => item.trim()).filter(Boolean)
                });
              } finally {
                setSaving(false);
              }
            }}
            className="w-full py-4 rounded-2xl bg-slate-950 text-amber-500 text-xs font-black uppercase tracking-widest disabled:opacity-40"
          >
            {saving ? 'Saving...' : initialValue ? 'Update Announcement' : 'Publish Announcement'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnnouncementComposer;
