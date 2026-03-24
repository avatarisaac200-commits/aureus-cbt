import React, { useEffect, useMemo, useState } from 'react';
import { User, DirectConversation, DirectMessage, ForumChannel, ForumReply, ForumThread } from '../types';
import { db } from '../firebase';
import { addDoc, collection, deleteDoc, doc, getDoc, increment, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { toast } from './ui/Toast';
import { confirmDialog } from './ui/ConfirmDialog';

interface CommunityHubProps {
  user: User;
  isReadOnly?: boolean;
}

type CommunityMode = 'threads' | 'messages';

type ChatTarget = {
  id: string;
  name: string;
  title?: string;
  avatarUrl?: string;
};

const CHANNELS: Array<'all' | ForumChannel> = ['all', 'general', 'questions', 'resources', 'wins'];

const formatRelativeTime = (value?: string) => {
  const ts = Date.parse(value || '');
  if (!Number.isFinite(ts)) return 'now';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
};

const buildConversationId = (a: string, b: string) => [a, b].sort().join('__');

const CommunityHub: React.FC<CommunityHubProps> = ({ user, isReadOnly = false }) => {
  const [mode, setMode] = useState<CommunityMode>('threads');
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<'all' | ForumChannel>('all');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [replies, setReplies] = useState<ForumReply[]>([]);
  const [threadTitle, setThreadTitle] = useState('');
  const [threadBody, setThreadBody] = useState('');
  const [threadChannel, setThreadChannel] = useState<ForumChannel>('general');
  const [replyBody, setReplyBody] = useState('');
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [messageBody, setMessageBody] = useState('');

  useEffect(() => {
    const threadQuery = query(collection(db, 'forumThreads'), orderBy('latestActivityAt', 'desc'), limit(120));
    return onSnapshot(threadQuery, (snap) => {
      const rows = snap.docs.map((entry) => ({ id: entry.id, ...(entry.data() as Omit<ForumThread, 'id'>) }));
      setThreads(rows);
      setSelectedThreadId((current) => current && rows.some((thread) => thread.id === current) ? current : rows[0]?.id || null);
    });
  }, []);

  useEffect(() => {
    const conversationQuery = query(collection(db, 'directConversations'), where('participantIds', 'array-contains', user.id), limit(120));
    return onSnapshot(conversationQuery, (snap) => {
      const rows = snap.docs
        .map((entry) => ({ id: entry.id, ...(entry.data() as Omit<DirectConversation, 'id'>) }))
        .sort((a, b) => Date.parse(b.lastMessageAt || b.updatedAt || '') - Date.parse(a.lastMessageAt || a.updatedAt || ''));
      setConversations(rows);
      setSelectedConversationId((current) => current && rows.some((conversation) => conversation.id === current) ? current : rows[0]?.id || null);
    });
  }, [user.id]);

  const visibleThreads = useMemo(() => (
    selectedChannel === 'all' ? threads : threads.filter((thread) => thread.channel === selectedChannel)
  ), [selectedChannel, threads]);

  const selectedThread = visibleThreads.find((thread) => thread.id === selectedThreadId) || visibleThreads[0] || null;
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId) || conversations[0] || null;

  const selectedPeer = useMemo(() => {
    if (!selectedConversation) return null;
    const peerIndex = selectedConversation.participantIds.findIndex((id) => id !== user.id);
    if (peerIndex < 0) return null;
    return {
      id: selectedConversation.participantIds[peerIndex],
      name: selectedConversation.participantNames?.[peerIndex] || 'Student',
      title: selectedConversation.participantTitles?.[peerIndex] || 'Student'
    };
  }, [selectedConversation, user.id]);

  useEffect(() => {
    if (!selectedThread) {
      setReplies([]);
      return;
    }
    const repliesQuery = query(collection(db, 'forumThreads', selectedThread.id, 'replies'), orderBy('createdAt', 'asc'), limit(250));
    return onSnapshot(repliesQuery, (snap) => {
      setReplies(snap.docs.map((entry) => ({ id: entry.id, ...(entry.data() as Omit<ForumReply, 'id'>) })));
    });
  }, [selectedThread?.id]);

  useEffect(() => {
    if (!selectedConversation) {
      setMessages([]);
      return;
    }
    const messageQuery = query(collection(db, 'directConversations', selectedConversation.id, 'messages'), orderBy('createdAt', 'asc'), limit(400));
    return onSnapshot(messageQuery, (snap) => {
      setMessages(snap.docs.map((entry) => ({ id: entry.id, ...(entry.data() as Omit<DirectMessage, 'id'>) })));
    });
  }, [selectedConversation?.id]);

  const createThread = async () => {
    const title = threadTitle.trim();
    const body = threadBody.trim();
    if (!title || !body) {
      toast.error('Missing details', 'Add a thread title and message.');
      return;
    }
    if (isReadOnly) {
      toast.error('Read-only mode', 'Community posting is disabled.');
      return;
    }
    const now = new Date().toISOString();
    await addDoc(collection(db, 'forumThreads'), {
      channel: threadChannel,
      title,
      body,
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
  };

  const postReply = async () => {
    if (!selectedThread) return;
    const body = replyBody.trim();
    if (!body) {
      toast.error('Empty reply', 'Write a reply first.');
      return;
    }
    if (isReadOnly) {
      toast.error('Read-only mode', 'Replies are disabled.');
      return;
    }
    const now = new Date().toISOString();
    await addDoc(collection(db, 'forumThreads', selectedThread.id, 'replies'), {
      threadId: selectedThread.id,
      body,
      authorId: user.id,
      authorName: user.name,
      authorTitle: user.title || '',
      authorAvatarUrl: user.avatarUrl || '',
      createdAt: now
    });
    await updateDoc(doc(db, 'forumThreads', selectedThread.id), {
      latestActivityAt: now,
      lastReplyByName: user.name,
      lastReplyPreview: body.slice(0, 120),
      replyCount: increment(1)
    });
    setReplyBody('');
  };

  const openChat = async (target: ChatTarget) => {
    if (!target.id || target.id === user.id) return;
    const conversationId = buildConversationId(user.id, target.id);
    const conversationRef = doc(db, 'directConversations', conversationId);
    const existing = await getDoc(conversationRef);
    if (!existing.exists()) {
      const now = new Date().toISOString();
      await setDoc(conversationRef, {
        participantIds: [user.id, target.id],
        participantNames: [user.name, target.name],
        participantTitles: [user.title || 'Student', target.title || 'Student'],
        participantAvatarUrls: [user.avatarUrl || '', target.avatarUrl || ''],
        createdAt: now,
        updatedAt: now,
        lastMessageText: '',
        lastMessageAt: '',
        lastMessageSenderId: ''
      });
    }
    setMode('messages');
    setSelectedConversationId(conversationId);
  };

  const sendMessage = async () => {
    if (!selectedConversation) return;
    const body = messageBody.trim();
    if (!body) {
      toast.error('Empty message', 'Write a message first.');
      return;
    }
    if (isReadOnly) {
      toast.error('Read-only mode', 'Direct messages are disabled.');
      return;
    }
    const now = new Date().toISOString();
    await addDoc(collection(db, 'directConversations', selectedConversation.id, 'messages'), {
      conversationId: selectedConversation.id,
      authorId: user.id,
      authorName: user.name,
      body,
      createdAt: now
    });
    await updateDoc(doc(db, 'directConversations', selectedConversation.id), {
      updatedAt: now,
      lastMessageText: body.slice(0, 180),
      lastMessageAt: now,
      lastMessageSenderId: user.id
    });
    setMessageBody('');
  };

  const shareThread = async (thread: ForumThread) => {
    const text = `${thread.title}\n\n${thread.body}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: thread.title, text });
        return;
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
    }
    await navigator.clipboard?.writeText(text);
    toast.success('Copied', 'Thread copied to clipboard.');
  };

  const removeThread = async (thread: ForumThread) => {
    const confirmed = await confirmDialog({
      title: 'Delete thread?',
      message: 'This removes the thread from the community feed.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    if (confirmed) {
      await deleteDoc(doc(db, 'forumThreads', thread.id));
    }
  };

  const removeReply = async (reply: ForumReply) => {
    if (!selectedThread) return;
    const confirmed = await confirmDialog({
      title: 'Delete reply?',
      message: 'This removes your reply from the discussion.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    if (confirmed) {
      await deleteDoc(doc(db, 'forumThreads', selectedThread.id, 'replies', reply.id));
    }
  };

  return (
    <div className="space-y-4">
      <section className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-amber-600">Community Beta</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950 uppercase">Study Talk Lives Here</h2>
        </div>
        <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 gap-1">
          <button onClick={() => setMode('threads')} className={`rounded-xl px-4 py-3 text-xs font-black uppercase ${mode === 'threads' ? 'bg-slate-950 text-amber-500' : 'text-slate-600'}`}>Forum</button>
          <button onClick={() => setMode('messages')} className={`rounded-xl px-4 py-3 text-xs font-black uppercase ${mode === 'messages' ? 'bg-slate-950 text-amber-500' : 'text-slate-600'}`}>Inbox</button>
        </div>
      </section>

      {mode === 'threads' ? (
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div className="bg-white rounded-[2rem] border border-slate-100 p-4 space-y-3">
              <select value={threadChannel} onChange={(e) => setThreadChannel(e.target.value as ForumChannel)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                {CHANNELS.slice(1).map((channel) => <option key={channel} value={channel}>{channel}</option>)}
              </select>
              <input value={threadTitle} onChange={(e) => setThreadTitle(e.target.value)} placeholder="Thread title" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
              <textarea value={threadBody} onChange={(e) => setThreadBody(e.target.value)} rows={4} placeholder="Share context, what you tried, or what help you need." className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 resize-none" />
              <button onClick={createThread} className="w-full rounded-2xl bg-slate-950 px-5 py-4 text-xs font-black uppercase text-amber-500">Post Thread</button>
            </div>

            <div className="bg-white rounded-[2rem] border border-slate-100 p-4">
              <div className="flex flex-wrap gap-2 mb-4">
                {CHANNELS.map((channel) => (
                  <button key={channel} onClick={() => setSelectedChannel(channel)} className={`rounded-xl px-4 py-2 text-xs font-black uppercase ${selectedChannel === channel ? 'bg-slate-950 text-amber-500' : 'bg-slate-100 text-slate-600'}`}>
                    {channel}
                  </button>
                ))}
              </div>
              <div className="space-y-3 max-h-[60dvh] overflow-y-auto pr-1">
                {visibleThreads.map((thread) => (
                  <div key={thread.id} onClick={() => setSelectedThreadId(thread.id)} className={`rounded-[1.5rem] border px-4 py-4 cursor-pointer ${selectedThread?.id === thread.id ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                    <p className="text-[10px] font-black uppercase text-slate-400">{thread.channel} | {formatRelativeTime(thread.latestActivityAt)}</p>
                    <p className="mt-2 text-sm font-black uppercase text-slate-900">{thread.title}</p>
                    <p className="mt-2 text-xs text-slate-600 line-clamp-3">{thread.body}</p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-[11px] font-bold uppercase text-slate-500 truncate">{thread.authorName}</span>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={(event) => { event.stopPropagation(); void openChat({ id: thread.authorId, name: thread.authorName, title: thread.authorTitle, avatarUrl: thread.authorAvatarUrl }); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-600">Message</button>
                        <button onClick={(event) => { event.stopPropagation(); void shareThread(thread); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-600">Share</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-100 p-4 min-h-[620px] flex flex-col">
            {!selectedThread ? (
              <div className="flex-1 flex items-center justify-center text-slate-500">Pick a thread</div>
            ) : (
              <>
                <div className="border-b border-slate-100 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase text-slate-400">{selectedThread.channel} | {formatRelativeTime(selectedThread.createdAt)}</p>
                      <h3 className="mt-2 text-2xl font-black uppercase text-slate-950">{selectedThread.title}</h3>
                      <p className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">{selectedThread.body}</p>
                    </div>
                    {(selectedThread.authorId === user.id || user.role !== 'student') && (
                      <button onClick={() => void removeThread(selectedThread)} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-black uppercase text-red-600">Delete</button>
                    )}
                  </div>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-black uppercase text-slate-900">{selectedThread.authorName}</p>
                      <p className="text-[11px] font-bold uppercase text-slate-500">{selectedThread.authorTitle || 'Student'} | {selectedThread.replyCount || 0} replies</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => void openChat({ id: selectedThread.authorId, name: selectedThread.authorName, title: selectedThread.authorTitle, avatarUrl: selectedThread.authorAvatarUrl })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-600">Message</button>
                      <button onClick={() => void shareThread(selectedThread)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-600">Share</button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 min-h-0 py-4">
                  <div className="space-y-3 max-h-[48dvh] overflow-y-auto pr-1">
                    {replies.map((reply) => (
                      <div key={reply.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-black uppercase text-slate-900">{reply.authorName}</p>
                            <p className="text-[10px] font-black uppercase text-slate-400">{reply.authorTitle || 'Student'} | {formatRelativeTime(reply.createdAt)}</p>
                          </div>
                          {(reply.authorId === user.id || user.role !== 'student') && (
                            <button onClick={() => void removeReply(reply)} className="rounded-xl border border-red-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-red-500">Delete</button>
                          )}
                        </div>
                        <p className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">{reply.body}</p>
                        <div className="mt-3 flex justify-end">
                          <button onClick={() => void openChat({ id: reply.authorId, name: reply.authorName, title: reply.authorTitle, avatarUrl: reply.authorAvatarUrl })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-600">Message</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} rows={4} placeholder="Add a useful reply." className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 resize-none" />
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[11px] font-bold uppercase text-slate-400">Buttons now stack cleanly on mobile.</p>
                    <button onClick={postReply} className="rounded-2xl bg-slate-950 px-5 py-3 text-xs font-black uppercase text-amber-500">Post Reply</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      ) : (
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="bg-white rounded-[2rem] border border-slate-100 p-4">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-xs font-black uppercase text-slate-500">Inbox</p>
                <h3 className="text-lg font-bold text-slate-900">Your conversations</h3>
              </div>
              <span className="text-[10px] font-black uppercase text-slate-400">{conversations.length} chats</span>
            </div>
            <div className="space-y-3 max-h-[70dvh] overflow-y-auto pr-1">
              {conversations.map((conversation) => {
                const peerIndex = conversation.participantIds.findIndex((id) => id !== user.id);
                const peerName = peerIndex >= 0 ? conversation.participantNames?.[peerIndex] || 'Student' : 'Student';
                const peerTitle = peerIndex >= 0 ? conversation.participantTitles?.[peerIndex] || 'Student' : 'Student';
                return (
                  <button key={conversation.id} onClick={() => setSelectedConversationId(conversation.id)} className={`w-full rounded-[1.5rem] border px-4 py-4 text-left ${selectedConversation?.id === conversation.id ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                    <p className="text-sm font-black uppercase text-slate-900 truncate">{peerName}</p>
                    <p className="mt-1 text-[10px] font-black uppercase text-slate-500 truncate">{peerTitle}</p>
                    <p className="mt-2 truncate text-xs text-slate-600">{conversation.lastMessageText || 'No messages yet.'}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-100 p-4 min-h-[620px] flex flex-col">
            {!selectedConversation || !selectedPeer ? (
              <div className="flex-1 flex items-center justify-center text-slate-500">Pick a conversation</div>
            ) : (
              <>
                <div className="border-b border-slate-100 pb-4">
                  <p className="text-lg font-black uppercase text-slate-950">{selectedPeer.name}</p>
                  <p className="text-[11px] font-bold uppercase text-slate-500">{selectedPeer.title || 'Student'} | private study chat</p>
                </div>
                <div className="flex-1 min-h-0 py-4">
                  <div className="space-y-3 max-h-[52dvh] overflow-y-auto pr-1">
                    {messages.map((message) => {
                      const isMine = message.authorId === user.id;
                      return (
                        <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[82%] rounded-[1.5rem] px-4 py-3 ${isMine ? 'bg-slate-950 text-amber-500' : 'bg-slate-100 text-slate-800 border border-slate-200'}`}>
                            <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                            <p className={`mt-2 text-[10px] font-black uppercase ${isMine ? 'text-amber-200/80' : 'text-slate-400'}`}>{message.authorName} | {formatRelativeTime(message.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="border-t border-slate-100 pt-4">
                  <textarea value={messageBody} onChange={(e) => setMessageBody(e.target.value)} rows={4} placeholder="Send a private message." className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 resize-none" />
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[11px] font-bold uppercase text-slate-400">One-to-one only for now.</p>
                    <button onClick={sendMessage} className="rounded-2xl bg-slate-950 px-5 py-3 text-xs font-black uppercase text-amber-500">Send Message</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
};

export default CommunityHub;
