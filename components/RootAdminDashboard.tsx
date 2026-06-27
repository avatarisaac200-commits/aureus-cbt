
import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { db, firebaseConfig } from '../firebase';
import { collection, getDocs, doc, deleteDoc, setDoc, updateDoc, query, where, limit, writeBatch } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { createUserWithEmailAndPassword, getAuth, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import logo from '../assets/scholar-main.png';
import PartnershipLogos from './PartnershipLogos';
import { toast } from './ui/Toast';
import { confirmDialog } from './ui/ConfirmDialog';

interface RootAdminDashboardProps {
  user: User;
  onLogout: () => void;
  onSwitchToStudent: () => void;
  onSwitchToAdmin: () => void;
  onGoToImport: () => void;
  onGoToAnalytics: () => void;
}

const RootAdminDashboard: React.FC<RootAdminDashboardProps> = ({ user, onLogout, onSwitchToStudent, onSwitchToAdmin, onGoToImport, onGoToAnalytics }) => {
  const [admins, setAdmins] = useState<User[]>([]);
  const [verificationQueue, setVerificationQueue] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [adminsLoaded, setAdminsLoaded] = useState(false);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [activeView, setActiveView] = useState<'staff' | 'tools'>('staff');
  
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newName, setNewName] = useState('');

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const adminsSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'admin'), limit(100)));
      const filteredAdmins = adminsSnap.docs.map(d => ({ ...d.data(), id: d.id } as User));
      setAdmins(filteredAdmins);
      setAdminsLoaded(true);
    } catch (err) { 
      console.error("Error fetching admin list:", err); 
    } finally { 
      setLoading(false); 
    }
  };

  const fetchPendingVerification = async () => {
    setLoading(true);
    try {
      const pendingSnap = await getDocs(query(collection(db, 'users'), where('emailVerified', '==', false), limit(100)));
      const unverifiedUsers = pendingSnap.docs
        .map(d => ({ ...d.data(), id: d.id } as User))
        .filter(u => u.role !== 'root-admin');
      setVerificationQueue(unverifiedUsers);
      setPendingLoaded(true);
    } catch (err) {
      console.error("Error fetching pending verification list:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const secondaryApp = getApps().find(app => app.name === 'admin-create') || initializeApp(firebaseConfig, 'admin-create');
      const secondaryAuth = getAuth(secondaryApp);
      const res = await createUserWithEmailAndPassword(secondaryAuth, newEmail, newPass);
      await setDoc(doc(db, 'users', res.user.uid), { 
        id: res.user.uid, 
        name: newName, 
        email: newEmail, 
        role: 'admin',
        emailVerified: false
      });
      await sendEmailVerification(res.user);
      setNewEmail(''); setNewPass(''); setNewName(''); 
      fetchAdmins();
      toast.success('Administrator created', 'A verification email was sent.');
    } catch (err: any) { 
      toast.error('Create failed', err?.message || 'Could not create admin.'); 
    } finally { 
      setLoading(false); 
    }
  };

  const handleDeleteAdmin = async (id: string) => {
    const ok = await confirmDialog({
      title: 'Delete admin account?',
      message: 'This action cannot be undone.',
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'users', id));
      fetchAdmins();
      toast.success('Admin removed');
    } catch (err: any) {
      toast.error('Delete failed', err?.message || 'Failed to delete account.');
    }
  };

  const handleVerifyUser = async (target: User) => {
    const ok = await confirmDialog({
      title: 'Mark user as verified?',
      message: `Mark ${target.email} as verified?`,
      confirmText: 'Verify',
      variant: 'primary'
    });
    if (!ok) return;
    try {
      await updateDoc(doc(db, 'users', target.id), { emailVerified: true });
      setVerificationQueue(prev => prev.filter(u => u.id !== target.id));
      toast.success('User verified');
    } catch (err: any) {
      toast.error('Verification failed', err?.message || 'Failed to verify user.');
    }
  };

  const handleClearGlobalAttendanceStrikes = async () => {
    const ok = await confirmDialog({
      title: 'Clear all attendance strikes?',
      message: 'This will reset cumulative attendance strikes and remove every attendance blacklist entry for all users.',
      confirmText: 'Clear All',
      variant: 'danger'
    });
    if (!ok) return;

    setLoading(true);
    try {
      const [membersSnap, blacklistSnap] = await Promise.all([
        getDocs(query(collection(db, 'brainstormMembers'), limit(3000))),
        getDocs(query(collection(db, 'brainstormBlacklist'), limit(3000)))
      ]);

      let batch = writeBatch(db);
      let writes = 0;
      const flush = async () => {
        if (writes === 0) return;
        await batch.commit();
        batch = writeBatch(db);
        writes = 0;
      };

      for (const memberDoc of membersSnap.docs) {
        batch.set(doc(db, 'brainstormMembers', memberDoc.id), {
          strikeCount: 0,
          blacklisted: false,
          blacklistedAt: null,
          updatedAt: new Date().toISOString()
        }, { merge: true });
        writes += 1;
        if (writes >= 450) await flush();
      }

      for (const blacklistDoc of blacklistSnap.docs) {
        batch.delete(doc(db, 'brainstormBlacklist', blacklistDoc.id));
        writes += 1;
        if (writes >= 450) await flush();
      }

      await flush();
      toast.success('Attendance reset', 'All attendance strikes and blacklist entries were cleared.');
    } catch (err: any) {
      toast.error('Reset failed', err?.message || 'Could not clear attendance strikes.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="v2-page flex-1 w-full bg-slate-50 flex flex-col overflow-hidden min-h-0">
      <div className="v2-shell bg-white border-b border-slate-100 p-6 flex flex-col md:flex-row justify-between items-center gap-4 shrink-0 safe-top">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-14 h-14" alt="Scholar! logo" />
          <div>
            <h1 className="text-xl font-bold text-slate-900 uppercase tracking-tight leading-none">Root Admin</h1>
            <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mt-1">Full System Access</p>
            <PartnershipLogos className="mt-2 items-start" size="compact" />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onSwitchToAdmin} className="px-5 py-2.5 text-xs font-bold text-slate-600 border border-slate-200 rounded-xl uppercase tracking-widest hover:bg-slate-50 transition-all">Admin Dashboard</button>
          <button onClick={onSwitchToStudent} className="px-5 py-2.5 text-xs font-bold text-slate-600 border border-slate-200 rounded-xl uppercase tracking-widest hover:bg-slate-50 transition-all">Student View</button>
          <button onClick={onLogout} className="px-5 py-2.5 text-xs font-bold text-red-600 border border-red-50 rounded-xl uppercase tracking-widest hover:bg-red-50 transition-all">Logout</button>
        </div>
      </div>

      <nav className="flex bg-white px-6 border-b border-slate-100 overflow-x-auto no-scrollbar">
        <button onClick={() => setActiveView('staff')} className={`px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all ${activeView === 'staff' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50/50' : 'text-slate-400 hover:text-slate-600'}`}>Manage Admins</button>
        <button onClick={() => setActiveView('tools')} className={`px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all ${activeView === 'tools' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50/50' : 'text-slate-400 hover:text-slate-600'}`}>System Tools</button>
      </nav>

      <div className="flex-1 p-6 md:p-10 v2-scroll safe-bottom">
        {activeView === 'tools' ? (
          <div className="max-w-4xl mx-auto">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-10 rounded-[2rem] border border-slate-100 shadow-xl flex flex-col group hover:border-amber-500 transition-all cursor-pointer" onClick={onGoToAnalytics}>
                   <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mb-8">
                      <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3v18h18M8 14l3-3 3 2 4-5"></path></svg>
                   </div>
                   <h3 className="text-xl font-bold text-slate-950 mb-3 uppercase tracking-tight">Analytics Center</h3>
                   <p className="text-xs text-slate-400 mb-10 italic">Performance trends, outcomes, and question insights.</p>
                   <button className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-xs tracking-widest shadow-2xl hover:bg-slate-900 transition-all">Open Analytics</button>
                </div>
                <div className="bg-white p-10 rounded-[2rem] border border-slate-100 shadow-xl flex flex-col group hover:border-amber-500 transition-all cursor-pointer" onClick={onGoToImport}>
                   <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mb-8">
                      <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                   </div>
                   <h3 className="text-xl font-bold text-slate-950 mb-3 uppercase tracking-tight">AI PDF Uploader</h3>
                   <p className="text-xs text-slate-400 mb-10 italic">Automatically parse questions from PDFs.</p>
                   <button className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-xs tracking-widest shadow-2xl hover:bg-slate-900 transition-all">Open PDF Tool</button>
                </div>
                <div className="bg-white p-10 rounded-[2rem] border border-red-100 shadow-xl flex flex-col">
                   <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-8">
                      <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"></path></svg>
                   </div>
                   <h3 className="text-xl font-bold text-slate-950 mb-3 uppercase tracking-tight">Clear Attendance Strikes</h3>
                   <p className="text-xs text-slate-400 mb-10 italic">Root-admin-only global reset for attendance strike counts and attendance blacklist entries.</p>
                   <button
                     onClick={handleClearGlobalAttendanceStrikes}
                     disabled={loading}
                     className="w-full py-5 bg-red-600 text-white rounded-2xl font-bold uppercase text-xs tracking-widest shadow-2xl hover:bg-red-700 transition-all disabled:opacity-40"
                   >
                     {loading ? 'Working...' : 'Clear All Attendance Strikes'}
                   </button>
                </div>
             </div>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-10">
            <div className="lg:col-span-1">
              <div className="bg-white p-10 rounded-[2rem] border border-slate-100 shadow-2xl sticky top-0">
                <h2 className="text-xl font-bold text-slate-950 mb-8 uppercase tracking-tight">Register Admin</h2>
                <form onSubmit={handleCreateAdmin} className="space-y-4">
                  <div>
                    <label htmlFor="root-admin-name">Full Name</label>
                    <input id="root-admin-name" value={newName} onChange={e => setNewName(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-bold focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Full Name" required />
                  </div>
                  <div>
                    <label htmlFor="root-admin-email">Email</label>
                    <input id="root-admin-email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-bold focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Email" required />
                  </div>
                  <div>
                    <label htmlFor="root-admin-password">Password</label>
                    <input id="root-admin-password" type="password" value={newPass} onChange={e => setNewPass(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-bold focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Password" required />
                  </div>
                  <button disabled={loading} className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-xs tracking-widest shadow-xl hover:bg-slate-900 transition-all">Create Admin</button>
                </form>
              </div>
            </div>
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white p-6 rounded-[1.5rem] border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h2 className="text-xl font-bold text-slate-950 uppercase tracking-tight">Pending Verification</h2>
                  <button onClick={fetchPendingVerification} className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded-xl uppercase tracking-widest hover:bg-slate-50 transition-all">Load Pending</button>
                </div>
                <div className="space-y-3">
                  {verificationQueue.map(account => (
                    <div key={account.id} className="flex items-center justify-between gap-3 border border-slate-100 rounded-xl p-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{account.name || 'Unnamed User'}</p>
                        <p className="text-xs font-bold text-slate-500 uppercase">{account.email} - {account.role}</p>
                      </div>
                      <button
                        onClick={() => handleVerifyUser(account)}
                        className="px-4 py-2 bg-slate-950 text-amber-500 rounded-xl font-bold uppercase text-xs tracking-widest"
                      >
                        Verify
                      </button>
                    </div>
                  ))}
                  {verificationQueue.length === 0 && pendingLoaded && !loading && (
                    <p className="text-slate-400 font-bold uppercase text-xs tracking-widest italic">No pending users.</p>
                  )}
                  {!pendingLoaded && !loading && (
                    <p className="text-slate-400 font-bold uppercase text-xs tracking-widest italic">Click "Load Pending" to fetch pending verification users.</p>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <h2 className="text-xl font-bold text-slate-950 uppercase tracking-tight">Registered Admins</h2>
                <button onClick={fetchAdmins} className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded-xl uppercase tracking-widest hover:bg-slate-50 transition-all">Load Admins</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {admins.map(admin => (
                  <div key={admin.id} className="bg-white p-6 rounded-[1.5rem] border border-slate-100 shadow-sm flex flex-col justify-between hover:border-amber-200 transition-all group">
                    <div>
                      <h3 className="text-base font-bold text-slate-950 uppercase leading-none">{admin.name}</h3>
                      <p className="text-xs text-amber-600 font-bold uppercase mt-2">{admin.email}</p>
                    </div>
                    <button onClick={() => handleDeleteAdmin(admin.id)} className="mt-6 text-xs font-bold text-red-500 uppercase tracking-widest hover:underline text-left transition-all">Remove Admin</button>
                  </div>
                ))}
                {admins.length === 0 && adminsLoaded && !loading && (
                  <div className="col-span-full py-20 text-center bg-white rounded-2xl border border-slate-100">
                    <p className="text-slate-400 font-bold uppercase text-xs tracking-widest italic">No admins registered yet.</p>
                  </div>
                )}
                {!adminsLoaded && !loading && (
                  <div className="col-span-full py-20 text-center bg-white rounded-2xl border border-slate-100">
                    <p className="text-slate-400 font-bold uppercase text-xs tracking-widest italic">Click "Load Admins" to fetch staff accounts.</p>
                  </div>
                )}
                {loading && (
                  <div className="col-span-full py-10 text-center text-amber-500 font-bold uppercase text-xs animate-pulse">Loading list...</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RootAdminDashboard;

