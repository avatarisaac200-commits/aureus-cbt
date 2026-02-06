
import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { db, auth } from '../firebase';
import { collection, getDocs, doc, deleteDoc, setDoc, query, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

interface RootAdminDashboardProps {
  user: User;
  onLogout: () => void;
  onSwitchToStudent: () => void;
  onSwitchToAdmin: () => void;
  onGoToImport: () => void;
}

const RootAdminDashboard: React.FC<RootAdminDashboardProps> = ({ user, onLogout, onSwitchToStudent, onSwitchToAdmin, onGoToImport }) => {
  const [admins, setAdmins] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState<'staff' | 'tools'>('staff');
  
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newName, setNewName] = useState('');
  const [newTitle, setNewTitle] = useState('Content Manager');

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'users'), where('role', '==', 'admin'));
      const snap = await getDocs(q);
      setAdmins(snap.docs.map(d => ({ ...d.data(), id: d.id } as User)));
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { fetchAdmins(); }, []);

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (admins.length >= 6) return alert("System staff limit reached.");
    setLoading(true);
    try {
      const res = await createUserWithEmailAndPassword(auth, newEmail, newPass);
      await setDoc(doc(db, 'users', res.user.uid), { id: res.user.uid, name: newName, email: newEmail, role: 'admin', title: newTitle });
      setNewEmail(''); setNewPass(''); setNewName(''); fetchAdmins();
    } catch (err: any) { alert(err.message); } finally { setLoading(false); }
  };

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden">
      <div className="bg-white border-b border-slate-100 p-6 flex flex-col md:flex-row justify-between items-center gap-4 shrink-0 safe-top">
        <div className="flex items-center gap-4">
          <img src="/assets/logo.png" className="w-14 h-14" alt="Aureus Logo" />
          <div>
            <h1 className="text-xl font-black text-slate-900 uppercase tracking-tighter leading-none">Aureus Master</h1>
            <p className="text-[10px] font-black text-amber-600 uppercase tracking-[0.3em] mt-1">System Oversight</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onSwitchToAdmin} className="px-5 py-2.5 text-[10px] font-black text-slate-600 border border-slate-200 rounded-xl uppercase tracking-widest">Faculty Hub</button>
          <button onClick={onSwitchToStudent} className="px-5 py-2.5 text-[10px] font-black text-slate-600 border border-slate-200 rounded-xl uppercase tracking-widest">Student View</button>
          <button onClick={onLogout} className="px-5 py-2.5 text-[10px] font-black text-red-600 border border-red-50 rounded-xl uppercase tracking-widest">Log Out</button>
        </div>
      </div>

      <nav className="flex bg-white px-6 border-b border-slate-100">
        <button onClick={() => setActiveView('staff')} className={`px-8 py-4 text-[10px] font-black uppercase tracking-[0.3em] transition-all ${activeView === 'staff' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50/50' : 'text-slate-400 hover:text-slate-600'}`}>Staff Matrix</button>
        <button onClick={() => setActiveView('tools')} className={`px-8 py-4 text-[10px] font-black uppercase tracking-[0.3em] transition-all ${activeView === 'tools' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50/50' : 'text-slate-400 hover:text-slate-600'}`}>Core Modules</button>
      </nav>

      <div className="flex-1 p-6 md:p-10 overflow-y-auto no-scrollbar safe-bottom">
        {activeView === 'tools' ? (
          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
             <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-xl flex flex-col group hover:border-amber-500 transition-all cursor-pointer" onClick={onGoToImport}>
                <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
                   <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                </div>
                <h3 className="text-xl font-black text-slate-950 mb-3 uppercase tracking-tight">Import questions from PDF</h3>
                <p className="text-xs text-slate-400 mb-10 italic flex-1 leading-relaxed">High-fidelity extraction module for bulk item processing. Automated structuring for medical datasets.</p>
                <button className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase text-[10px] tracking-[0.3em] shadow-2xl hover:bg-slate-900 transition-all">Launch Registry Module</button>
             </div>
             <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col group opacity-40">
                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-8">
                   <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                </div>
                <h3 className="text-xl font-black text-slate-950 mb-3 uppercase tracking-tight">Global Metrics</h3>
                <p className="text-xs text-slate-400 mb-10 italic flex-1 leading-relaxed">Cross-platform performance analytics and system integrity logs. (Module Offline)</p>
                <button disabled className="w-full py-5 bg-slate-50 text-slate-300 rounded-2xl font-black uppercase text-[10px] tracking-[0.3em] cursor-not-allowed">Restricted</button>
             </div>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-10">
            <div className="lg:col-span-1">
              <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl sticky top-0">
                <h2 className="text-xl font-black text-slate-950 mb-8 uppercase tracking-tight">Authorize Personnel</h2>
                <form onSubmit={handleCreateAdmin} className="space-y-4">
                  <input value={newName} onChange={e => setNewName(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-black uppercase focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Official Name" required />
                  <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-black uppercase focus:ring-2 focus:ring-amber-500 outline-none" placeholder="University Email" required />
                  <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-black uppercase focus:ring-2 focus:ring-amber-500 outline-none" placeholder="System Access Key" required />
                  <button disabled={loading} className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase text-[10px] tracking-[0.3em] shadow-xl hover:bg-slate-900 transition-all active:scale-95">Register System Admin</button>
                </form>
              </div>
            </div>
            <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
              {admins.map(admin => (
                <div key={admin.id} className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col justify-between hover:border-amber-200 transition-all">
                  <div>
                    <h3 className="text-base font-black text-slate-950 uppercase tracking-tight leading-none">{admin.name}</h3>
                    <p className="text-[10px] text-amber-600 font-black uppercase mt-2 tracking-widest">{admin.email}</p>
                    <div className="mt-6 pt-6 border-t border-slate-50">
                       <span className="text-[8px] font-bold text-slate-400 uppercase tracking-[0.2em]">Credential Level: Administrator</span>
                    </div>
                  </div>
                  <button onClick={() => deleteDoc(doc(db, 'users', admin.id)).then(fetchAdmins)} className="mt-8 w-full py-3 text-[9px] font-black text-red-600 uppercase tracking-widest border border-red-50 rounded-xl hover:bg-red-50 transition-colors">Revoke Clearance</button>
                </div>
              ))}
              {admins.length === 0 && (
                <div className="col-span-full py-24 text-center">
                   <p className="text-slate-300 font-black text-[10px] uppercase tracking-[0.5em]">No personnel registered</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RootAdminDashboard;
