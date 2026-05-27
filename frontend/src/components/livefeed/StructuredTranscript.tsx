import React from "react";
import type { Enrichment } from "../../lib/types";
import { isAsrAmbiguous } from "../../lib/transcript";
import styles from "./StructuredTranscript.module.css";

/** Structured transcript: speaker-labelled turns, readback comparison. */
export function StructuredTranscript({
  enrichment, rawTranscript, borderColor, assessableConfidence,
}: { enrichment: Enrichment | null | undefined; rawTranscript: string; borderColor: string; assessableConfidence?: number }) {
  const segs = enrichment?.speaker_segments;
  const hasStructure = segs && segs.length > 0 && segs.some(s => s.role !== "UNKNOWN");

  if (!hasStructure) {
    return (
      <div className={styles.rawTranscript}>
        {rawTranscript}
      </div>
    );
  }

  const roleChipClass: Record<string, string> = {
    ATC: styles.roleAtc,
    PILOT: styles.rolePilot,
    UNKNOWN: styles.roleUnknown,
  };
  const roleLabel = { ATC: "ATC", PILOT: "PIL", UNKNOWN: "???" };

  return (
    <div className={styles.segList}>
      {segs!.map((seg, i) => (
        <div key={i} className={styles.segRow}>
          <span className={`${styles.roleChip} ${roleChipClass[seg.role] ?? styles.roleUnknown}`}>
            {roleLabel[seg.role as keyof typeof roleLabel] ?? "???"}
          </span>
          <span className={styles.segText}>
            {seg.text}
          </span>
        </div>
      ))}

      {/* Readback comparison block */}
      {enrichment?.readback_correct === false && enrichment.readback_discrepancy && (() => {
        const lowConfidence = (assessableConfidence ?? 1) < 0.6;
        const asrAmbig = isAsrAmbiguous(enrichment.atc_instruction, enrichment.pilot_readback);
        if (lowConfidence) {
          return (
            <div className={styles.readbackLowConf}>
              <span className={styles.readbackLowConfText}>
                ⚠ Transcript quality insufficient to verify readback — manual review required.
              </span>
            </div>
          );
        }
        return (
          <div className={`${styles.readbackBlock} ${asrAmbig ? styles.readbackAsr : styles.readbackDiscrep}`}>
            <div className={`${styles.readbackHeading} ${asrAmbig ? styles.readbackHeadingAsr : styles.readbackHeadingDiscrep}`}>
              {asrAmbig ? "POSSIBLE ASR ARTEFACT — VERIFY MANUALLY" : "READBACK DISCREPANCY DETECTED"}
            </div>
            {enrichment.atc_instruction && (
              <div className={styles.readbackRow}>
                <span className={styles.readbackAtcLabel}>ATC:</span>
                <span className={styles.readbackInstruction}>{enrichment.atc_instruction}</span>
              </div>
            )}
            {enrichment.pilot_readback && (
              <div className={styles.readbackRowLast}>
                <span className={styles.readbackPilotLabel}>Pilot:</span>
                <span className={asrAmbig ? styles.readbackValueAsr : styles.readbackValueDiscrep}>{enrichment.pilot_readback}</span>
              </div>
            )}
            <div className={`${styles.readbackDiscrepText} ${asrAmbig ? styles.readbackDiscrepTextAsr : styles.readbackDiscrepTextDiscrep}`}>
              {enrichment.readback_discrepancy}
            </div>
            {asrAmbig && (
              <div className={styles.readbackAsrNote}>
                Values normalise to the same number after removing ASR phonetic substitutions — likely not a true error.
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
