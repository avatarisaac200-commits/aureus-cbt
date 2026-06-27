import React, { useEffect, useMemo, useState } from 'react';
import { User } from '../types';
import { db } from '../firebase';
import { doc, getDoc, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import logo from '../assets/scholar-main.png';
import PartnershipLogos from './PartnershipLogos';
import { toast } from './ui/Toast';
import {
  BRAINSTORM_SESSION_TITLE,
  BRAINSTORM_STRIKE_LIMIT,
  BRAINSTORM_TIMEZONE,
  DEFAULT_BRAINSTORM_WINDOWS,
  generateBrainstormPhrase,
  getBrainstormSessionCloseMinute,
  getBrainstormSessionContext,
  getCurrentBrainstormWindow,
  normalizePhrase,
  sanitizeBrainstormWindows
} from '../brainstorm';

interface AttendancePortalProps {
  user: User;
  onLogout: () => void;
  onOpenBlacklist: () => void;
  onOpenDashboard: () => void;
}

interface BrainstormMember {
  userId: string;
  userName: string;
  strikeCount: number;
  blacklisted: boolean;
  blacklistedAt?: string;
  updatedAt: string;
  createdAt: string;
}

interface BrainstormCheckinRecord {
  userId: string;
  userName: string;
  dateKey: string;
  phrase: string;
  checkedWindowIds: string[];
  missedWindowIds: string[];
  dailyStrikeApplied: boolean;
  createdAt: string;
  updatedAt: string;
  lastCheckInAt?: string;
}

const AttendancePortal: React.FC<AttendancePortalProps> = ({
  user,
  onLogout,
  onOpenBlacklist,
  onOpenDashboard
}) => {
  const [member, setMember] = useState<BrainstormMember | null>(null);
  const [record, setRecord] = useState<BrainstormCheckinRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [phraseInput, setPhraseInput] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [brainstormWindows, setBrainstormWindows] = useState(DEFAULT_BRAINSTORM_WINDOWS);

  const lagosNow = useMemo(() => getBrainstormSessionContext(now, brainstormWindows), [brainstormWindows, now]);
  const dateKey = lagosNow.dateKey;
  const memberRef = useMemo(() => doc(db, 'brainstormMembers', user.id), [user.id]);
  const recordRef = useMemo(() => doc(db, 'brainstormCheckins', `${dateKey}_${user.id}`), [dateKey, user.id]);
  const blacklistRef = useMemo(() => doc(db, 'brainstormBlacklist', user.id), [user.id]);
  const configRef = useMemo(() => doc(db, 'brainstormConfig', 'global'), []);
  const activeWindow = useMemo(() => getCurrentBrainstormWindow(now, brainstormWindows), [brainstormWindows, now]);

  const reconcileAttendance = async () => {
    await runTransaction(db, async (tx) => {
      const nowIso = new Date().toISOString();
      const sessionContext = getBrainstormSessionContext(new Date(), brainstormWindows);
      const currentDateKey = sessionContext.dateKey;
      const memberSnap = await tx.get(memberRef);
      const recordDocRef = doc(db, 'brainstormCheckins', `${currentDateKey}_${user.id}`);
      const recordSnap = await tx.get(recordDocRef);

      const baseMember: BrainstormMember = memberSnap.exists()
        ? ({ ...(memberSnap.data() as BrainstormMember) })
        : {
            userId: user.id,
            userName: user.name || 'Unknown User',
            strikeCount: 0,
            blacklisted: false,
            createdAt: nowIso,
            updatedAt: nowIso
          };

      const baseRecord: BrainstormCheckinRecord = recordSnap.exists()
        ? ({ ...(recordSnap.data() as BrainstormCheckinRecord) })
        : {
            userId: user.id,
            userName: user.name || 'Unknown User',
            dateKey: currentDateKey,
            phrase: generateBrainstormPhrase(user.id, currentDateKey),
            checkedWindowIds: [],
            missedWindowIds: [],
            dailyStrikeApplied: false,
            createdAt: nowIso,
            updatedAt: nowIso
          };

      baseMember.userName = user.name || baseMember.userName || 'Unknown User';
      baseMember.updatedAt = nowIso;
      baseRecord.userName = user.name || baseRecord.userName || 'Unknown User';
      baseRecord.phrase = baseRecord.phrase || generateBrainstormPhrase(user.id, currentDateKey);

      const totalMinutes = sessionContext.totalMinutes;
      const sessionCloseMinute = getBrainstormSessionCloseMinute(brainstormWindows);
      const newlyMissed = brainstormWindows
        .filter((window) => totalMinutes >= window.closeMinute)
        .filter((window) => !baseRecord.checkedWindowIds.includes(window.id) && !baseRecord.missedWindowIds.includes(window.id))
        .map((window) => window.id);

      if (newlyMissed.length > 0) {
        baseRecord.missedWindowIds = [...baseRecord.missedWindowIds, ...newlyMissed];
      }

      if (
        !baseRecord.dailyStrikeApplied &&
        totalMinutes >= sessionCloseMinute &&
        baseRecord.missedWindowIds.length >= brainstormWindows.length
      ) {
        baseRecord.dailyStrikeApplied = true;
        baseMember.strikeCount += 1;
      }

      if (baseMember.strikeCount >= BRAINSTORM_STRIKE_LIMIT && !baseMember.blacklisted) {
        baseMember.blacklisted = true;
        baseMember.blacklistedAt = nowIso;
        tx.set(blacklistRef, {
          userId: user.id,
          userName: baseMember.userName,
          strikeCount: baseMember.strikeCount,
          blacklistedAt: nowIso
        }, { merge: true });
      }

      baseRecord.updatedAt = nowIso;

      tx.set(memberRef, baseMember, { merge: true });
      tx.set(recordDocRef, baseRecord, { merge: true });
    });
  };

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    setLoading(true);
    const unsubConfig = onSnapshot(configRef, (snap) => {
      const data = snap.exists() ? snap.data() : null;
      setBrainstormWindows(sanitizeBrainstormWindows((data as any)?.windows));
    });
    const unsubMember = onSnapshot(memberRef, (snap) => {
      setMember(snap.exists() ? (snap.data() as BrainstormMember) : null);
      setLoading(false);
    });
    const unsubRecord = onSnapshot(recordRef, (snap) => {
      setRecord(snap.exists() ? (snap.data() as BrainstormCheckinRecord) : null);
      setLoading(false);
    });
    reconcileAttendance().catch((err: any) => {
      console.error('Attendance reconcile failed', err);
      toast.error('Attendance sync failed', err?.message || 'Could not refresh your attendance state.');
      setLoading(false);
    });
    return () => {
      unsubConfig();
      unsubMember();
      unsubRecord();
    };
  }, [configRef, memberRef, recordRef]);

  useEffect(() => {
    reconcileAttendance().catch(() => undefined);
  }, [brainstormWindows, dateKey]);

  const submitCheckIn = async () => {
    setSubmitting(true);
    try {
      await reconcileAttendance();

      const [memberSnap, recordSnap] = await Promise.all([getDoc(memberRef), getDoc(recordRef)]);
      const currentMember = memberSnap.exists() ? (memberSnap.data() as BrainstormMember) : null;
      const currentRecord = recordSnap.exists() ? (recordSnap.data() as BrainstormCheckinRecord) : null;

      if (!currentRecord) {
        throw new Error('Session not ready. Reload the attendance portal and try again.');
      }
      const rightNow = new Date();
      const lagos = getBrainstormSessionContext(rightNow, brainstormWindows);
      const currentWindow = brainstormWindows.find((window) => lagos.totalMinutes >= window.openMinute && lagos.totalMinutes < window.closeMinute);
      if (!currentWindow) {
        throw new Error('Check-in is only allowed during the active attendance window.');
      }
      if (currentMember?.blacklisted || (currentMember?.strikeCount || 0) >= BRAINSTORM_STRIKE_LIMIT) {
        throw new Error('This account has already been blacklisted.');
      }
      if (currentRecord.checkedWindowIds.includes(currentWindow.id)) {
        throw new Error('You have already checked in for this window.');
      }
      if (normalizePhrase(phraseInput) !== normalizePhrase(currentRecord.phrase)) {
        throw new Error('Your submitted word string does not match your assigned phrase.');
      }

      await runTransaction(db, async (tx) => {
        const nowIso = new Date().toISOString();
        const memberRow = {
          ...(currentMember || {
            userId: user.id,
            strikeCount: 0,
            blacklisted: false,
            createdAt: nowIso
          }),
          userName: user.name || currentMember?.userName || 'Unknown User',
          userId: user.id,
          updatedAt: nowIso
        } as BrainstormMember;
        const recordRow = {
          ...currentRecord,
          userName: user.name || currentRecord.userName || 'Unknown User',
          dateKey,
          phrase: currentRecord.phrase || generateBrainstormPhrase(user.id, dateKey),
          checkedWindowIds: [...currentRecord.checkedWindowIds, currentWindow.id],
          missedWindowIds: currentRecord.missedWindowIds || [],
          dailyStrikeApplied: Boolean(currentRecord.dailyStrikeApplied),
          createdAt: currentRecord.createdAt || nowIso,
          userId: user.id,
          updatedAt: nowIso,
          lastCheckInAt: nowIso
        } as BrainstormCheckinRecord;

        tx.set(memberRef, memberRow, { merge: true });
        tx.set(recordRef, recordRow, { merge: true });
      });

      setPhraseInput('');
      toast.success('Check-in recorded', `${activeWindow?.label || 'Current window'} submitted successfully.`);
    } catch (err: any) {
      toast.error('Check-in failed', err?.message || 'Could not submit your attendance phrase.');
    } finally {
      setSubmitting(false);
      reconcileAttendance().catch(() => undefined);
    }
  };

  const windowRows = brainstormWindows.map((window) => {
    const checked = Boolean(record?.checkedWindowIds.includes(window.id));
    const missed = Boolean(record?.missedWindowIds.includes(window.id));
    const isOpen = activeWindow?.id === window.id;
    const isUpcoming = lagosNow.totalMinutes < window.openMinute;

    return {
      ...window,
      checked,
      missed,
      isOpen,
      isUpcoming
    };
  });

  const phrase = record?.phrase || generateBrainstormPhrase(user.id, dateKey);

  return (
    <div className="min-h-[100dvh] bg-slate-50 px-4 py-6 md:px-8 md:py-8 safe-top safe-bottom overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <section className="bg-slate-950 text-white rounded-[2.5rem] border-b-8 border-amber-500 px-6 py-7 md:px-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <img src={logo} alt="Scholar! logo" className="w-14 h-14" />
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.32em] text-amber-400">Pinned Access Link</p>
                <h1 className="text-2xl font-black uppercase tracking-tight">{BRAINSTORM_SESSION_TITLE}</h1>
                <p className="text-sm text-slate-300 mt-1">Timezone: {BRAINSTORM_TIMEZONE}. Session date: {dateKey}.</p>
                <PartnershipLogos className="mt-3 items-start" variant="dark" size="compact" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={onOpenBlacklist} className="px-4 py-3 rounded-2xl bg-white text-slate-900 text-xs font-black uppercase tracking-widest">Blacklist</button>
              <button onClick={onOpenDashboard} className="px-4 py-3 rounded-2xl bg-amber-500 text-slate-950 text-xs font-black uppercase tracking-widest">Dashboard</button>
              <button onClick={onLogout} className="px-4 py-3 rounded-2xl border border-slate-700 text-xs font-black uppercase tracking-widest text-slate-200">Log Out</button>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6">
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">Assigned Phrase</p>
                <h2 className="text-lg font-black uppercase text-slate-950">{user.name}</h2>
              </div>
              <span className={`px-3 py-2 rounded-full text-[11px] font-black uppercase tracking-widest ${member?.blacklisted ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {member?.blacklisted ? 'Blacklisted' : 'Active'}
              </span>
            </div>
            <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-4">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-700 mb-2">Submit this exact phrase during every open window</p>
              <p className="text-lg md:text-xl font-black text-slate-950 leading-relaxed">{phrase}</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
              <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Strikes</p>
                <p className="text-xl font-black text-slate-950">{member?.strikeCount || 0}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Checked</p>
                <p className="text-xl font-black text-slate-950">{record?.checkedWindowIds.length || 0}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Missed</p>
                <p className="text-xl font-black text-slate-950">{record?.missedWindowIds.length || 0}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Limit</p>
                <p className="text-xl font-black text-slate-950">{BRAINSTORM_STRIKE_LIMIT}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Live Check-in</p>
            <h2 className="text-lg font-black uppercase text-slate-950 mb-4">{activeWindow ? `${activeWindow.label} is open` : 'No active window right now'}</h2>
            <textarea
              value={phraseInput}
              onChange={(e) => setPhraseInput(e.target.value)}
              placeholder="Enter your assigned phrase exactly as shown"
              className="w-full min-h-[120px] rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-bold outline-none"
              disabled={member?.blacklisted}
            />
            <button
              type="button"
              onClick={submitCheckIn}
              disabled={submitting || !activeWindow || Boolean(member?.blacklisted)}
              className="mt-4 w-full py-4 rounded-2xl bg-slate-950 text-amber-500 text-xs font-black uppercase tracking-[0.24em] disabled:opacity-40"
            >
              {submitting ? 'Submitting...' : activeWindow ? `Submit ${activeWindow.label}` : 'Waiting For Next Window'}
            </button>
            <p className="mt-3 text-xs text-slate-500 leading-relaxed">
              You must authenticate and submit your assigned phrase during all three windows. Missing all three windows for the day records one attendance strike.
            </p>
          </div>
        </section>

        <section className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Session Windows</p>
              <h2 className="text-lg font-black uppercase text-slate-950">Timed Verification Schedule</h2>
            </div>
            {loading && <span className="text-xs font-black uppercase tracking-widest text-slate-400">Syncing...</span>}
          </div>
          <div className="space-y-3">
            {windowRows.map((window) => (
              <div key={window.id} className="rounded-[1.5rem] border border-slate-100 bg-slate-50 px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-black uppercase text-slate-950">{window.label}</p>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{window.opensAtLabel} - {window.closesAtLabel}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={`px-3 py-2 rounded-full text-[11px] font-black uppercase tracking-widest ${window.checked ? 'bg-emerald-100 text-emerald-700' : window.missed ? 'bg-red-100 text-red-700' : window.isOpen ? 'bg-amber-100 text-amber-700' : window.isUpcoming ? 'bg-sky-100 text-sky-700' : 'bg-slate-200 text-slate-600'}`}>
                    {window.checked ? 'Checked In' : window.missed ? 'Strike Issued' : window.isOpen ? 'Open Now' : window.isUpcoming ? 'Upcoming' : 'Closed'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AttendancePortal;
