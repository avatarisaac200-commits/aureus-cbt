import React, { useEffect, useMemo, useState } from 'react';
import { User, ForumChannel, ForumReply, ForumThread } from '../types';
import { db } from '../firebase';
import { addDoc, collection, deleteDoc, doc, increment, limit, onSnapshot, orderBy, query, updateDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { toast } from './ui/Toast';
import { confirmDialog } from './ui/ConfirmDialog';

interface CommunityHubProps {
  user: User;
  isReadOnly?: boolean;
}

const CHANNELS: Array<{ id: 'all' | ForumChannel; label: string; description: string }> = [
  { id: 'all', label: 'All', description: 'Every conversation in one feed.' },
  { id: 'general', label: 'General', description: 'Campus talk, study life, and broad updates.' },
  { id: 'questions', label: 'Questions', description: 'Ask for help on hard questions and concepts.' },
  { id: 'resources', label: 'Resources', description: 'Share notes, mnemonics, and revision material.' },
  { id: 'wins', label: 'Wins', description: 'Celebrate scores, streaks, and breakthroughs.' }
];

const formatRelativeTime = (value?: string) => {
  const ts = Date.parse(value || '');
  if (!Number.isFinite(ts)) return 'now';
  const diff = Math.max(0, Date.now() - ts);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < day * 7) return `${Math.floor(diff / day)}d ago`;
  return new Date(ts).toLocaleDateString();
};

