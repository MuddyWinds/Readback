import React from "react";
import { useUpdateResult } from "../../lib/queries";
import { SectionLabel } from "./SectionLabel";
import styles from "./ReviewerNotes.module.css";

export function ReviewerNotes({ resultId, initial }: { resultId?: number; initial?: string }) {
  const [notes, setNotes] = React.useState(initial ?? "");
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const updateResult = useUpdateResult();
  const save = async () => {
    setSaving(true);
    try {
      if (resultId) {
        await updateResult.mutateAsync({ id: resultId, patch: { reviewer_notes: notes } });
      }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div>
      <div className={styles.header}>
        <SectionLabel>Reviewer Notes</SectionLabel>
        {!editing && (
          <button onClick={() => setEditing(true)} className={styles.editLink}>
            {notes ? "Edit" : "+ Add note"}
          </button>
        )}
      </div>
      {editing ? (
        <div>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            autoFocus
            className={styles.textarea}
            placeholder="Review notes, transcript caveats, study context…"
          />
          <div className={styles.actions}>
            <button onClick={save} disabled={saving} className={styles.saveBtn}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setNotes(initial ?? ""); setEditing(false); }} className={styles.cancelBtn}>
              Cancel
            </button>
          </div>
        </div>
      ) : notes ? (
        <p className={styles.notes}>
          {notes}
        </p>
      ) : null}
    </div>
  );
}
