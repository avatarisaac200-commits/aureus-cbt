
import React, { useState } from 'react';
import { User } from '../types';
import { auth, db } from '../firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import logo from '../assets/logo.png';

interface AuthProps {
  onLogin: (firebaseUser: any) => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
        onLogin(userCredential.user);
      } else {
        const trimmedEmail = email.trim();
        const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
        
        const isOfficialEmail = trimmedEmail.toLowerCase().endsWith('@aureusmedicos.com');
        
        // Save user profile immediately
        const assignedRole = trimmedEmail.toLowerCase() === 'admin@aureusmedicos.com' ? 'admin' : 'student';
        const newUser: User = { 
          id: userCredential.user.uid, 
          name, 
          email: trimmedEmail, 
          role: assignedRole,
          subscriptionStatus: 'inactive'
        };
        await setDoc(doc(db, 'users', userCredential.user.uid), newUser);

        // Verification logic
        if (!isOfficialEmail) {
          await sendEmailVerification(userCredential.user);
          alert("Account successfully created! A verification link has been sent to your email. Please activate it to sign in.");
          setIsLogin(true);
          setLoading(false);
          return;
        }
        
        // Staff members skip verify-email screen
        onLogin(userCredential.user);
      }
    } catch (error: any) {
      alert("Authentication Error: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 min-h-[100dvh] bg-slate-50 flex flex-col justify-start md:justify-center items-center p-6 overflow-y-auto no-scrollbar safe-top safe-bottom">
      <div className="mb-10 flex flex-col items-center shrink-0 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <img src={logo} alt="Aureus Medicos CBT Logo" className="w-28 h-28 mb-6 drop-shadow-2xl" />
        <h1 className="text-slate-900 font-black text-3xl tracking-tighter uppercase text-center leading-none">Aureus Medicos CBT</h1>
        <p className="text-amber-600 font-black text-[10px] tracking-[0.4em] uppercase mt-2">Exam Practice Portal</p>
      </div>
      <div className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-100 max-h-[calc(100dvh-9rem)] flex flex-col">
        <div className="bg-slate-950 px-8 py-10 text-center border-b-4 border-amber-500 shrink-0">
           <h1 className="text-xl font-black text-white tracking-widest mb-1 uppercase">{isLogin ? 'Sign In' : 'Create Account'}</h1>
           <p className="text-amber-400 text-[9px] font-bold uppercase tracking-[0.2em]">Aureus Medicos CBT</p>
        </div>
        <div className="p-8 md:p-12 overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Full Name" required />
            )}
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Email Address" required />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Password" required />
            <button disabled={loading} className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase tracking-[0.3em] text-xs shadow-xl active:scale-95 transition-all mt-6 hover:bg-slate-900 flex justify-center items-center">
               {loading ? (
                 <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
               ) : (isLogin ? 'Sign In' : 'Create & Verify')}
            </button>
          </form>
          <div className="mt-8 text-center">
             <button onClick={() => setIsLogin(!isLogin)} className="text-[10px] font-black text-slate-400 hover:text-amber-600 transition-colors uppercase tracking-widest">
                {isLogin ? "New user? Create an account" : "Already have an account? Sign in"}
             </button>
          </div>
        </div>
      </div>
      <p className="mt-8 text-slate-400 text-[8px] font-bold uppercase tracking-widest text-center px-6 leading-relaxed">
        Email verification is required.<br/>
        Staff can sign in with @aureusmedicos.com.
      </p>
    </div>
  );
};

export default Auth;
