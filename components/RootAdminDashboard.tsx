
import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { db, auth } from '../firebase';
import { collection, getDocs, doc, deleteDoc, setDoc, query, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { createUserWithEmailAndPassword, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

const logo = '/assets/logo.png';

interface RootAdminDashboardProps {
  user: User;
  onLogout: () => void;
  onSwitchToStudent: () => void;
  onSwitchToAdmin: () => void;
}

const RootAdminDashboard: React.FC<RootAdminDashboardProps> = ({ user, onLogout, onSwitchToStudent, onSwitchToAdmin }) => {
  const [admins, setAdmins] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newName, setNewName] = useState('');
  const [newTitle, setNewTitle] = useState('Content Manager');

  const adminRoles = [
    "Content Manager",
    "Exam Moderator",
    "Question Reviewer",
    "Support Lead",
    "Technical Supervisor"
  ];

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

  useEffect(() => {
    fetchAdmins();
  }, []);

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (admins.length >= 6) {
      alert("Maximum administrative staff limit (6) reached.");
      return;
    }
    setLoading(true);
    try {
      const res = await createUserWithEmailAndPassword(auth, newEmail, newPass);
      const adminData: User = {
        id: res.user.uid,
        name: newName,
        email: newEmail,
        role: 'admin',
        title: newTitle
      };
      await setDoc(doc(db, 'users', res.user.uid), adminData);
      alert("Staff added successfully.");
      setNewEmail(''); setNewPass(''); setNewName('');
      fetchAdmins();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const dismissAdmin = async (id: string) => {
    if (!window.confirm("Remove this staff member? This will delete their database profile.")) return;
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'users', id));
      fetchAdmins();
    } catch (err) {
      alert(err);
    } finally {
      setLoading(false);
    }
  };

  const resetAdminPassword = async (email: string) => {
    if (!window.confirm(`Send password reset to ${email}?`)) return;
    try {
      await sendPasswordResetEmail(auth, email);
      alert("Email sent.");
    } catch (err: any) {
      alert("Failed: " + err.message);
    }
  };

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden">
      <div className="bg-white border-b border-gray-100 p-6 flex flex-col md:flex-row justify-between items-center gap-4 shrink-0 safe-top">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-12 h-12" alt="Logo" />
          <div>
            <h1 className="text-xl font-black text-slate-900 uppercase tracking-tighter leading-none">Aureus Master</h1>
            <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mt-1">Aureus Medicos CBT Practice App</p>
          </div>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button onClick={onSwitchToAdmin} className="flex-1 md:flex-none px-4 py-2 text-[10px] font-black text-slate-600 border border-gray-200 rounded-xl uppercase hover:bg-slate-50">Admin Panel</button>
          <button onClick={onSwitchToStudent} className="flex-1 md:flex-none px-4 py-2 text-[10px] font-black text-slate-600 border border-gray-200 rounded-xl uppercase hover:bg-slate-50">Student View</button>
          <button onClick={onLogout} className="px-4 py-2 text-[10px] font-black text-red-600 border border-red-100 rounded-xl uppercase">Logout</button>
        </div>
      </div>

      <div className="flex-1 p-6 md:p-10 overflow-y-auto no-scrollbar safe-bottom">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-1">
            <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm sticky top-0">
              <h2 className="text-lg font-black text-slate-900 mb-6 uppercase tracking-tight">Add Staff</h2>
              <p className="text-[9px] text-slate-400 font-bold uppercase mb-4">Capacity: {admins.length}/6</p>
              <form onSubmit={handleCreateAdmin} className="space-y-4">
                <div>
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Name</label>
                  <input value={newName} onChange={e => setNewName(e.target.value)} className="w-full p-3 bg-slate-50 border border-gray-100 rounded-xl text-xs font-bold outline-none" placeholder="Name" required />
                </div>
                <div>
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Email</label>
                  <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full p-3 bg-slate-50 border border-gray-100 rounded-xl text-xs font-bold outline-none" placeholder="Email" required />
                </div>
                <div>
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Password</label>
                  <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} className="w-full p-3 bg-slate-50 border border-gray-100 rounded-xl text-xs font-bold outline-none" placeholder="••••••••" required />
                </div>
                <div>
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Role</label>
                  <select value={newTitle} onChange={e => setNewTitle(e.target.value)} className="w-full p-3 bg-slate-50 border border-gray-100 rounded-xl text-xs font-bold outline-none">
                    {adminRoles.map(role => <option key={role} value={role}>{role}</option>)}
                  </select>
                </div>
                <button disabled={loading || admins.length >= 6} className="w-full py-4 bg-slate-950 text-amber-500 rounded-xl font-black uppercase text-[10px] tracking-widest disabled:opacity-20 shadow-lg active:scale-95 transition-all">
                  Authorize
                </button>
              </form>
            </div>
          </div>

          <div className="lg:col-span-2">
            <h2 className="text-lg font-black text-slate-900 mb-6 uppercase tracking-tight px-2">Staff Directory</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {admins.length === 0 ? (
                <div className="col-span-full py-20 text-center bg-white rounded-[2rem] border-2 border-dashed border-slate-100">
                  <p className="text-slate-300 font-black uppercase text-[10px] tracking-[0.3em]">No staff yet</p>
                </div>
              ) : (
                admins.map(admin => (
                  <div key={admin.id} className="bg-white p-6 rounded-[1.8rem] border border-gray-100 shadow-sm flex flex-col">
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center font-black text-amber-500 text-sm">
                        {admin.name.charAt(0)}
                      </div>
                      <span className="text-[8px] font-black text-amber-600 bg-amber-50 px-3 py-1 rounded-full uppercase border border-amber-100 tracking-widest">{admin.title}</span>
                    </div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight truncate">{admin.name}</h3>
                    <p className="text-[10px] text-slate-400 font-bold mb-6">{admin.email}</p>
                    
                    <div className="mt-auto pt-4 border-t border-gray-50 flex gap-2">
                      <button onClick={() => resetAdminPassword(admin.email)} className="flex-1 py-2 text-[8px] font-black text-slate-400 uppercase border border-gray-100 rounded-lg hover:bg-slate-50 transition-all">Reset Password</button>
                      <button onClick={() => dismissAdmin(admin.id)} className="flex-1 py-2 text-[8px] font-black text-red-600 uppercase border border-red-50 rounded-lg hover:bg-red-50 transition-all">Dismiss Staff</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
};

export default RootAdminDashboard;
