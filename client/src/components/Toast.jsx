/**
 * Toast notifications.
 *
 * WHY: inline error boxes push the layout around and are easy to miss. A toast
 * confirms an action (upload finished, quiz graded) without disturbing the page.
 *
 * Implementation is a tiny React context - enough for this app, and far less
 * machinery than a state library. `useToast()` returns { success, error, info }.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, kind = 'info', ttl = 4200) => {
      const id = nextId++;
      setToasts((list) => [...list, { id, message, kind }]);
      // Auto-dismiss. The timeout is owned by the toast, not the caller, so
      // callers never have to remember to clean up.
      setTimeout(() => remove(id), ttl);
    },
    [remove],
  );

  // Memoise the API so consumers do not re-render on unrelated state changes.
  const api = useMemo(
    () => ({
      success: (m, ttl) => push(m, 'success', ttl),
      error: (m, ttl) => push(m, 'error', ttl ?? 6000),
      info: (m, ttl) => push(m, 'info', ttl),
    }),
    [push],
  );

  const icons = { success: '✓', error: '!', info: 'i' };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => remove(t.id)} role="status">
            <strong style={{ opacity: 0.7 }}>{icons[t.kind]}</strong>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Access the toast API. Throws if used outside the provider (a real bug). */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
