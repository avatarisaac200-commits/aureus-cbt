
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { ToastProvider } from './components/ui/Toast';
import { ConfirmDialogProvider } from './components/ui/ConfirmDialog';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ToastProvider>
      <ConfirmDialogProvider>
        <App />
      </ConfirmDialogProvider>
    </ToastProvider>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Ignore service worker registration failures in unsupported/private contexts.
    });
  });
}
