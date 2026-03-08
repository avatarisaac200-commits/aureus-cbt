import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

type ToastInput = {
  title: string;
  message?: string;
  variant?: ToastVariant;
};

type ToastItem = ToastInput & {
  id: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  toast: {
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
    info: (title: string, message?: string) => void;
    warning: (title: string, message?: string) => void;
  };
};

const ToastContext = createContext<ToastContextValue | null>(null);

let globalPushToast: ((input: ToastInput) => void) | null = null;

export const toast = {
  success: (title: string, message?: string) => globalPushToast?.({ title, message, variant: 'success' }),
  error: (title: string, message?: string) => globalPushToast?.({ title, message, variant: 'error' }),
  info: (title: string, message?: string) => globalPushToast?.({ title, message, variant: 'info' }),
  warning: (title: string, message?: string) => globalPushToast?.({ title, message, variant: 'warning' })
};

const ICONS: Record<ToastVariant, string> = {
  success: 'OK',
  error: 'X',
  info: 'i',
  warning: '!'
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timeoutMapRef = useRef<Record<string, number>>({});

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    const timeout = timeoutMapRef.current[id];
    if (timeout) {
      window.clearTimeout(timeout);
      delete timeoutMapRef.current[id];
    }
  }, []);

  const push = useCallback((input: ToastInput) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextItem: ToastItem = {
      id,
      title: input.title,
      message: input.message,
      variant: input.variant || 'info'
    };

    setItems((prev) => {
      const next = [...prev, nextItem];
      if (next.length <= 4) return next;
      return next.slice(next.length - 4);
    });

    timeoutMapRef.current[id] = window.setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

  useEffect(() => {
    globalPushToast = push;
    return () => {
      globalPushToast = null;
      Object.values(timeoutMapRef.current).forEach((timeout) => window.clearTimeout(timeout));
      timeoutMapRef.current = {};
    };
  }, [push]);

  const ctxValue = useMemo<ToastContextValue>(() => ({
    toast: {
      success: (title, message) => push({ title, message, variant: 'success' }),
      error: (title, message) => push({ title, message, variant: 'error' }),
      info: (title, message) => push({ title, message, variant: 'info' }),
      warning: (title, message) => push({ title, message, variant: 'warning' })
    }
  }), [push]);

  return (
    <ToastContext.Provider value={ctxValue}>
      {children}
      <div className="toast-stack">
        {items.map((item) => (
          <div key={item.id} className={`toast-item toast-${item.variant}`} role="status" aria-live="polite">
            <div className="toast-icon" aria-hidden="true">{ICONS[item.variant]}</div>
            <div className="toast-body">
              <p className="toast-title">{item.title}</p>
              {item.message ? <p className="toast-message">{item.message}</p> : null}
            </div>
            <button className="toast-close" type="button" onClick={() => dismiss(item.id)} aria-label="Dismiss">x</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};
