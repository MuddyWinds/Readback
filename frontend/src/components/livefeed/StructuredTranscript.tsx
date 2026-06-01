import React from "react";
import type { Enrichment } from "../../lib/types";
import { isAsrAmbiguous } from "../../lib/transcript";
import { resolveExcerptMarks, tokenizeBlock, type ExcerptMark, type TextBlock } from "../../lib/excerptHighlight";
import styles from "./StructuredTranscript.module.css";

/** Render one text block's tokens, wrapping mark tokens in numbered glow spans. */
function renderTokens(
  text: string,
  allocations: ReturnType<typeof resolveExcerptMarks>,
  activeMark: number | null | undefined,
  onMarkHover: ((n: number | null) => void) | undefined,
) {
  return tokenizeBlock(text, allocations).map((t, i) => {
    if (t.type === "text") return <span key={i}>{t.text}</span>;
    const isActive = activeMark === t.n;
    return (
      <mark
        key={i}
        className={`${styles.mark} ${isActive ? styles.markActive : ""}`}
        tabIndex={0}
        aria-label={`Finding ${t.n} reference`}
        onMouseEnter={() => onMarkHover?.(t.n)}
        onMouseLeave={() => onMarkHover?.(null)}
        onFocus={() => onMarkHover?.(t.n)}
        onBlur={() => onMarkHover?.(null)}
      >
        <sup className={styles.markNum}>{t.n}</sup>{t.text}
      </mark>
    );
  });
}

/** Structured transcript: speaker-labelled turns, readback comparison. */
export function StructuredTranscript({
  segments, enrichment, showReadback = true, rawTranscript, borderColor, assessableConfidence,
  excerptMarks = [], activeMark = null, onMarkHover,
}: {
  segments?: import("../../lib/types").SpeakerSegment[];
  enrichment: Enrichment | null | undefined;
  showReadback?: boolean;
  rawTranscript: string;
  borderColor: string;
  assessableConfidence?: number;
  excerptMarks?: ExcerptMark[];
  activeMark?: number | null;
  onMarkHover?: (n: number | null) => void;
}) {
  const segs = segments ?? enrichment?.speaker_segments;
  const hasStructure = segs && segs.length > 0 && segs.some(s => s.role !== "UNKNOWN");

  if (!hasStructure) {
    const blocks: TextBlock[] = [{ blockId: "raw", text: rawTranscript }];
    const allocations = resolveExcerptMarks(blocks, excerptMarks);
    return (
      <div className={styles.rawTranscript}>
        {renderTokens(rawTranscript, allocations, activeMark, onMarkHover)}
      </div>
    );
  }

  const blocks: TextBlock[] = segs!.map((s, i) => ({ blockId: `seg-${i}`, text: s.text }));
  const allocations = resolveExcerptMarks(blocks, excerptMarks);

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
          {seg.callsign && <span className={styles.segCallsign}>{seg.callsign}</span>}
          <span className={styles.segText}>
            {renderTokens(seg.text, allocations.filter(a => a.blockId === `seg-${i}`), activeMark, onMarkHover)}
          </span>
        </div>
      ))}

      {/* Readback comparison block */}
      {showReadback && enrichment?.readback_correct === false && enrichment.readback_discrepancy && (() => {
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
