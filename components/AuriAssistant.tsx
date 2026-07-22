import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { auth } from '../firebase';
import ScientificText from './ScientificText';

type AuriMessage = {
  id: string;
  role: 'auri' | 'student';
  text: string;
};

type AuriAssistantProps = {
  userName: string;
  view: string;
  isQuizMode?: boolean;
};

const getWelcome = (name: string, isQuizMode: boolean) => isQuizMode
  ? `Hey ${name}! Quiz mode means we can learn as we go. Show me what feels sneaky and we'll unpack it together.`
  : `Hey ${name}! I'm Auri - your study sidekick. I can help you study or find your way around the app. What are we conquering today?`;

const suggestions = ['Explain a topic simply', 'Help me make a study plan', 'Where do I find my flashcards?'];
const AURI_WORKER_URL = (import.meta.env.VITE_AURI_WORKER_URL as string | undefined)?.replace(/\/$/, '') || '';

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const AuriAssistant: React.FC<AuriAssistantProps> = ({ userName, view, isQuizMode = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<AuriMessage[]>(() => [{
    id: makeId(),
    role: 'auri',
    text: getWelcome(userName, isQuizMode)
  }]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([{ id: makeId(), role: 'auri', text: getWelcome(userName, isQuizMode) }]);
  }, [userName, isQuizMode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, isSending, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const sendMessage = async (value = input) => {
    const message = value.trim();
    if (!message || isSending) return;

    setMessages((previous) => [...previous, { id: makeId(), role: 'student', text: message }]);
    setInput('');
    setIsSending(true);

    try {
      if (!AURI_WORKER_URL) {
        throw new Error('Auri is not connected yet. Please ask an administrator to finish setup.');
      }
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error('Please sign in again before talking with Auri.');
      }
      const response = await fetch(`${AURI_WORKER_URL}/auri`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ message, context: { view, isQuizMode } })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || 'Could not reach Auri right now.'));
      }
      const text = String(payload?.text || '').trim() || "Ooo, my thoughts got tangled for a second. Try that again?";
      setMessages((previous) => [...previous, { id: makeId(), role: 'auri', text }]);
    } catch (error: any) {
      const messageText = String(error?.message || 'Could not reach Auri right now.').replace(/^internal\s*/i, '');
      setMessages((previous) => [...previous, {
        id: makeId(),
        role: 'auri',
        text: `${messageText} Try again in a moment.`
      }]);
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage();
  };

  const startNewChat = () => {
    setInput('');
    setMessages([{ id: makeId(), role: 'auri', text: getWelcome(userName, isQuizMode) }]);
  };

  useEffect(() => {
    const handleDeepDive = (event: Event) => {
      const prompt = String((event as CustomEvent<{ prompt?: string }>).detail?.prompt || '').trim();
      if (!prompt) return;
      setIsOpen(true);
      void sendMessage(prompt);
    };
    window.addEventListener('auri:deep-dive', handleDeepDive);
    return () => window.removeEventListener('auri:deep-dive', handleDeepDive);
  });

  return (
    <>
      {isOpen && (
        <section className="auri-fullscreen fixed inset-0 z-[230] flex flex-col bg-slate-50" aria-label="Auri study space">
          <header className="safe-top flex shrink-0 items-center justify-between bg-slate-950 px-4 py-3 text-white shadow-lg sm:px-6">
            <button type="button" onClick={() => setIsOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800 hover:text-white" aria-label="Go back to the app">
              <span aria-hidden="true">←</span> Back
            </button>
            <div className="min-w-0 text-center">
              <p className="text-base font-black tracking-wide text-amber-400">Auri</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Your study space</p>
            </div>
            <button type="button" onClick={startNewChat} disabled={isSending} className="rounded-xl px-3 py-2 text-xs font-black uppercase tracking-wide text-amber-400 hover:bg-slate-800 disabled:opacity-40">New chat</button>
          </header>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col space-y-4 px-4 py-6 sm:px-6 sm:py-8">
              <div className="mb-2 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <span className="font-black">Let’s make this ridiculously easy.</span> Ask about a topic, a review question, or where to find something in the app.
              </div>
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'student' ? 'justify-end' : 'justify-start'}`}>
                <div className={`auri-message max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm sm:max-w-[82%] ${message.role === 'student'
                  ? 'rounded-br-md bg-amber-500 font-medium text-slate-950'
                  : 'rounded-bl-md border border-slate-200 bg-white text-slate-700'}`}
                >
                  <ScientificText text={message.text} />
                </div>
              </div>
            ))}
            {isSending && (
              <p className="w-fit rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">Auri is thinking...</p>
            )}
            <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="safe-bottom shrink-0 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.05)] sm:px-6">
            <div className="mx-auto w-full max-w-4xl">
              {messages.length === 1 && (
                <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={isSending}
                    onClick={() => void sendMessage(suggestion)}
                    className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-left text-[11px] font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              )}
              <form onSubmit={handleSubmit} className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value.slice(0, 2000))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  rows={2}
                  maxLength={2000}
                  placeholder="Ask Auri anything study-related..."
                  className="auri-composer min-h-[48px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                  aria-label="Message Auri"
                />
                <button type="submit" disabled={!input.trim() || isSending} className="rounded-xl bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-wider text-amber-400 disabled:cursor-not-allowed disabled:opacity-40">Send</button>
              </form>
            </div>
          </div>
        </section>
      )}
      {!isOpen && (
        <div className="auri-floating fixed right-4 z-[220] sm:right-6">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-3 rounded-full bg-slate-950 px-5 py-4 text-left text-white shadow-2xl transition hover:-translate-y-0.5 hover:bg-slate-800"
            aria-expanded={false}
            aria-label="Open Auri assistant"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500 text-lg">*</span>
            <span><span className="block text-sm font-black text-amber-400">Ask Auri</span><span className="block text-[10px] font-bold uppercase tracking-widest text-slate-300">Study sidekick</span></span>
          </button>
        </div>
      )}
    </>
  );
};

export default AuriAssistant;
