import React, { useEffect, useMemo, useState } from 'react';
import { User, CommunityProfile, DirectConversation, DirectMessage, ForumChannel, ForumReply, ForumThread, FriendRequest, Friendship } from '../types';
import { db } from '../firebase';
import { addDoc, collection, deleteDoc, doc, increment, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { toast } from './ui/Toast';
import { confirmDialog } from './ui/ConfirmDialog';

interface CommunityHubProps {
  user: User;
  isReadOnly?: boolean;
  onOpenSocialProfileSetup?: () => void;
}

type CommunityMode = 'discover' | 'friends' | 'messages' | 'threads';

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

const buildPairId = (a: string, b: string) => [a, b].sort().join('__');
const initialsFor = (value?: string) => String(value || 'U').trim().slice(0, 2).toUpperCase();

const CommunityHub: React.FC<CommunityHubProps> = ({ user, isReadOnly = false, onOpenSocialProfileSetup }) => {
  const [mode, setMode] = useState<CommunityMode>('discover');
  const [profiles, setProfiles] = useState<CommunityProfile[]>([]);
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<'all' | ForumChannel>('all');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [replies, setReplies] = useState<ForumReply[]>([]);
  const [threadTitle, setThreadTitle] = useState('');
  const [threadBody, setThreadBody] = useState('');
  const [threadChannel, setThreadChannel] = useState<ForumChannel>('general');
  const [replyBody, setReplyBody] = useState('');
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [receivedRequests, setReceivedRequests] = useState<FriendRequest[]>([]);
  const [sentRequests, setSentRequests] = useState<FriendRequest[]>([]);
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [messageBody, setMessageBody] = useState('');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [requestNotes, setRequestNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    const now = new Date().toISOString();
    void setDoc(doc(db, 'communityProfiles', user.id), {
      userId: user.id,
      displayName: user.name,
      title: user.title || '',
      avatarUrl: user.avatarUrl || '',
      discoverable: true,
      lastActiveAt: now
    }, { merge: true });
  }, [user.id, user.name, user.title, user.avatarUrl]);

  useEffect(() => {
    const threadQuery = query(collection(db, 'forumThreads'), orderBy('latestActivityAt', 'desc'), limit(120));
    return onSnapshot(threadQuery, (snap) => {
      const rows = snap.docs.map((entry) => ({ id: entry.id, ...(entry.data() as Omit<ForumThread, 'id'>) }));
      setThreads(rows);
      setSelectedThreadId((current) => current && rows.some((thread) => thread.id === current) ? current : rows[0]?.id || null);
    });
  }, []);

  useEffect(() => {
    const profileQuery = query(collection(db, 'communityProfiles'), orderBy('lastActiveAt', 'desc'), limit(150));
    return onSnapshot(profileQuery, (snap) => {
      setProfiles(snap.docs.map((entry) => ({ id: entry.id, ...(entry.data() as Omit<CommunityProfile, 'id'>) })));
    });
  }, []);

  useEffect(() => {
    const friendshipQuery = query(collection(db, 'friendships'), where('memberIds', 'array-contains', user.id), limit(150));
    return onSnapshot(friendshipQuery, (snap) => {
      const rows = snap.docs
        .map((entry) => ({ id: entry.id, ...(entry.data() as Omit<Friendship, 'id'>) }))
        .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));
      setFriendships(rows);
    });
  }, [user.id]);

  useEffect(() => {
    const incomingQuery = query(collection(db, 'friendRequests'), where('recipientId', '==', user.id), limit(150));
    return onSnapshot(incomingQuery, (snap) => {
      const rows = snap.docs
        .map((entry) => ({ id: entry.id, ...(entry.data() as Omit<FriendRequest, 'id'>) }))
        .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || '') - Date.parse(a.updatedAt || a.createdAt || ''));
      setReceivedRequests(rows);
    });
  }, [user.id]);

  useEffect(() => {
    const outgoingQuery = query(collection(db, 'friendRequests'), where('senderId', '==', user.id), limit(150));
    return onSnapshot(outgoingQuery, (snap) => {
      const rows = snap.docs
        .map((entry) => ({ id: entry.id, ...(entry.data() as Omit<FriendRequest, 'id'>) }))
        .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || '') - Date.parse(a.updatedAt || a.createdAt || ''));
      setSentRequests(rows);
    });
  }, [user.id]);

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

  const profileMap = useMemo(() => Object.fromEntries(profiles.map((profile) => [profile.userId, profile] as const)), [profiles]);

  const friendshipByPeerId = useMemo(() => {
    const map: Record<string, Friendship> = {};
    friendships.forEach((friendship) => {
      const peerId = friendship.memberIds.find((id) => id !== user.id);
      if (peerId) map[peerId] = friendship;
    });
    return map;
  }, [friendships, user.id]);

  const pendingSentByRecipient = useMemo(() => {
    const map: Record<string, FriendRequest> = {};
    sentRequests.filter((request) => request.status === 'pending').forEach((request) => {
      map[request.recipientId] = request;
    });
    return map;
  }, [sentRequests]);

  const pendingReceivedBySender = useMemo(() => {
    const map: Record<string, FriendRequest> = {};
    receivedRequests.filter((request) => request.status === 'pending').forEach((request) => {
      map[request.senderId] = request;
    });
    return map;
  }, [receivedRequests]);

  const selectedThread = visibleThreads.find((thread) => thread.id === selectedThreadId) || visibleThreads[0] || null;
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId) || conversations[0] || null;

  const selectedPeer = useMemo(() => {
    if (!selectedConversation) return null;
    const peerId = selectedConversation.participantIds.find((id) => id !== user.id);
    if (!peerId) return null;
    const peerIndex = selectedConversation.participantIds.findIndex((id) => id === peerId);
    return profileMap[peerId] || {
      id: peerId,
      userId: peerId,
      displayName: selectedConversation.participantNames[peerIndex] || 'Student',
      title: selectedConversation.participantTitles?.[peerIndex] || 'Student',
      avatarUrl: selectedConversation.participantAvatarUrls?.[peerIndex] || '',
      discoverable: true
    };
  }, [profileMap, selectedConversation, user.id]);

  const visibleProfiles = useMemo(() => {
    const term = peopleQuery.trim().toLowerCase();
    return profiles
      .filter((profile) => profile.userId !== user.id && profile.discoverable !== false)
      .filter((profile) => {
        if (!term) return true;
        return [profile.displayName, profile.title, profile.bio, profile.institution, profile.yearOfStudy, ...(profile.studyInterests || [])]
          .join(' ')
          .toLowerCase()
          .includes(term);
      });
  }, [peopleQuery, profiles, user.id]);

  const friendProfiles = useMemo(() => friendships.map((friendship) => {
    const peerId = friendship.memberIds.find((id) => id !== user.id) || '';
    const peerIndex = friendship.memberIds.findIndex((id) => id === peerId);
    return profileMap[peerId] || {
      id: peerId,
      userId: peerId,
      displayName: friendship.memberNames[peerIndex] || 'Student',
      title: friendship.memberTitles?.[peerIndex] || 'Student',
      avatarUrl: friendship.memberAvatarUrls?.[peerIndex] || '',
      discoverable: true
    };
  }), [friendships, profileMap, user.id]);

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

  useEffect(() => {
    if (!selectedConversation || !messages.length) return;
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.authorId === user.id) return;
    void updateDoc(doc(db, 'directConversations', selectedConversation.id), {
      [`lastReadAtBy.${user.id}`]: new Date().toISOString()
    }).catch(() => undefined);
  }, [messages, selectedConversation, user.id]);

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

  const ensureConversation = async (profile: CommunityProfile, friendship?: Friendship | null) => {
    const conversationId = buildPairId(user.id, profile.userId);
    const conversationRef = doc(db, 'directConversations', conversationId);
    const now = new Date().toISOString();
    const conversation: DirectConversation = {
      id: conversationId,
      participantIds: [user.id, profile.userId],
      participantNames: [user.name, profile.displayName],
      participantTitles: [user.title || 'Student', profile.title || 'Student'],
      participantAvatarUrls: [user.avatarUrl || '', profile.avatarUrl || ''],
      participantProfileIds: [user.id, profile.userId],
      friendshipId: friendship?.id || buildPairId(user.id, profile.userId),
      createdAt: now,
      updatedAt: now,
      lastReadAtBy: {
        [user.id]: now,
        [profile.userId]: now
      }
    };
    await setDoc(conversationRef, conversation, { merge: true });
    setConversations((current) => (
      current.some((item) => item.id === conversationId)
        ? current.map((item) => item.id === conversationId ? { ...conversation, ...item } : item)
        : [conversation, ...current]
    ));
    setMode('messages');
    setSelectedConversationId(conversationId);
  };

  const openChat = async (profile: CommunityProfile) => {
    const friendship = friendshipByPeerId[profile.userId];
    if (!friendship) {
      toast.warning('Friends only', 'Send or accept a friend request before starting a private chat.');
      return;
    }
    try {
      await ensureConversation(profile, friendship);
    } catch (error: any) {
      toast.error('Chat unavailable', error?.message || 'Could not open this conversation.');
    }
  };

  const acceptFriendRequest = async (request: FriendRequest) => {
    if (isReadOnly) {
      toast.error('Read-only mode', 'Friend requests are disabled.');
      return;
    }
    const now = new Date().toISOString();
    const friendshipId = buildPairId(request.senderId, request.recipientId);
    await setDoc(doc(db, 'friendships', friendshipId), {
      memberIds: [request.senderId, request.recipientId].sort(),
      memberNames: [request.senderName, request.recipientName],
      memberTitles: [request.senderTitle || 'Student', request.recipientTitle || 'Student'],
      memberAvatarUrls: [request.senderAvatarUrl || '', request.recipientAvatarUrl || ''],
      memberProfileIds: [request.senderProfileId || request.senderId, request.recipientProfileId || request.recipientId],
      createdAt: now,
      updatedAt: now
    }, { merge: true });
    await updateDoc(doc(db, 'friendRequests', request.id), {
      status: 'accepted',
      updatedAt: now,
      respondedAt: now
    });
    toast.success('Friend added', `${request.senderName} is now in your friends list.`);
  };

  const sendFriendRequest = async (profile: CommunityProfile) => {
    if (profile.userId === user.id) return;
    if (isReadOnly) {
      toast.error('Read-only mode', 'Friend requests are disabled.');
      return;
    }
    if (friendshipByPeerId[profile.userId]) {
      toast.info('Already friends', 'You can message this person from your friends list.');
      return;
    }
    if (pendingSentByRecipient[profile.userId]) {
      toast.info('Already sent', 'Your request is still pending.');
      return;
    }
    const incoming = pendingReceivedBySender[profile.userId];
    if (incoming) {
      await acceptFriendRequest(incoming);
      return;
    }
    const now = new Date().toISOString();
    const note = (requestNotes[profile.userId] || '').trim();
    await addDoc(collection(db, 'friendRequests'), {
      senderId: user.id,
      senderName: user.name,
      senderTitle: user.title || '',
      senderAvatarUrl: user.avatarUrl || '',
      senderProfileId: user.id,
      recipientId: profile.userId,
      recipientName: profile.displayName,
      recipientTitle: profile.title || '',
      recipientAvatarUrl: profile.avatarUrl || '',
      recipientProfileId: profile.userId,
      note,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    });
    setRequestNotes((prev) => ({ ...prev, [profile.userId]: '' }));
    toast.success('Request sent', `Your friend request was sent to ${profile.displayName}.`);
  };

  const updateRequestStatus = async (request: FriendRequest, status: FriendRequest['status']) => {
    const now = new Date().toISOString();
    await updateDoc(doc(db, 'friendRequests', request.id), { status, updatedAt: now, respondedAt: now });
  };

  const sendMessage = async () => {
    if (!selectedConversation || !selectedPeer) return;
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
      lastMessageSenderId: user.id,
      [`lastReadAtBy.${user.id}`]: now
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

  const unreadCountForConversation = (conversation: DirectConversation) => {
    const lastMessageAt = Date.parse(conversation.lastMessageAt || '');
    const lastReadAt = Date.parse(conversation.lastReadAtBy?.[user.id] || '');
    if (!Number.isFinite(lastMessageAt)) return 0;
    if (conversation.lastMessageSenderId === user.id) return 0;
    return !Number.isFinite(lastReadAt) || lastMessageAt > lastReadAt ? 1 : 0;
  };

  return (
    <div className="space-y-4">
      <section className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-amber-600">Community Network</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950 uppercase">Meet People, Build Your Circle, Then Chat</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">Discovery feeds new people into your network, requests turn into friendships, and private chat stays relationship-based instead of random inbox spam.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onOpenSocialProfileSetup ? (
              <button onClick={onOpenSocialProfileSetup} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-700">
                Edit Profile
              </button>
            ) : null}
            <div className="flex w-full flex-wrap rounded-2xl border border-slate-200 bg-slate-50 p-1 gap-1 sm:w-auto sm:inline-flex">
              <button onClick={() => setMode('discover')} className={`flex-1 sm:flex-none rounded-xl px-4 py-3 text-xs font-black uppercase ${mode === 'discover' ? 'bg-slate-950 text-amber-500' : 'text-slate-600'}`}>People</button>
              <button onClick={() => setMode('friends')} className={`flex-1 sm:flex-none rounded-xl px-4 py-3 text-xs font-black uppercase ${mode === 'friends' ? 'bg-slate-950 text-amber-500' : 'text-slate-600'}`}>Friends</button>
              <button onClick={() => setMode('messages')} className={`flex-1 sm:flex-none rounded-xl px-4 py-3 text-xs font-black uppercase ${mode === 'messages' ? 'bg-slate-950 text-amber-500' : 'text-slate-600'}`}>Chat</button>
              <button onClick={() => setMode('threads')} className={`flex-1 sm:flex-none rounded-xl px-4 py-3 text-xs font-black uppercase ${mode === 'threads' ? 'bg-slate-950 text-amber-500' : 'text-slate-600'}`}>Forum</button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Discoverable People</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{visibleProfiles.length}</p>
          </div>
          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Pending Requests</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{receivedRequests.filter((item) => item.status === 'pending').length + sentRequests.filter((item) => item.status === 'pending').length}</p>
          </div>
          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Unread Chats</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{conversations.reduce((sum, conversation) => sum + unreadCountForConversation(conversation), 0)}</p>
          </div>
        </div>
      </section>

      {mode === 'discover' && (
        <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] gap-4">
          <div className="bg-white rounded-[2rem] border border-slate-100 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
              <div>
                <p className="text-xs font-black uppercase text-slate-500">People Directory</p>
                <h3 className="text-lg font-bold text-slate-900">Meet new people in the app</h3>
              </div>
              <input value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} placeholder="Search by name, level, bio, or interest" className="w-full sm:w-80 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 xl:max-h-[72dvh] xl:overflow-y-auto pr-1">
              {visibleProfiles.map((profile) => {
                const isFriend = Boolean(friendshipByPeerId[profile.userId]);
                const sentRequest = pendingSentByRecipient[profile.userId];
                const receivedRequest = pendingReceivedBySender[profile.userId];
                return (
                  <div key={profile.id} className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-14 w-14 rounded-2xl overflow-hidden bg-white border border-slate-200 flex items-center justify-center text-sm font-black text-slate-500 shrink-0">
                        {profile.avatarUrl ? <img src={profile.avatarUrl} alt={profile.displayName} className="h-full w-full object-cover" /> : initialsFor(profile.displayName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-black uppercase text-slate-900 truncate">{profile.displayName}</p>
                            <p className="text-[11px] font-bold uppercase text-slate-500 truncate">{profile.title || 'Student'}</p>
                          </div>
                          <span className="rounded-full bg-white border border-slate-200 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500">{formatRelativeTime(profile.lastActiveAt)}</span>
                        </div>
                        <p className="mt-3 text-sm text-slate-600 line-clamp-3">{profile.bio || 'No bio yet.'}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(profile.studyInterests || []).slice(0, 4).map((interest) => (
                            <span key={interest} className="rounded-full bg-white border border-slate-200 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500">{interest}</span>
                          ))}
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-2">
                          <input
                            value={requestNotes[profile.userId] || ''}
                            onChange={(e) => setRequestNotes((prev) => ({ ...prev, [profile.userId]: e.target.value }))}
                            placeholder="Optional intro note"
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs outline-none"
                          />
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {isFriend ? (
                              <button onClick={() => void openChat(profile)} className="rounded-xl bg-slate-950 px-4 py-3 text-xs font-black uppercase text-amber-500">Message</button>
                            ) : receivedRequest ? (
                              <button onClick={() => void acceptFriendRequest(receivedRequest)} className="rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase text-white">Accept Request</button>
                            ) : (
                              <button onClick={() => void sendFriendRequest(profile)} className="rounded-xl bg-slate-950 px-4 py-3 text-xs font-black uppercase text-amber-500">{sentRequest ? 'Pending' : 'Add Friend'}</button>
                            )}
                            <button onClick={() => setMode('threads')} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase text-slate-600">Forum</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-white rounded-[2rem] border border-slate-100 p-4">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-xs font-black uppercase text-slate-500">Received</p>
                  <h3 className="text-lg font-bold text-slate-900">Friend requests</h3>
                </div>
                <span className="text-[10px] font-black uppercase text-slate-400">{receivedRequests.filter((item) => item.status === 'pending').length} pending</span>
              </div>
              <div className="space-y-3 xl:max-h-[34dvh] xl:overflow-y-auto pr-1">
                {receivedRequests.filter((item) => item.status === 'pending').map((request) => (
                  <div key={request.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-black uppercase text-slate-900">{request.senderName}</p>
                    <p className="text-[11px] font-bold uppercase text-slate-500">{request.senderTitle || 'Student'} | {formatRelativeTime(request.createdAt)}</p>
                    {request.note ? <p className="mt-3 text-sm text-slate-600 whitespace-pre-wrap">{request.note}</p> : null}
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button onClick={() => void acceptFriendRequest(request)} className="rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase text-white">Accept</button>
                      <button onClick={() => void updateRequestStatus(request, 'declined')} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase text-slate-600">Decline</button>
                    </div>
                  </div>
                ))}
                {receivedRequests.filter((item) => item.status === 'pending').length === 0 ? (
                  <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">No incoming requests right now.</div>
                ) : null}
              </div>
            </div>

            <div className="bg-white rounded-[2rem] border border-slate-100 p-4">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-xs font-black uppercase text-slate-500">Sent</p>
                  <h3 className="text-lg font-bold text-slate-900">Outgoing requests</h3>
                </div>
                <span className="text-[10px] font-black uppercase text-slate-400">{sentRequests.filter((item) => item.status === 'pending').length} pending</span>
              </div>
              <div className="space-y-3 xl:max-h-[34dvh] xl:overflow-y-auto pr-1">
                {sentRequests.filter((item) => item.status === 'pending').map((request) => (
                  <div key={request.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-black uppercase text-slate-900">{request.recipientName}</p>
                    <p className="text-[11px] font-bold uppercase text-slate-500">{request.recipientTitle || 'Student'} | {formatRelativeTime(request.createdAt)}</p>
                    {request.note ? <p className="mt-3 text-sm text-slate-600 whitespace-pre-wrap">{request.note}</p> : null}
                    <button onClick={() => void updateRequestStatus(request, 'cancelled')} className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase text-slate-600">Cancel Request</button>
                  </div>
                ))}
                {sentRequests.filter((item) => item.status === 'pending').length === 0 ? (
                  <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">You have not sent any open requests.</div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      )}

      {mode === 'friends' && (
        <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-4">
          <div className="bg-white rounded-[2rem] border border-slate-100 p-4">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-xs font-black uppercase text-slate-500">Friends</p>
                <h3 className="text-lg font-bold text-slate-900">Your network</h3>
              </div>
              <span className="text-[10px] font-black uppercase text-slate-400">{friendProfiles.length} connected</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 xl:max-h-[74dvh] xl:overflow-y-auto pr-1">
              {friendProfiles.map((profile) => (
                <div key={profile.userId} className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-14 w-14 rounded-2xl overflow-hidden bg-white border border-slate-200 flex items-center justify-center text-sm font-black text-slate-500 shrink-0">
                      {profile.avatarUrl ? <img src={profile.avatarUrl} alt={profile.displayName} className="h-full w-full object-cover" /> : initialsFor(profile.displayName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black uppercase text-slate-900 truncate">{profile.displayName}</p>
                      <p className="text-[11px] font-bold uppercase text-slate-500 truncate">{profile.title || 'Student'}</p>
                      <p className="mt-3 text-sm text-slate-600 line-clamp-3">{profile.bio || 'No bio yet.'}</p>
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button onClick={() => void openChat(profile)} className="rounded-xl bg-slate-950 px-4 py-3 text-xs font-black uppercase text-amber-500">Message</button>
                        <button onClick={() => setMode('messages')} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase text-slate-600">Open Chat</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {friendProfiles.length === 0 ? (
                <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">No friends yet. Start in People, send a few requests, and your chat list will become usable.</div>
              ) : null}
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-100 p-4">
            <p className="text-xs font-black uppercase text-slate-500">Profile Signals</p>
            <h3 className="text-lg font-bold text-slate-900">What makes connections work</h3>
            <div className="mt-4 space-y-3">
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-black uppercase text-slate-900">Clear identity</p>
                <p className="mt-2 text-sm text-slate-600">A real name, level, and short bio reduce cold-start awkwardness in a study chat.</p>
              </div>
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-black uppercase text-slate-900">Intent before messaging</p>
                <p className="mt-2 text-sm text-slate-600">Friend requests let people opt in before the private inbox opens, which is standard for community safety.</p>
              </div>
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-black uppercase text-slate-900">Persistent discovery</p>
                <p className="mt-2 text-sm text-slate-600">People remain searchable by bio, level, and interests so the chat feature behaves like an actual social product.</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {mode === 'messages' && (
        <section className="grid grid-cols-1 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)] gap-4">
          <div className="bg-white rounded-[2rem] border border-slate-100 p-4">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-xs font-black uppercase text-slate-500">Inbox</p>
                <h3 className="text-lg font-bold text-slate-900">Friend conversations</h3>
              </div>
              <span className="text-[10px] font-black uppercase text-slate-400">{conversations.length} chats</span>
            </div>
            <div className="space-y-3 xl:max-h-[72dvh] xl:overflow-y-auto pr-1">
              {conversations.map((conversation) => {
                const peerId = conversation.participantIds.find((id) => id !== user.id) || '';
                const peer = profileMap[peerId];
                const peerIndex = conversation.participantIds.findIndex((id) => id === peerId);
                const peerName = peer?.displayName || conversation.participantNames[peerIndex] || 'Student';
                const peerTitle = peer?.title || conversation.participantTitles?.[peerIndex] || 'Student';
                const unread = unreadCountForConversation(conversation);
                return (
                  <button key={conversation.id} onClick={() => setSelectedConversationId(conversation.id)} className={`w-full rounded-[1.5rem] border px-4 py-4 text-left ${selectedConversation?.id === conversation.id ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-black uppercase text-slate-900 truncate">{peerName}</p>
                        <p className="mt-1 text-[10px] font-black uppercase text-slate-500 truncate">{peerTitle}</p>
                      </div>
                      {unread ? <span className="rounded-full bg-slate-950 px-2 py-1 text-[10px] font-black uppercase text-amber-500">New</span> : null}
                    </div>
                    <p className="mt-2 truncate text-xs text-slate-600">{conversation.lastMessageText || 'No messages yet.'}</p>
                  </button>
                );
              })}
              {conversations.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Your inbox appears after you add friends and start conversations.</div>
              ) : null}
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-100 p-4 min-h-[420px] sm:min-h-[640px] flex flex-col">
            {!selectedConversation || !selectedPeer ? (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-center px-6">Pick a friend conversation from the left. Private chat is relationship-based, so only accepted friends show up here.</div>
            ) : (
              <>
                <div className="border-b border-slate-100 pb-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-black uppercase text-slate-950 truncate">{selectedPeer.displayName}</p>
                    <p className="text-[11px] font-bold uppercase text-slate-500">{selectedPeer.title || 'Student'} | {selectedPeer.yearOfStudy || selectedPeer.institution || 'Private chat'}</p>
                  </div>
                  <button onClick={() => setMode('friends')} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-[10px] font-black uppercase text-slate-600">Friends</button>
                </div>
                <div className="flex-1 min-h-0 py-4">
                  <div className="space-y-3 xl:max-h-[52dvh] xl:overflow-y-auto pr-1">
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
                  <textarea value={messageBody} onChange={(e) => setMessageBody(e.target.value)} rows={4} placeholder="Send a message to your friend." className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 resize-none" />
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[11px] font-bold uppercase text-slate-400">Friendship unlocks private chat.</p>
                    <button onClick={sendMessage} className="rounded-2xl bg-slate-950 px-5 py-3 text-xs font-black uppercase text-amber-500">Send Message</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {mode === 'threads' && (
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
              <div className="space-y-3 xl:max-h-[60dvh] xl:overflow-y-auto pr-1">
                {visibleThreads.map((thread) => {
                  const authorProfile = profileMap[thread.authorId];
                  const isFriend = Boolean(friendshipByPeerId[thread.authorId]);
                  return (
                    <div key={thread.id} onClick={() => setSelectedThreadId(thread.id)} className={`rounded-[1.5rem] border px-4 py-4 cursor-pointer ${selectedThread?.id === thread.id ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                      <p className="text-[10px] font-black uppercase text-slate-400">{thread.channel} | {formatRelativeTime(thread.latestActivityAt)}</p>
                      <p className="mt-2 text-sm font-black uppercase text-slate-900">{thread.title}</p>
                      <p className="mt-2 text-xs text-slate-600 line-clamp-3">{thread.body}</p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-[11px] font-bold uppercase text-slate-500 truncate">{thread.authorName}</span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              if (authorProfile && isFriend) {
                                void openChat(authorProfile);
                              } else if (authorProfile) {
                                void sendFriendRequest(authorProfile);
                              }
                            }}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-600"
                          >
                            {isFriend ? 'Message' : 'Add Friend'}
                          </button>
                          <button onClick={(event) => { event.stopPropagation(); void shareThread(thread); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-600">Share</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-100 p-4 min-h-[420px] sm:min-h-[620px] flex flex-col">
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {profileMap[selectedThread.authorId] ? (
                        <button
                          onClick={() => {
                            const authorProfile = profileMap[selectedThread.authorId];
                            if (!authorProfile) return;
                            if (friendshipByPeerId[selectedThread.authorId]) {
                              void openChat(authorProfile);
                            } else {
                              void sendFriendRequest(authorProfile);
                            }
                          }}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-600"
                        >
                          {friendshipByPeerId[selectedThread.authorId] ? 'Message' : 'Add Friend'}
                        </button>
                      ) : <span />}
                      <button onClick={() => void shareThread(selectedThread)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-600">Share</button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 min-h-0 py-4">
                  <div className="space-y-3 xl:max-h-[48dvh] xl:overflow-y-auto pr-1">
                    {replies.map((reply) => {
                      const replyProfile = profileMap[reply.authorId];
                      const isFriend = Boolean(friendshipByPeerId[reply.authorId]);
                      return (
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
                          {replyProfile ? (
                            <div className="mt-3 flex justify-end">
                              <button
                                onClick={() => {
                                  if (isFriend) {
                                    void openChat(replyProfile);
                                  } else {
                                    void sendFriendRequest(replyProfile);
                                  }
                                }}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-600"
                              >
                                {isFriend ? 'Message' : 'Add Friend'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} rows={4} placeholder="Add a useful reply." className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 resize-none" />
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[11px] font-bold uppercase text-slate-400">Forum remains public; private chat starts through friendship.</p>
                    <button onClick={postReply} className="rounded-2xl bg-slate-950 px-5 py-3 text-xs font-black uppercase text-amber-500">Post Reply</button>
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
