
import React, { useState } from 'react';
import { User } from '../types';
import { auth, db } from '../firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const logo = '/assets/logo.png?v=2';

// Fixed missing component logic and default export
interface AuthProps {
  onLogin: (user: User) => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isLogin) {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
        if (userDoc.exists()) {
          onLogin({ ...userDoc.data() as User, id: userCredential.user.uid });
        }
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const userData: User = {
          id: userCredential.user.uid,
          name,
          email,
          role: 'student'
        };
        await setDoc(doc(db, 'users', userCredential.user.uid), userData);
        onLogin(userData);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 border border-slate-100">
        <div className="flex flex-col items-center mb-8">
          <img src={logo} className="w-16 h-16 mb-4" alt="Logo" />
          <h1 className="text-xl font-black uppercase tracking-widest text-slate-900">Aureus Medicos</h1>
          <p className="text-slate-500 text-sm mt-1">{isLogin ? 'Welcome back, doctor.' : 'Begin your journey.'}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 ml-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900 placeholder-slate-300 focus:ring-2 focus:ring-amber-500 transition-all"
                placeholder="John Doe"
                required
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 ml-1">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900 placeholder-slate-300 focus:ring-2 focus:ring-amber-500 transition-all"
              placeholder="doc@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 ml-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900 placeholder-slate-300 focus:ring-2 focus:ring-amber-500 transition-all"
              placeholder="••••••••"
              required
            />
          </div>

          {error && <p className="text-rose-500 text-xs font-bold mt-2">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl shadow-lg hover:bg-slate-800 transition-all transform active:scale-95 disabled:opacity-50"
          >
            {loading ? 'PROCESSING...' : (isLogin ? 'SIGN IN' : 'CREATE ACCOUNT')}
          </button>
        </form>

        <button
          onClick={() => setIsLogin(!isLogin)}
          className="w-full mt-6 text-slate-400 text-xs font-bold uppercase tracking-widest hover:text-amber-600 transition-colors"
        >
          {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
};

export default Auth;
