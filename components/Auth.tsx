import React, { useState } from 'react';
import { User } from '../types';
import { auth, db } from '../firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import logo from '../assets/logo.png';

interface AuthProps {
  onLogin: (user: User) => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  // Restored to original branding
  const ADMIN_EMAIL = 'admin@aureusmedicos.com';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
        if (userDoc.exists()) {
          onLogin(userDoc.data() as User);
        }
      } else {
        if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
          throw new Error("Admin registration must be handled by existing administrator.");
        }

        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUser: User = {
          id: userCredential.user.uid,
          name,
          email,
          role: 'student'
        };
        await setDoc(doc(db, 'users', userCredential.user.uid), newUser);
        onLogin(newUser);
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center p-6">
      <div className="mb-8 flex flex-col items-center">
        <img src={logo} alt="Aureus Medicos Logo" className="w-24 h-24 md:w-32 md:h-32 mb-4 drop-shadow-xl" />
        <h2 className="text-slate-900 font-black text-2xl tracking-tighter uppercase">Aureus Medicos CBT</h2>
      </div>

      <div className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-gray-200">
        <div className="bg-slate-950 px-8 py-10 text-center border-b-4 border-amber-500">
           <h1 className="text-xl font-black text-white tracking-widest mb-1 uppercase">CBT Practice Portal</h1>
           <p className="text-amber-400 text-[10px] font-bold uppercase tracking-[0.2em]">Medical Board Standards</p>
        </div>
        
        <div className="p-8 md:p-12">
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Full Name</label>
                <input 
                   type="text" 
                   value={name} onChange={e => setName(e.target.value)}
                   className="p-4 bg-slate-50 border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-amber-500/20 transition-all font-bold text-sm"
                   placeholder="Enter your name" required
                />
              </div>
            )}
            <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Email Address</label>
                <input 
                   type="email" 
                   value={email} onChange={e => setEmail(e.target.value)}
                   className="p-4 bg-slate-50 border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-amber-500/20 transition-all font-bold text-sm"
                   placeholder="doctor@aureusmedicos.com" required
                />
            </div>
            <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Secure Password</label>
                <input 
                   type="password" 
                   value={password} onChange={e => setPassword(e.target.value)}
                   className="p-4 bg-slate-50 border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-amber-500/20 transition-all font-bold text-sm"
                   placeholder="••••••••" required
                />
            </div>

            <button 
              disabled={loading}
              className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase tracking-[0.3em] text-xs hover:bg-slate-800 shadow-xl transition-all mt-6 disabled:opacity-50"
            >
               {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
            </button>
          </form>

          <div className="mt-10 text-center">
             <button 
                onClick={() => setIsLogin(!isLogin)}
                className="text-[10px] font-black text-slate-400 hover:text-slate-900 transition-colors uppercase tracking-widest"
             >
                {isLogin ? "New candidate? Start Here" : "Existing doctor? Sign in"}
             </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;