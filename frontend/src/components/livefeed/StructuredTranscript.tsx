import React from "react";
import type { Enrichment } from "../../lib/types";
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
    const label = t.label ?? String(t.n);
    return (
      <mark
        key={i}
        className={`${styles.mark} ${isActive ? styles.markActive : ""}`}
        tabIndex={0}
        aria-label={`Finding ${label} reference`}
        onMouseEnter={() => onMarkHover?.(t.n)}
        onMouseLeave={() => onMarkHover?.(null)}
        onFocus={() => onMarkHover?.(t.n)}
        onBlur={() => onMarkHover?.(null)}
      >
        <sup className={styles.markNum}>{label}</sup>{t.text}
      </mark>
    );
  });
}

/** Structured transcript: speaker-labelled turns, readback comparison. */
export function StructuredTranscript({
  segments, enrichment, rawTranscript, borderColor,
  excerptMarks = [], activeMark = null, onMarkHover,
}: {
  segments?: import("../../lib/types").SpeakerSegment[];
  enrichment: Enrichment | null | undefined;
  rawTranscript: string;
  borderColor: string;
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

    </div>
  );
}
