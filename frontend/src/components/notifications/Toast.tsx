import React from "react";
import { ToastData } from "./NotificationProvider";
import styles from "./Toast.module.css";

export function ToastStack({ toasts, onDismiss }: { toasts: ToastData[]; onDismiss: (id: number) => void }) {
  return (
    <div className={styles.stack} role="region" aria-label="Alerts">
      {toasts.map(t => <Toast key={t.id} toast={t} onDismiss={onDismiss} />)}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: (id: number) => void }) {
  // The main action is a real <button> (native Enter/Space, no preventDefault
  // hacks). The close control is a *sibling*, not nested inside it, so there are
  // no nested interactive elements.
  return (
    <div className={styles.toast} style={{ ["--accent" as any]: `var(--sev-${toast.severity})` }}>
      <button
        type="button"
        className={styles.main}
        onClick={() => { toast.onClick?.(); onDismiss(toast.id); }}
      >
        <span className={styles.head}>
          <span className={styles.code}>{toast.code}</span>
          <span className={styles.sev}>{toast.severity.toUpperCase()}</span>
        </span>
        <span className={styles.summary}>{toast.summary}</span>
      </button>
      <button
        type="button"
        className={styles.close}
        aria-label="Dismiss alert"
        onClick={() => onDismiss(toast.id)}
      >✕</button>
    </div>
  );
}
