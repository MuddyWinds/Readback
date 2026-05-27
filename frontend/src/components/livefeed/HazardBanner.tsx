import React from "react";
import { useHazards } from "../../lib/queries";
import { isActiveAt } from "../../lib/conflicts";
import styles from "./HazardBanner.module.css";

/** Banner shown on ObservationCard when met hazards were active at observation time. */
export function HazardBanner({ airport, timestamp }: { airport: string; timestamp: string }) {
  const { data: hazards } = useHazards(airport);
  if (!hazards) return null;

  const activeSigmets = (hazards.sigmets ?? []).filter((s: any) => isActiveAt(s.from, s.to, timestamp));
  const activeAirmets = (hazards.airmets ?? []).filter((a: any) => isActiveAt(a.from, a.to, timestamp));
  const recentPireps  = (hazards.pireps  ?? []).filter((p: any) => {
    if (!p.obs_time || (!p.turb && !p.icing)) return false;
    return Math.abs(new Date(timestamp.endsWith("Z") ? timestamp : timestamp + "Z").getTime()
                  - new Date(p.obs_time).getTime()) < 2 * 3_600_000;
  });

  if (!activeSigmets.length && !activeAirmets.length && !recentPireps.length) return null;

  return (
    <div className={styles.banner}>
      {activeSigmets.map((s: any, i: number) => (
        <div key={i} className={styles.row}>
          <span className={`${styles.typeLabel} ${styles.sigmetLabel}`}>SIGMET</span>
          <span className={styles.rowText}>
            {s.hazard}{s.severity ? ` (${s.severity})` : ""}
            {s.alt_low && s.alt_high ? ` · ${Math.round(s.alt_low/100)*100}–${Math.round(s.alt_high/100)*100} ft` : ""}
          </span>
          <span className={styles.rowNote}>active at time of transmission</span>
        </div>
      ))}
      {activeAirmets.map((a: any, i: number) => (
        <div key={i} className={styles.row}>
          <span className={`${styles.typeLabel} ${styles.airmetLabel}`}>AIRMET</span>
          <span className={styles.rowText}>{a.hazard}</span>
          <span className={styles.rowNote}>active at time of transmission</span>
        </div>
      ))}
      {recentPireps.map((p: any, i: number) => (
        <div key={i} className={styles.row}>
          <span className={`${styles.typeLabel} ${styles.pirepLabel}`}>PIREP</span>
          <span className={styles.rowText}>
            {p.turb  ? `Turb: ${p.turb}` : ""}{p.icing ? ` Icing: ${p.icing}` : ""}
            {p.altitude ? ` @ ${p.altitude} ft` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
