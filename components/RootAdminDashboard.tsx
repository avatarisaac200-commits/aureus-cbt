
import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { db } from '../firebase';
import { collection, getDocs, doc, updateDoc, query, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const logo = '/assets/logo.png?v=2';

// Fixed missing component logic and default export
interface RootAdminDashboardProps {
  user: User;
  onLogout: () => void;
  onSwitchToStudent: () => void;
  onSwitchToAdmin: () => void;
}

const RootAdminDashboard: React.FC<RootAdminDashboardProps> = ({ user, onLogout, onSwitchToStudent, onSwitchToAdmin }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    const q = query(collection(db, 'users'));
    const snap = await getDocs(q);
    setUsers(snap.docs.map(d => ({ ...d.data(), id: d.id }) as User));
    setLoading(false);
  };

  const toggleRole = async (targetUser: User) => {
    const newRole = targetUser.role === 'admin' ? 'student' : 'admin';
    await updateDoc(doc(db, 'users', targetUser.id), { role: newRole });
    fetchUsers();
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden text-slate-900">
      <header className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={logo} className="w-8 h-8" alt="Logo" />
          <h1 className="text-sm font-black uppercase tracking-widest">Root Admin Control</h1>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onSwitchToAdmin} className="text-[10px] font-black uppercase tracking-widest text-amber-600 border border-amber-100 px-3 py-1.5 rounded-full hover:bg-amber-50">Admin Panel</button>
          <button onClick={onSwitchToStudent} className="text-[10px] font-black uppercase tracking-widest text-slate-400 border border-slate-100 px-3 py-1.5 rounded-full hover:bg-slate-50">Student View</button>
          <button onClick={onLogout} className="text-[10px] font-black uppercase tracking-widest text-rose-500 border border-rose-100 px-3 py-1.5 rounded-full hover:bg-rose-50">Logout</button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-4">User Management</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Name</th>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Email</th>
                  <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Role</th>
                  <th className="px-6 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-bold text-sm">{u.name}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{u.email}</td>
                    <td className="px-6 py-4">
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${u.role === 'root-admin' ? 'bg-slate-900 text-white' : u.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {u.role !== 'root-admin' && (
                        <button
                          onClick={() => toggleRole(u)}
                          className="text-[10px] font-black uppercase tracking-widest text-amber-600 hover:text-amber-700"
                        >
                          {u.role === 'admin' ? 'Demote' : 'Promote'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};

export default RootAdminDashboard;
