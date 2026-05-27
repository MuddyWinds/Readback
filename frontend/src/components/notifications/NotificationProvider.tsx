import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Severity } from "../../lib/severity";
import { ToastStack } from "./Toast";

export interface ToastData {
  id: number;
  code: string;
  severity: Severity;
  summary: string;
  onClick?: () => void;
}

interface NotificationContextValue {
  enqueue: (t: Omit<ToastData, "id">) => void;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

const STACK_CAP = 3;
const AUTO_DISMISS_MS = 6000;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const nextId = useRef(0);
  // Track auto-dismiss timers so they can be cleared on manual dismiss, when a
  // toast is capped out of the stack, and on unmount — avoiding setState-after-
  // unmount (StrictMode/tests) and orphaned timers.
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
  }, []);

  const dismiss = useCallback((id: number) => {
    clearTimer(id);
    setToasts(ts => ts.filter(t => t.id !== id));
  }, [clearTimer]);

  const enqueue = useCallback((t: Omit<ToastData, "id">) => {
    const id = ++nextId.current;
    setToasts(ts => {
      const next = [{ ...t, id }, ...ts];                 // newest on top
      next.slice(STACK_CAP).forEach(o => clearTimer(o.id)); // clear capped-out timers
      return next.slice(0, STACK_CAP);
    });
    timers.current.set(id, setTimeout(() => dismiss(id), AUTO_DISMISS_MS));
  }, [dismiss, clearTimer]);

  // Clear any pending timers on unmount.
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  return (
    <NotificationContext.Provider value={{ enqueue }}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within a NotificationProvider");
  return ctx;
}
