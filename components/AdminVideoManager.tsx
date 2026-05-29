import React, { useEffect, useMemo, useState } from 'react';
import { User, VideoLesson } from '../types';
import { db } from '../firebase';
import { addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, updateDoc, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { confirmDialog } from './ui/ConfirmDialog';
import { toast } from './ui/Toast';
import {
  extractYoutubeVideo,
  formatVideoDuration,
  parseDurationInput,
  parseTags,
  sanitizePlainText,
  sortVideoLessons,
  VIDEO_LESSONS_COLLECTION
} from '../lib/videoLearning';

interface AdminVideoManagerProps {
  user: User;
}

type VideoFormState = {
  id?: string;
  title: string;
  description: string;
  youtubeUrl: string;
  course: string;
  category: string;
  thumbnail: string;
  duration: string;
  order: string;
  tags: string;
  visibility: 'draft' | 'published';
};

const EMPTY_FORM: VideoFormState = {
  title: '',
  description: '',
  youtubeUrl: '',
  course: '',
  category: '',
  thumbnail: '',
  duration: '',
  order: '1',
  tags: '',
  visibility: 'draft'
};

const AdminVideoManager: React.FC<AdminVideoManagerProps> = ({ user }) => {
  const [lessons, setLessons] = useState<VideoLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<VideoFormState>(EMPTY_FORM);
  const [queryText, setQueryText] = useState('');
  const [courseFilter, setCourseFilter] = useState('all');

  const youtube = useMemo(() => extractYoutubeVideo(form.youtubeUrl), [form.youtubeUrl]);
  const duplicate = useMemo(() => {
    if (!youtube) return null;
    return lessons.find((lesson) => lesson.youtubeVideoId === youtube.id && lesson.id !== form.id) || null;
  }, [form.id, lessons, youtube]);

  useEffect(() => {
    const q = query(collection(db, VIDEO_LESSONS_COLLECTION), orderBy('course'), limit(500));
    const unsub = onSnapshot(q, (snap) => {
      setLessons(sortVideoLessons(snap.docs.map((item) => ({ ...item.data(), id: item.id } as VideoLesson))));
      setLoading(false);
    }, (err) => {
      setLoading(false);
      toast.error('Video library unavailable', err?.message || 'Could not load videos.');
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!youtube || form.thumbnail) return;
    setForm((prev) => ({ ...prev, thumbnail: youtube.thumbnail }));
  }, [form.thumbnail, youtube]);

  const courses = useMemo(() => Array.from(new Set(lessons.map((lesson) => lesson.course).filter(Boolean))).sort(), [lessons]);

  const filteredLessons = useMemo(() => {
    const needle = queryText.trim().toLowerCase();
    return lessons.filter((lesson) => {
      if (courseFilter !== 'all' && lesson.course !== courseFilter) return false;
      if (!needle) return true;
      return [
        lesson.title,
        lesson.description,
        lesson.course,
        lesson.category,
        ...(lesson.tags || [])
      ].join(' ').toLowerCase().includes(needle);
    });
  }, [courseFilter, lessons, queryText]);

  const resetForm = () => setForm(EMPTY_FORM);

  const editLesson = (lesson: VideoLesson) => {
    setForm({
      id: lesson.id,
      title: lesson.title,
      description: lesson.description || '',
      youtubeUrl: lesson.youtubeUrl,
      course: lesson.course || '',
      category: lesson.category || '',
      thumbnail: lesson.thumbnail || '',
      duration: lesson.duration ? formatVideoDuration(lesson.duration) : '',
      order: String(lesson.order || 1),
      tags: (lesson.tags || []).join(', '),
      visibility: lesson.visibility || (lesson.isPublished ? 'published' : 'draft')
    });
  };

  const saveLesson = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = extractYoutubeVideo(form.youtubeUrl);
    if (!parsed) {
      toast.error('Invalid YouTube link', 'Paste a valid YouTube, Shorts, Live, embed, or youtu.be URL.');
      return;
    }
    if (duplicate) {
      toast.warning('Duplicate video', `"${duplicate.title}" already uses this YouTube video.`);
      return;
    }

    const title = sanitizePlainText(form.title, 140);
    const course = sanitizePlainText(form.course, 120);
    if (!title || !course) {
      toast.error('Missing details', 'Title and course are required.');
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload = {
        title,
        description: sanitizePlainText(form.description, 3000),
        youtubeUrl: parsed.canonicalUrl,
        youtubeVideoId: parsed.id,
        course,
        category: sanitizePlainText(form.category || 'General', 120),
        thumbnail: sanitizePlainText(form.thumbnail || parsed.thumbnail, 500),
        duration: parseDurationInput(form.duration),
        order: Number(form.order) || lessons.length + 1,
        tags: parseTags(form.tags),
        visibility: form.visibility,
        isPublished: form.visibility === 'published',
        updatedAt: now
      };

      if (form.id) {
        await updateDoc(doc(db, VIDEO_LESSONS_COLLECTION, form.id), payload);
        toast.success('Video updated');
      } else {
        await addDoc(collection(db, VIDEO_LESSONS_COLLECTION), {
          ...payload,
          createdBy: user.id,
          creatorName: user.name,
          createdAt: now,
          viewCount: 0,
          completedCount: 0,
          totalWatchSeconds: 0
        });
        toast.success('Video added', form.visibility === 'published' ? 'Students can watch it now.' : 'Saved as a draft.');
      }
      resetForm();
    } catch (err: any) {
      toast.error('Save failed', err?.message || 'Could not save this video.');
    } finally {
      setSaving(false);
    }
  };

  const removeLesson = async (lesson: VideoLesson) => {
    const ok = await confirmDialog({
      title: 'Delete video?',
      message: `Delete "${lesson.title}" from the video library? Watch progress records are kept for audit history.`,
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!ok) return;
    await deleteDoc(doc(db, VIDEO_LESSONS_COLLECTION, lesson.id));
    toast.success('Video deleted');
  };

  const moveLesson = async (lesson: VideoLesson, delta: number) => {
    await updateDoc(doc(db, VIDEO_LESSONS_COLLECTION, lesson.id), {
      order: Math.max(1, (lesson.order || 1) + delta),
      updatedAt: new Date().toISOString()
    });
  };

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">
        <form onSubmit={saveLesson} className="bg-white border border-slate-100 rounded-[2rem] shadow-sm p-6 space-y-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-600">Lecture Studio</p>
            <h2 className="text-xl font-black text-slate-950 mt-1">{form.id ? 'Edit Video' : 'Add YouTube Lesson'}</h2>
          </div>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Lesson title" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Lesson description" rows={4} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-amber-400" />
          <div>
            <input value={form.youtubeUrl} onChange={(e) => setForm({ ...form, youtubeUrl: e.target.value, thumbnail: extractYoutubeVideo(e.target.value)?.thumbnail || form.thumbnail })} placeholder="Paste YouTube link" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400" />
            {form.youtubeUrl && !youtube && <p className="mt-2 text-xs font-bold text-red-500">This does not look like a valid YouTube URL.</p>}
            {duplicate && <p className="mt-2 text-xs font-bold text-amber-600">Duplicate: {duplicate.title}</p>}
          </div>
          {youtube && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
              <img src={form.thumbnail || youtube.thumbnail} alt="YouTube thumbnail preview" className="w-full aspect-video object-cover" />
              <div className="p-3 text-xs font-black uppercase tracking-widest text-amber-400">Video ID: {youtube.id}</div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} placeholder="Course" className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Module/category" className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
            <input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="Duration e.g. 12:30" className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
            <input value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} placeholder="Order" type="number" min="1" className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
          </div>
          <input value={form.thumbnail} onChange={(e) => setForm({ ...form, thumbnail: e.target.value })} placeholder="Custom thumbnail URL (optional)" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
          <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Tags separated by commas" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
            {(['draft', 'published'] as const).map((state) => (
              <button key={state} type="button" onClick={() => setForm({ ...form, visibility: state })} className={`py-3 rounded-xl text-xs font-black uppercase tracking-widest ${form.visibility === state ? 'bg-slate-950 text-amber-400 shadow-sm' : 'text-slate-500'}`}>{state}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <button disabled={saving || Boolean(duplicate)} className="flex-1 py-4 rounded-2xl bg-slate-950 text-amber-400 text-xs font-black uppercase tracking-widest disabled:opacity-40">{saving ? 'Saving...' : form.id ? 'Update Video' : 'Add Video'}</button>
            {form.id && <button type="button" onClick={resetForm} className="px-5 rounded-2xl bg-slate-100 text-slate-700 text-xs font-black uppercase tracking-widest">Cancel</button>}
          </div>
        </form>

        <div className="space-y-4">
          <div className="bg-white border border-slate-100 rounded-[2rem] p-5 shadow-sm">
            <div className="flex flex-col md:flex-row gap-3">
              <input value={queryText} onChange={(e) => setQueryText(e.target.value)} placeholder="Search videos, courses, tags..." className="flex-1 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
              <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-black outline-none">
                <option value="all">All courses</option>
                {courses.map((course) => <option key={course} value={course}>{course}</option>)}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-52 rounded-[2rem] bg-slate-200 animate-pulse"></div>)}</div>
          ) : filteredLessons.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-200 rounded-[2rem] p-10 text-center">
              <p className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">No videos found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredLessons.map((lesson) => (
                <article key={lesson.id} className="bg-white border border-slate-100 rounded-[2rem] overflow-hidden shadow-sm">
                  <img src={lesson.thumbnail} alt="" className="w-full aspect-video object-cover bg-slate-200" />
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-black text-slate-950 leading-tight">{lesson.title}</h3>
                        <p className="mt-1 text-xs font-black uppercase tracking-widest text-slate-400">{lesson.course} / {lesson.category}</p>
                      </div>
                      <span className={`shrink-0 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${lesson.isPublished ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{lesson.visibility}</span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-2xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase text-slate-400">Order</p><p className="font-black text-slate-900">{lesson.order || 1}</p></div>
                      <div className="rounded-2xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase text-slate-400">Time</p><p className="font-black text-slate-900">{lesson.duration ? formatVideoDuration(lesson.duration) : '-'}</p></div>
                      <div className="rounded-2xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase text-slate-400">Views</p><p className="font-black text-slate-900">{lesson.viewCount || 0}</p></div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button onClick={() => moveLesson(lesson, -1)} className="px-3 py-2 rounded-xl bg-slate-100 text-xs font-black uppercase text-slate-600">Up</button>
                      <button onClick={() => moveLesson(lesson, 1)} className="px-3 py-2 rounded-xl bg-slate-100 text-xs font-black uppercase text-slate-600">Down</button>
                      <button onClick={() => updateDoc(doc(db, VIDEO_LESSONS_COLLECTION, lesson.id), { visibility: lesson.isPublished ? 'draft' : 'published', isPublished: !lesson.isPublished, updatedAt: new Date().toISOString() })} className="px-3 py-2 rounded-xl bg-amber-50 text-xs font-black uppercase text-amber-700">{lesson.isPublished ? 'Unpublish' : 'Publish'}</button>
                      <button onClick={() => editLesson(lesson)} className="px-3 py-2 rounded-xl bg-sky-50 text-xs font-black uppercase text-sky-700">Edit</button>
                      <button onClick={() => removeLesson(lesson)} className="px-3 py-2 rounded-xl bg-red-50 text-xs font-black uppercase text-red-600">Delete</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default AdminVideoManager;
