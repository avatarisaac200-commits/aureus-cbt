
import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { db, auth } from '../firebase';
import { collection, getDocs, doc, deleteDoc, setDoc, query, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import logo from '../assets/logo.png';

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

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'users'), where('role', '==', 'admin'));
      const snap = await getDocs(q);
      setAdmins(snap.docs.map(d => ({ ...d.data(), id: d.id } as User)));
    } catch (err) { 
      console.error(err); 
    } finally { 
      setLoading(false); 
    }
  };

  useEffect(() => { fetchAdmins(); }, []);

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await createUserWithEmailAndPassword(auth, newEmail, newPass);
      await setDoc(doc(db, 'users', res.user.uid), { 
        id: res.user.uid, 
        name: newName, 
        email: newEmail, 
        role: 'admin' 
      });
      setNewEmail(''); setNewPass(''); setNewName(''); 
      fetchAdmins();
    } catch (err: any) { 
      alert(err.message); 
    } finally { 
      setLoading(false); 
    }
  };

  const handleDeleteAdmin = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this admin?")) {
      try {
        await deleteDoc(doc(db, 'users', id));
        fetchAdmins();
      } catch (err) {
        alert("Could not delete admin.");
      }
    }
  };

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden">
      <div className="bg-white border-b border-slate-100 p-6 flex flex-col md:flex-row justify-between items-center gap-4 shrink-0 safe-top">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-14 h-14" alt="Logo" />
          <div>
            <h1 className="text-xl font-bold text-slate-900 uppercase tracking-tight leading-none">Root Admin</h1>
            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mt-1">System Control</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onSwitchToAdmin} className="px-5 py-2.5 text-[10px] font-bold text-slate-600 border border-slate-200 rounded-xl uppercase tracking-widest">Admin Hub</button>
          <button onClick={onSwitchToStudent} className="px-5 py-2.5 text-[10px] font-bold text-slate-600 border border-slate-200 rounded-xl uppercase tracking-widest">Student View</button>
          <button onClick={onLogout} className="px-5 py-2.5 text-[10px] font-bold text-red-600 border border-red-50 rounded-xl uppercase tracking-widest">Logout</button>
        </div>
      </div>

      <nav className="flex bg-white px-6 border-b border-slate-100 overflow-x-auto no-scrollbar">
        <button onClick={() => setActiveView('staff')} className={`px-8 py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${activeView === 'staff' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50/50' : 'text-slate-400 hover:text-slate-600'}`}>Manage Admins</button>
        <button onClick={() => setActiveView('tools')} className={`px-8 py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${activeView === 'tools' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50/50' : 'text-slate-400 hover:text-slate-600'}`}>Modules</button>
      </nav>

      <div className="flex-1 p-6 md:p-10 overflow-y-auto no-scrollbar safe-bottom">
        {activeView === 'tools' ? (
          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
             <div className="bg-white p-10 rounded-[2rem] border border-slate-100 shadow-xl flex flex-col group hover:border-amber-500 transition-all cursor-pointer" onClick={onGoToImport}>
                <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
                   <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                </div>
                <h3 className="text-xl font-bold text-slate-950 mb-3 uppercase tracking-tight">Import PDF Tool</h3>
                <p className="text-xs text-slate-400 mb-10 italic flex-1 leading-relaxed">Bulk import questions from documents into the database.</p>
                <button className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-[10px] tracking-widest shadow-2xl hover:bg-slate-900 transition-all">Open Module</button>
             </div>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-10">
            <div className="lg:col-span-1">
              <div className="bg-white p-10 rounded-[2rem] border border-slate-100 shadow-2xl sticky top-0">
                <h2 className="text-xl font-bold text-slate-950 mb-8 uppercase tracking-tight">Add Admin</h2>
                <form onSubmit={handleCreateAdmin} className="space-y-4">
                  <input value={newName} onChange={e => setNewName(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-bold uppercase focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Name" required />
                  <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-bold uppercase focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Email" required />
                  <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-bold uppercase focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Password" required />
                  <button disabled={loading} className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-[10px] tracking-widest shadow-xl hover:bg-slate-900 transition-all">Create Admin</button>
                </form>
              </div>
            </div>
            <div className="lg:col-span-2 space-y-4">
              <h2 className="text-xl font-bold text-slate-950 mb-6 uppercase tracking-tight">Current Administrators</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {admins.map(admin => (
                  <div key={admin.id} className="bg-white p-6 rounded-[1.5rem] border border-slate-100 shadow-sm flex flex-col justify-between hover:border-amber-200 transition-all">
                    <div>
                      <h3 className="text-base font-bold text-slate-950 uppercase leading-none">{admin.name}</h3>
                      <p className="text-[10px] text-amber-600 font-bold uppercase mt-2">{admin.email}</p>
                    </div>
                    <button onClick={() => handleDeleteAdmin(admin.id)} className="mt-6 text-[10px] font-bold text-red-500 uppercase tracking-widest hover:underline text-left">Remove Admin</button>
                  </div>
                ))}
                {admins.length === 0 && !loading && (
                  <div className="col-span-full py-10 text-center text-slate-400 font-bold uppercase text-[10px]">No admins found.</div>
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
