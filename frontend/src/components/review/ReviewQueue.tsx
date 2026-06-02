import React from "react";
import { useReviewQueue, useUpdateResult } from "../../lib/queries";
import type { AnalysisResult } from "../../lib/types";
import type { ReviewStatus } from "../livefeed/constants";
import { ReviewRow } from "./ReviewRow";
import styles from "./ReviewQueue.module.css";

type ReviewChip = ReviewStatus | "all";

const CHIPS: { key: ReviewChip; label: string }[] = [
  { key: "new", label: "New" },
  { key: "under_review", label: "Reviewing" },
  { key: "confirmed", label: "Confirmed" },
  { key: "false_positive", label: "False +VE" },
  { key: "all", label: "All" },
];

function clamp(index: number, rows: AnalysisResult[]) {
  if (rows.length === 0) return 0;
  return Math.max(0, Math.min(index, rows.length - 1));
}

export function ReviewQueue() {
  const [status, setStatus] = React.useState<ReviewChip>("new");
  const [selected, setSelected] = React.useState(0);
  const selectedRef = React.useRef(0);
  const { data = [], isLoading, error } = useReviewQueue(status);
  const updateResult = useUpdateResult();
  const rows = data;

  const setSelectedIndex = React.useCallback((next: number | ((current: number) => number)) => {
    const raw = typeof next === "function" ? next(selectedRef.current) : next;
    const clamped = clamp(raw, rows);
    selectedRef.current = clamped;
    setSelected(clamped);
  }, [rows]);

  React.useEffect(() => {
    setSelectedIndex(i => i);
  }, [rows, setSelectedIndex]);

  const advance = React.useCallback(() => {
    setSelectedIndex(i => i + 1);
  }, [setSelectedIndex]);

  const selectedRow = rows[clamp(selected, rows)];

  const changeSelected = React.useCallback(
    async (next: ReviewStatus) => {
      const row = rows[clamp(selectedRef.current, rows)];
      if (!row?.id) return;
      const pending = updateResult.mutateAsync({ id: row.id, patch: { status: next } });
      advance();
      await pending;
    },
    [advance, rows, updateResult],
  );

  const focusNotes = React.useCallback(() => {
    if (!selectedRow?.id) return;
    const root = document.querySelector(`[data-review-notes="${selectedRow.id}"]`);
    const textarea = root?.querySelector("textarea") as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.focus();
      return;
    }
    const button = root?.querySelector("button") as HTMLButtonElement | null;
    button?.click();
    window.setTimeout(() => {
      const opened = root?.querySelector("textarea") as HTMLTextAreaElement | null;
      opened?.focus();
    }, 0);
  }, [selectedRow]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "j") {
        event.preventDefault();
        setSelectedIndex(i => i + 1);
      } else if (event.key === "k") {
        event.preventDefault();
        setSelectedIndex(i => i - 1);
      } else if (event.key === "c") {
        event.preventDefault();
        void changeSelected("confirmed");
      } else if (event.key === "x") {
        event.preventDefault();
        void changeSelected("false_positive");
      } else if (event.key === "u") {
        event.preventDefault();
        void changeSelected("under_review");
      } else if (event.key === "e") {
        event.preventDefault();
        focusNotes();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changeSelected, focusNotes, rows, setSelectedIndex]);

  return (
    <div className={styles.queue}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Review Queue</h2>
          <p className={styles.count}>
            {isLoading ? "Loading..." : `${rows.length} ${status === "new" ? "remaining" : "items"}`}
          </p>
        </div>
        <div className={styles.chips} role="tablist" aria-label="Review status">
          {CHIPS.map(chip => (
            <button
              key={chip.key}
              type="button"
              className={`${styles.chip} ${status === chip.key ? styles.chipActive : ""}`}
              onClick={() => {
                setStatus(chip.key);
                selectedRef.current = 0;
                setSelected(0);
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className={styles.empty}>Unable to load review queue: {(error as Error).message}</p>
      ) : isLoading ? (
        <p className={styles.empty}>Loading review queue...</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>No items in this queue.</p>
      ) : (
        <div className={styles.rows}>
          {rows.map((row, index) => (
            <ReviewRow
              key={row.id ?? `${row.timestamp}-${index}`}
              row={row}
              selected={index === clamp(selected, rows)}
              onChanged={() => advance()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
