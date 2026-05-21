import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
}

const ICONS = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚡' };
const COLORS = {
  success: 'border-green-500/30 bg-green-500/10 text-green-300',
  error:   'border-red-500/30 bg-red-500/10 text-red-300',
  info:    'border-accent-primary/30 bg-accent-primary/10 text-slate-200',
  warning: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
};

function ToastContainer({ toasts, removeToast }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-xs w-full pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          onClick={() => removeToast(t.id)}
          className={`flex items-center gap-3 px-4 py-3 rounded-2xl border backdrop-blur-xl shadow-xl
            animate-slide-up pointer-events-auto cursor-pointer select-none
            ${COLORS[t.type] || COLORS.info}`}
        >
          <span className="text-base flex-shrink-0">{ICONS[t.type]}</span>
          <span className="text-sm font-body leading-snug">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
};
