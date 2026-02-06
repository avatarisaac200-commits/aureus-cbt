
import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { db, auth } from '../firebase';
import { collection, getDocs, doc, deleteDoc, setDoc, query, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { createUserWithEmailAndPassword, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { LOGO_URL } from '../App';

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
    if (admins.length >= 6) return alert("Staff limit reached.");
    setLoading(true);
    try {
      const res = await createUserWithEmailAndPassword(auth, newEmail, newPass);
      await setDoc(doc(db, 'users', res.user.uid), { id: res.user.uid, name: newName, email: newEmail, role: 'admin', title: newTitle });
      setNewEmail(''); setNewPass(''); setNewName(''); fetchAdmins();
    } catch (err: any) { alert(err.message); } finally { setLoading(false); }
  };

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden">
      <div className="bg-white border-b border-gray-100 p-6 flex flex-col md:flex-row justify-between items-center gap-4 shrink-0 safe-top">
        <div className="flex items-center gap-4">
          <img src={LOGO_URL} className="w-12 h-12" alt="Logo" />
          <div>
            <h1 className="text-xl font-black text-slate-900 uppercase tracking-tighter leading-none">Aureus Master</h1>
            <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mt-1">Management Hub</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onSwitchToAdmin} className="px-4 py-2 text-[10px] font-black text-slate-600 border border-gray-200 rounded-xl uppercase">Admin Panel</button>
          <button onClick={onSwitchToStudent} className="px-4 py-2 text-[10px] font-black text-slate-600 border border-gray-200 rounded-xl uppercase">Student View</button>
          <button onClick={onLogout} className="px-4 py-2 text-[10px] font-black text-red-600 border border-red-100 rounded-xl uppercase">Logout</button>
        </div>
      </div>

      <nav className="flex bg-white px-6 border-b border-gray-100">
        <button onClick={() => setActiveView('staff')} className={`px-6 py-4 text-[9px] font-black uppercase tracking-widest ${activeView === 'staff' ? 'border-b-4 border-amber-500 text-slate-950' : 'text-slate-400'}`}>Staff Control</button>
        <button onClick={() => setActiveView('tools')} className={`px-6 py-4 text-[9px] font-black uppercase tracking-widest ${activeView === 'tools' ? 'border-b-4 border-amber-500 text-slate-950' : 'text-slate-400'}`}>Content Hub</button>
      </nav>

      <div className="flex-1 p-6 md:p-10 overflow-y-auto no-scrollbar safe-bottom">
        {activeView === 'tools' ? (
          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
             <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col group hover:border-amber-500 transition-all cursor-pointer" onClick={onGoToImport}>
                <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                   <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 01-.586 1.414l-2.828 2.828A2 2 0 0111 14.414V14a2 2 0 012-2h2a2 2 0 012 2v.414a2 2 0 01-.586 1.414l-2.828 2.828A2 2 0 0111 19.414V20"></path></svg>
                </div>
                <h3 className="text-xl font-black text-slate-950 mb-2 uppercase tracking-tight">AI PDF Analysis</h3>
                <p className="text-xs text-slate-400 mb-8 italic flex-1">Standard AI engine for bulk question extraction. Best for processing clinical vignettes and multi-section study materials.</p>
                <button className="w-full py-4 bg-slate-950 text-amber-500 rounded-xl font-black uppercase text-[10px] tracking-widest">Launch Tool</button>
             </div>
             <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col group opacity-60">
                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-6">
                   <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                </div>
                <h3 className="text-xl font-black text-slate-950 mb-2 uppercase tracking-tight">Analytics Suite</h3>
                <p className="text-xs text-slate-400 mb-8 italic flex-1">Monitor global student performance trends and test difficulty indices. (Coming Soon)</p>
                <button disabled className="w-full py-4 bg-slate-100 text-slate-300 rounded-xl font-black uppercase text-[10px] tracking-widest cursor-not-allowed">Locked</button>
             </div>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1">
              <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm sticky top-0">
                <h2 className="text-lg font-black text-slate-900 mb-6 uppercase tracking-tight">Add Staff</h2>
                <form onSubmit={handleCreateAdmin} className="space-y-4">
                  <input value={newName} onChange={e => setNewName(e.target.value)} className="w-full p-3 bg-slate-50 border border-gray-100 rounded-xl text-xs font-bold" placeholder="Full Name" required />
                  <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full p-3 bg-slate-50 border border-gray-100 rounded-xl text-xs font-bold" placeholder="Email" required />
                  <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} className="w-full p-3 bg-slate-50 border border-gray-100 rounded-xl text-xs font-bold" placeholder="Initial Password" required />
                  <button disabled={loading} className="w-full py-4 bg-slate-950 text-amber-500 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg">Authorize Staff</button>
                </form>
              </div>
            </div>
            <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
              {admins.map(admin => (
                <div key={admin.id} className="bg-white p-6 rounded-[1.8rem] border border-gray-100 shadow-sm">
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">{admin.name}</h3>
                  <p className="text-[10px] text-slate-400 font-bold mb-4">{admin.email}</p>
                  <button onClick={() => deleteDoc(doc(db, 'users', admin.id)).then(fetchAdmins)} className="w-full py-2 text-[8px] font-black text-red-600 uppercase border border-red-50 rounded-lg hover:bg-red-50">Dismiss Staff</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RootAdminDashboard;
