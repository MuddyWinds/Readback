import React from "react";
import { useUpdateResult } from "../../lib/queries";
import { ReviewStatus, STATUS_LABEL } from "./constants";
import styles from "./StatusWorkflow.module.css";

// Token name per review status — no hex
const STATUS_TOKEN: Record<ReviewStatus, string> = {
  new:            "--text-faint",
  under_review:   "--sev-medium",
  confirmed:      "--sev-critical",
  false_positive: "--sev-standard",
};

export function StatusWorkflow({
  resultId,
  initial,
  onChanged,
}: {
  resultId?: number;
  initial?: string;
  onChanged?: (next: ReviewStatus) => void;
}) {
  const [status, setStatus] = React.useState<ReviewStatus>((initial || "new") as ReviewStatus);
  const [saving, setSaving] = React.useState(false);
  const updateResult = useUpdateResult();
  const change = async (s: ReviewStatus) => {
    setStatus(s);
    if (!resultId) return;
    setSaving(true);
    try {
      await updateResult.mutateAsync({ id: resultId, patch: { status: s } });
      onChanged?.(s);
    } finally { setSaving(false); }
  };
  return (
    <div className={styles.container}>
      <span className={styles.label}>STATUS</span>
      {(["new", "under_review", "confirmed", "false_positive"] as ReviewStatus[]).map(s => (
        <button
          key={s}
          onClick={() => change(s)}
          className={`${styles.btn} ${status === s ? styles.btnActive : ""}`}
          style={status === s ? { ["--sw-color" as any]: `var(${STATUS_TOKEN[s]})` } : undefined}
        >
          {STATUS_LABEL[s]}
        </button>
      ))}
      {saving && <span className={styles.saving}>saving…</span>}
    </div>
  );
}
