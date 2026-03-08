
import React, { useState } from 'react';
import { User } from '../types';
import { auth, db } from '../firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import logo from '../assets/logo.png';
import { toast } from './ui/Toast';

interface AuthProps {
  onLogin: (firebaseUser: any) => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
          emailVerified: isOfficialEmail,
          subscriptionStatus: 'inactive'
        };
        await setDoc(doc(db, 'users', userCredential.user.uid), newUser);

        // Verification logic
        if (!isOfficialEmail) {
          await sendEmailVerification(userCredential.user);
          toast.success('Account created', 'A verification link has been sent to your email.');
          setIsLogin(true);
          setLoading(false);
          return;
        }
        
        // Staff members skip verify-email screen
        onLogin(userCredential.user);
      }
    } catch (error: any) {
      toast.error('Authentication error', error?.message || 'Could not authenticate.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const targetEmail = email.trim();
    if (!targetEmail) {
      toast.warning('Missing email', 'Enter your email first, then tap Forgot Password.');
      return;
    }
    setIsSendingReset(true);
    try {
      await sendPasswordResetEmail(auth, targetEmail);
      toast.success('Reset link sent', 'Check your inbox/spam folder.');
    } catch (error: any) {
      toast.error('Reset failed', error?.message || 'Unknown error');
    } finally {
      setIsSendingReset(false);
    }
  };

  return (
    <div className="v2-page flex-1 min-h-[100dvh] bg-slate-50 flex flex-col justify-start md:justify-center items-center p-6 overflow-y-auto no-scrollbar safe-top safe-bottom">
      <div className="mb-10 flex flex-col items-center shrink-0 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <img src={logo} alt="Aureus Medicos CBT Logo" className="w-28 h-28 mb-6 drop-shadow-2xl" />
        <h1 className="text-slate-900 font-black text-3xl tracking-tighter uppercase text-center leading-none">Aureus Medicos CBT</h1>
        <p className="text-amber-600 font-black text-xs tracking-[0.4em] uppercase mt-2">Exam Practice Portal</p>
      </div>
      <div className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-100 max-h-[calc(100dvh-9rem)] flex flex-col">
        <div className="bg-slate-950 px-8 py-10 text-center border-b-4 border-amber-500 shrink-0">
           <h1 className="text-xl font-black text-white tracking-widest mb-1 uppercase">{isLogin ? 'Sign In' : 'Create Account'}</h1>
           <p className="text-amber-400 text-xs font-bold uppercase tracking-[0.2em]">Aureus Medicos CBT</p>
        </div>
        <div className="p-8 md:p-12 overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label htmlFor="auth-name">Full Name</label>
                <input id="auth-name" type="text" value={name} onChange={e => setName(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="e.g. Jane Doe" required />
              </div>
            )}
            <div>
              <label htmlFor="auth-email">Email</label>
              <input id="auth-email" type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="name@example.com" required />
            </div>
            <div>
              <label htmlFor="auth-password">Password</label>
              <div className="flex gap-2">
                <input id="auth-password" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Enter password" required />
                <button type="button" className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold" onClick={() => setShowPassword((prev) => !prev)}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button disabled={loading} className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-black uppercase tracking-[0.3em] text-xs shadow-xl active:scale-95 transition-all mt-6 hover:bg-slate-900 flex justify-center items-center">
               {loading ? (
                 <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
               ) : (isLogin ? 'Sign In' : 'Create & Verify')}
            </button>
            {isLogin && (
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={isSendingReset}
                className="w-full py-3 border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                {isSendingReset ? 'Sending Reset Link...' : 'Forgot Password?'}
              </button>
            )}
          </form>
          <div className="mt-8 text-center">
             <button onClick={() => setIsLogin(!isLogin)} className="text-xs font-black text-slate-400 hover:text-amber-600 transition-colors uppercase tracking-widest">
                {isLogin ? "New user? Create an account" : "Already have an account? Sign in"}
             </button>
          </div>
        </div>
      </div>
      <p className="mt-8 text-slate-400 text-xs font-bold uppercase tracking-widest text-center px-6 leading-relaxed">
        Email verification is required.<br/>
        Staff can sign in with @aureusmedicos.com.
      </p>
    </div>
  );
};

export default Auth;