const CommunityHub: React.FC<CommunityHubProps> = ({ user, isReadOnly = false }) => {
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<'all' | ForumChannel>('all');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadTitle, setThreadTitle] = useState('');
  const [threadBody, setThreadBody] = useState('');
  const [threadChannel, setThreadChannel] = useState<ForumChannel>('general');
  const [isPostingThread, setIsPostingThread] = useState(false);
  const [replies, setReplies] = useState<ForumReply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [isPostingReply, setIsPostingReply] = useState(false);

  useEffect(() => {
    const threadQuery = query(collection(db, 'forumThreads'), orderBy('latestActivityAt', 'desc'), limit(120));
    const unsubscribe = onSnapshot(threadQuery, (snap) => {
      const nextThreads = snap.docs.map((entry) => ({ id: entry.id, ...(entry.data() as Omit<ForumThread, 'id'>) }));
      setThreads(nextThreads);
      setThreadsLoading(false);
      setThreadsError(null);
      setSelectedThreadId((current) => {
        if (current && nextThreads.some((thread) => thread.id === current)) return current;
        return nextThreads[0]?.id || null;
      });
    }, (error: any) => {
      console.error(error);
      setThreadsError('Could not load community threads.');
      setThreadsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const visibleThreads = useMemo(() => {
    return selectedChannel === 'all'
      ? threads
      : threads.filter((thread) => thread.channel === selectedChannel);
  }, [selectedChannel, threads]);

  const selectedThread = visibleThreads.find((thread) => thread.id === selectedThreadId) || visibleThreads[0] || null;

  useEffect(() => {
    if (!selectedThread) {
      setReplies([]);
      setRepliesLoading(false);
      return;
    }

    setRepliesLoading(true);
    const repliesQuery = query(
      collection(db, 'forumThreads', selectedThread.id, 'replies'),
      orderBy('createdAt', 'asc'),
      limit(250)
    );
    const unsubscribe = onSnapshot(repliesQuery, (snap) => {
      setReplies(snap.docs.map((entry) => ({ id: entry.id, ...(entry.data() as Omit<ForumReply, 'id'>) })));
      setRepliesLoading(false);
    }, (error: any) => {
      console.error(error);
      setReplies([]);
      setRepliesLoading(false);
    });

    return () => unsubscribe();
  }, [selectedThread?.id]);

  const createThread = async () => {
    const cleanTitle = threadTitle.trim();
    const cleanBody = threadBody.trim();
    if (!cleanTitle || !cleanBody) {
      toast.error('Missing details', 'Add a thread title and a message.');
      return;
    }
    if (cleanTitle.length < 6 || cleanBody.length < 12) {
      toast.error('Too short', 'Make the title and post a bit more descriptive.');
      return;
    }
    if (isReadOnly) {
      toast.error('Read-only mode', 'Community posting is disabled until activation.');
      return;
    }

    setIsPostingThread(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, 'forumThreads'), {
        channel: threadChannel,
        title: cleanTitle,
        body: cleanBody,
        authorId: user.id,
        authorName: user.name,
        authorTitle: user.title || '',
        authorAvatarUrl: user.avatarUrl || '',
        createdAt: now,
        latestActivityAt: now,
        replyCount: 0,
        lastReplyByName: '',
        lastReplyPreview: ''
      });
      setThreadTitle('');
      setThreadBody('');
      setThreadChannel('general');
      toast.success('Thread posted', 'Your discussion is now live.');
    } catch (error) {
      console.error(error);
      toast.error('Post failed', 'Could not create thread.');
    } finally {
      setIsPostingThread(false);
    }
  };

  const postReply = async () => {
    if (!selectedThread) return;
    const cleanBody = replyBody.trim();
    if (!cleanBody) {
      toast.error('Empty reply', 'Write a reply first.');
      return;
    }
    if (isReadOnly) {
      toast.error('Read-only mode', 'Replies are disabled until activation.');
      return;
    }

    setIsPostingReply(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, 'forumThreads', selectedThread.id, 'replies'), {
        threadId: selectedThread.id,
        body: cleanBody,
        authorId: user.id,
        authorName: user.name,
        authorTitle: user.title || '',
        authorAvatarUrl: user.avatarUrl || '',
        createdAt: now
      });
      await updateDoc(doc(db, 'forumThreads', selectedThread.id), {
        latestActivityAt: now,
        lastReplyByName: user.name,
        lastReplyPreview: cleanBody.slice(0, 120),
        replyCount: increment(1)
      });
      setReplyBody('');
      toast.success('Reply posted', 'Your reply has been added.');
    } catch (error) {
      console.error(error);
      toast.error('Reply failed', 'Could not post reply.');
    } finally {
      setIsPostingReply(false);
    }
  };

  const deleteThread = async (thread: ForumThread) => {
    const confirmed = await confirmDialog({
      title: 'Delete thread?',
      message: 'This removes the thread from the community feed. Existing replies in the subcollection may remain in Firestore unless cleaned up separately.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, 'forumThreads', thread.id));
      toast.success('Thread deleted', 'The thread has been removed.');
    } catch (error) {
      console.error(error);
      toast.error('Delete failed', 'Could not delete thread.');
    }
  };

  const deleteReply = async (reply: ForumReply) => {
    if (!selectedThread) return;
    const confirmed = await confirmDialog({
      title: 'Delete reply?',
      message: 'This removes your reply from the discussion.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, 'forumThreads', selectedThread.id, 'replies', reply.id));
      await updateDoc(doc(db, 'forumThreads', selectedThread.id), {
        latestActivityAt: new Date().toISOString(),
        replyCount: increment(-1)
      });
      toast.success('Reply deleted', 'The reply has been removed.');
    } catch (error) {
      console.error(error);
      toast.error('Delete failed', 'Could not delete reply.');
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-100 rounded-[2rem] p-6 md:p-8 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
          <div className="max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.28em] text-amber-600">Community Beta</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950 uppercase leading-none">Study Talk Lives Here</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Turn the CBT app into a living study network. Ask for help, share resources, celebrate wins, and keep every conversation tied to actual exam prep.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 lg:min-w-[320px]">
            {CHANNELS.slice(1).map((channel) => {
              const count = threads.filter((thread) => thread.channel === channel.id).length;
              return (
                <div key={channel.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">{channel.label}</p>
                  <p className="mt-2 text-2xl font-black text-slate-950">{count}</p>
                  <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">{channel.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
        <div className="space-y-6">
          <div className="bg-white border border-slate-100 rounded-[2rem] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">New Thread</p>
                <h3 className="text-lg font-bold text-slate-900">Start a discussion</h3>
              </div>
              {isReadOnly && (
                <span className="px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-black uppercase tracking-widest">
                  Read only
                </span>
              )}
            </div>
            <div className="space-y-3">
              <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
                Channel
                <select
                  value={threadChannel}
                  onChange={(e) => setThreadChannel(e.target.value as ForumChannel)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900"
                >
                  {CHANNELS.slice(1).map((channel) => (
                    <option key={channel.id} value={channel.id}>{channel.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
                Title
                <input
                  value={threadTitle}
                  onChange={(e) => setThreadTitle(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Best way to revise cranial nerves?"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900"
                />
              </label>
              <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
                Post
                <textarea
                  value={threadBody}
                  onChange={(e) => setThreadBody(e.target.value)}
                  rows={5}
                  maxLength={1000}
                  placeholder="Share context, what you tried, or what help you need."
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 resize-none"
                />
              </label>
              <button
                type="button"
                onClick={createThread}
                disabled={isPostingThread}
                className="w-full rounded-2xl bg-slate-950 px-5 py-4 text-xs font-black uppercase tracking-widest text-amber-500 disabled:opacity-40"
              >
                {isPostingThread ? 'Posting...' : 'Post Thread'}
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-[2rem] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">Channels</p>
                <h3 className="text-lg font-bold text-slate-900">Choose a feed</h3>
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">{visibleThreads.length} threads</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => setSelectedChannel(channel.id)}
                  className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest ${
                    selectedChannel === channel.id
                      ? 'bg-slate-950 text-amber-500'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {channel.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-[2rem] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">Live Feed</p>
                <h3 className="text-lg font-bold text-slate-900">Recent threads</h3>
              </div>
            </div>
            {threadsLoading ? (
              <p className="py-16 text-center text-xs font-black uppercase tracking-widest text-slate-400">Loading community...</p>
            ) : threadsError ? (
              <p className="py-16 text-center text-xs font-black uppercase tracking-widest text-red-600">{threadsError}</p>
            ) : visibleThreads.length === 0 ? (
              <p className="py-16 text-center text-xs font-black uppercase tracking-widest text-slate-400">No threads yet in this channel.</p>
            ) : (
              <div className="space-y-3 max-h-[70dvh] overflow-y-auto pr-1">
                {visibleThreads.map((thread) => {
                  const isActive = selectedThread?.id === thread.id;
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => setSelectedThreadId(thread.id)}
                      className={`w-full text-left rounded-[1.5rem] border px-4 py-4 transition-all ${
                        isActive ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="rounded-full bg-white border border-slate-200 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                              {thread.channel}
                            </span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{formatRelativeTime(thread.latestActivityAt)}</span>
                          </div>
                          <p className="text-sm font-black uppercase text-slate-900 leading-tight">{thread.title}</p>
                          <p className="mt-2 text-xs text-slate-600 line-clamp-3 leading-relaxed">{thread.body}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-lg font-black text-slate-900">{thread.replyCount || 0}</p>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Replies</p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                        <span className="font-bold uppercase tracking-widest truncate">{thread.authorName}</span>
                        {thread.lastReplyByName ? (
                          <span className="truncate">Latest by {thread.lastReplyByName}</span>
                        ) : (
                          <span>No replies yet</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-[2rem] p-5 md:p-6 shadow-sm min-h-[620px]">
          {!selectedThread ? (
            <div className="h-full min-h-[420px] flex items-center justify-center text-center">
              <div className="max-w-md">
                <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-400">Community</p>
                <h3 className="mt-2 text-2xl font-black uppercase text-slate-950">Pick a thread</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-500">
                  Open a discussion from the live feed or start a new one from the composer.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="border-b border-slate-100 pb-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-amber-700">
                        {selectedThread.channel}
                      </span>
                      <span className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
                        {formatRelativeTime(selectedThread.createdAt)}
                      </span>
                    </div>
                    <h3 className="text-2xl font-black uppercase leading-tight text-slate-950">{selectedThread.title}</h3>
                    <p className="mt-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">{selectedThread.body}</p>
                  </div>
                  {(selectedThread.authorId === user.id || user.role === 'admin' || user.role === 'root-admin') && (
                    <button
                      type="button"
                      onClick={() => deleteThread(selectedThread)}
                      className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-600"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <div className="mt-5 flex items-center gap-3">
                  <div className="h-11 w-11 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 flex items-center justify-center text-xs font-black text-slate-500">
                    {selectedThread.authorAvatarUrl ? (
                      <img src={selectedThread.authorAvatarUrl} alt={selectedThread.authorName} className="h-full w-full object-cover" />
                    ) : (
                      selectedThread.authorName.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black uppercase text-slate-900 truncate">{selectedThread.authorName}</p>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 truncate">
                      {selectedThread.authorTitle || 'Student'} • {selectedThread.replyCount || 0} replies
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex-1 min-h-0 py-5">
                {repliesLoading ? (
                  <p className="py-16 text-center text-xs font-black uppercase tracking-widest text-slate-400">Loading replies...</p>
                ) : replies.length === 0 ? (
                  <div className="py-16 text-center">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">No replies yet</p>
                    <p className="mt-2 text-sm text-slate-500">Be the first person to answer this thread.</p>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-[52dvh] overflow-y-auto pr-1">
                    {replies.map((reply) => (
                      <div key={reply.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-10 w-10 overflow-hidden rounded-2xl border border-slate-200 bg-white flex items-center justify-center text-xs font-black text-slate-500">
                              {reply.authorAvatarUrl ? (
                                <img src={reply.authorAvatarUrl} alt={reply.authorName} className="h-full w-full object-cover" />
                              ) : (
                                reply.authorName.slice(0, 2).toUpperCase()
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-black uppercase text-slate-900 truncate">{reply.authorName}</p>
                              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
                                {reply.authorTitle || 'Student'} • {formatRelativeTime(reply.createdAt)}
                              </p>
                            </div>
                          </div>
                          {(reply.authorId === user.id || user.role === 'admin' || user.role === 'root-admin') && (
                            <button
                              type="button"
                              onClick={() => deleteReply(reply)}
                              className="rounded-xl border border-red-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-500"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{reply.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-5">
                <label className="block text-xs font-black uppercase tracking-widest text-slate-500">
                  Add Reply
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={4}
                    maxLength={1000}
                    placeholder="Add a useful reply, correction, mnemonic, or resource."
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 resize-none"
                  />
                </label>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                    First social layer shipped: threaded forum.
                  </p>
                  <button
                    type="button"
                    onClick={postReply}
                    disabled={isPostingReply}
                    className="rounded-2xl bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-widest text-amber-500 disabled:opacity-40"
                  >
                    {isPostingReply ? 'Replying...' : 'Post Reply'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default CommunityHub;
