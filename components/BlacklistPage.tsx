import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { collection, limit, onSnapshot, orderBy, query } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import logo from '../assets/scholar-main.png';

interface BlacklistEntry {
  userId: string;
  userName: string;
  strikeCount: number;
  blacklistedAt: string;
}

interface BlacklistPageProps {
  onOpenAttendance?: () => void;
  onOpenDashboard?: () => void;
}

const BlacklistPage: React.FC<BlacklistPageProps> = ({ onOpenAttendance, onOpenDashboard }) => {
  const [rows, setRows] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'brainstormBlacklist'), orderBy('blacklistedAt', 'desc'), limit(500)),
      (snap) => {
        setRows(snap.docs.map((docSnap) => docSnap.data() as BlacklistEntry));
        setLoading(false);
      },
      () => {
        setRows([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  return (
    <div className="min-h-[100dvh] bg-slate-50 px-4 py-6 md:px-8 md:py-8 safe-top safe-bottom overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <section className="bg-slate-950 text-white rounded-[2.5rem] border-b-8 border-red-500 px-6 py-7 md:px-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <img src={logo} alt="Scholar! logo" className="w-14 h-14" />
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.32em] text-red-300">Public Attendance Status</p>
                <h1 className="text-2xl font-black uppercase tracking-tight">Blacklist</h1>
                <p className="text-sm text-slate-300 mt-1">Users are added automatically after accumulating three strikes.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {onOpenAttendance && (
                <button onClick={onOpenAttendance} className="px-4 py-3 rounded-2xl bg-white text-slate-900 text-xs font-black uppercase tracking-widest">
                  Attendance Portal
                </button>
              )}
              {onOpenDashboard && (
                <button onClick={onOpenDashboard} className="px-4 py-3 rounded-2xl bg-red-500 text-white text-xs font-black uppercase tracking-widest">
                  Dashboard
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Automated List</p>
              <h2 className="text-lg font-black uppercase text-slate-950">Flagged Members</h2>
            </div>
            <span className="px-3 py-2 rounded-full bg-slate-100 text-slate-700 text-[11px] font-black uppercase tracking-widest">
              {rows.length} entries
            </span>
          </div>

          {loading ? (
            <p className="py-20 text-center text-xs font-black uppercase tracking-widest text-slate-400">Loading blacklist...</p>
          ) : rows.length === 0 ? (
            <p className="py-20 text-center text-xs font-black uppercase tracking-widest text-slate-400">No blacklisted users yet.</p>
          ) : (
            <div className="space-y-3">
              {rows.map((row, index) => (
                <div key={`${row.userId}_${index}`} className="rounded-[1.5rem] border border-red-100 bg-red-50 px-4 py-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-black uppercase text-slate-950">{row.userName}</p>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{row.userId}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <span className="px-3 py-2 rounded-full bg-white border border-red-200 text-[11px] font-black uppercase tracking-widest text-red-700">
                      {row.strikeCount} strikes
                    </span>
                    <span className="px-3 py-2 rounded-full bg-white border border-slate-200 text-[11px] font-black uppercase tracking-widest text-slate-600">
                      {new Date(row.blacklistedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default BlacklistPage;
