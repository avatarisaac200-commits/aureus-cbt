import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type ConfirmVariant = 'primary' | 'danger';

export type ConfirmInput = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
  expectedPassword?: string;
};

type ConfirmContextValue = {
  confirm: (input: ConfirmInput) => Promise<boolean>;
};

type ConfirmState = {
  isOpen: boolean;
  input: ConfirmInput | null;
};

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

let globalConfirmImpl: ((input: ConfirmInput) => Promise<boolean>) | null = null;

export const confirmDialog = (input: ConfirmInput) => {
  if (!globalConfirmImpl) return Promise.resolve(false);
  return globalConfirmImpl(input);
};

export const ConfirmDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<ConfirmState>({ isOpen: false, input: null });
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const close = useCallback((value: boolean) => {
    if (resolverRef.current) {
      resolverRef.current(value);
      resolverRef.current = null;
    }
    setState({ isOpen: false, input: null });
    setPassword('');
    setPasswordError('');
  }, []);

  const confirm = useCallback((input: ConfirmInput) => {
    setPassword('');
    setPasswordError('');
    setState({ isOpen: true, input });
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  useEffect(() => {
    globalConfirmImpl = confirm;
    return () => {
      globalConfirmImpl = null;
    };
  }, [confirm]);

  const ctxValue = useMemo<ConfirmContextValue>(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={ctxValue}>
      {children}
      {state.isOpen && state.input ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={state.input.title}>
          <div className="confirm-panel">
            <h3 className="confirm-title font-display">{state.input.title}</h3>
            <p className="confirm-message">{state.input.message}</p>
            {state.input.expectedPassword !== undefined && (
              <div className="mt-4">
                <label htmlFor="confirm-password">Password</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setPasswordError(''); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      if (password.trim() === state.input?.expectedPassword) close(true);
                      else setPasswordError('That password is not correct.');
                    }
                  }}
                  className="mt-1 w-full px-3 py-2"
                  placeholder="Enter test password"
                />
                {passwordError && <p className="mt-2 text-sm text-red-600">{passwordError}</p>}
              </div>
            )}
            <div className="confirm-actions">
              <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
                {state.input.cancelText || 'Cancel'}
              </button>
              <button
                type="button"
                className={`btn ${state.input.variant === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => {
                  if (state.input?.expectedPassword !== undefined && password.trim() !== state.input.expectedPassword) {
                    setPasswordError('That password is not correct.');
                    return;
                  }
                  close(true);
                }}
              >
                {state.input.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
};

export const useConfirm = () => {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within ConfirmDialogProvider');
  }
  return context;
};
