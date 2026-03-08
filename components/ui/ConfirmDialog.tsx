import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type ConfirmVariant = 'primary' | 'danger';

export type ConfirmInput = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
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
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const close = useCallback((value: boolean) => {
    if (resolverRef.current) {
      resolverRef.current(value);
      resolverRef.current = null;
    }
    setState({ isOpen: false, input: null });
  }, []);

  const confirm = useCallback((input: ConfirmInput) => {
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
            <div className="confirm-actions">
              <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
                {state.input.cancelText || 'Cancel'}
              </button>
              <button
                type="button"
                className={`btn ${state.input.variant === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => close(true)}
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
