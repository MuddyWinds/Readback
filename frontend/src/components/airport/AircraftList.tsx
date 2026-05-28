import React from "react";
import type { AircraftInfo } from "../../lib/adsb";
import { PHASE_LABEL } from "../../lib/adsb";
import styles from "./AircraftList.module.css";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return the CSS var string for the phraseology compliance colour of a
 * monitored aircraft.  Tokens map to the same hex as the original literals.
 */
function monitoredColorVar(ac: AircraftInfo): string {
  if (ac.standard === false) return "var(--sev-critical)";  // #ff4444
  if (ac.standard === true)  return "var(--sev-standard)";  // #3fb950
  return "var(--sev-medium)";                                // #e3b341 (unassessed)
}

/**
 * Return the CSS var string for a flight phase.
 */
function phaseColorVar(phase: AircraftInfo["phase"]): string {
  switch (phase) {
    case "arr": return "var(--sev-low)";      // #44aaff
    case "dep": return "var(--sev-standard)"; // #3fb950
    case "gnd": return "var(--sev-medium)";   // #e3b341
    case "enr": return "var(--phase-enr)";    // #6e7681
  }
}

// ── Sub-component ─────────────────────────────────────────────────────────────

interface MonitoredRowProps {
  ac:        AircraftInfo;
  hoveredId: string | null;
  onHover:   (id: string | null) => void;
}

function MonitoredRow({ ac, hoveredId, onHover }: MonitoredRowProps) {
  const compVar  = monitoredColorVar(ac);
  const phaseVar = phaseColorVar(ac.phase);
  const isHov    = ac.id === hoveredId;

  const altStr = ac.altFt != null
    ? (ac.altFt >= 18000 ? `FL${Math.round(ac.altFt / 100)}` : `${ac.altFt.toLocaleString()}ft`)
    : (ac.onGround ? "GND" : "—");

  const compLabel = ac.standard === false ? "NON-STANDARD"
    : ac.standard === true ? "STANDARD" : "UNASSESSED";

  // lastEvent colour: non-standard → --sev-high (#ff8800), otherwise --text-ghost (#6e7681)
  const lastEventColorVar = ac.standard === false ? "var(--sev-high)" : "var(--text-ghost)";

  return (
    <div
      onMouseEnter={() => onHover(ac.id)}
      onMouseLeave={() => onHover(null)}
      className={styles.monRow}
      style={{
        border:     `1px solid ${isHov ? `color-mix(in srgb, ${compVar} 33.3333%, transparent)` : "var(--drag-handle-bg)"}`,
        background: isHov ? `color-mix(in srgb, ${compVar} 5.8824%, transparent)` : "var(--bg)",
      }}
    >
      {/* Row 1: callsign + phase + compliance badge */}
      <div className={styles.monRow1}>
        <div className={styles.dot} style={{ background: compVar }} />
        <span className={styles.callsign}>{ac.callsign}</span>
        {/* Phase pill */}
        <span
          className={styles.phasePill}
          style={{
            color:      phaseVar,
            background: `color-mix(in srgb, ${phaseVar} 13.3333%, transparent)`,
            border:     `1px solid color-mix(in srgb, ${phaseVar} 26.6667%, transparent)`,
          }}
        >
          {PHASE_LABEL[ac.phase]}
        </span>
        {/* Compliance badge */}
        <span
          className={styles.compBadge}
          style={{
            color:      compVar,
            background: `color-mix(in srgb, ${compVar} 9.4118%, transparent)`,
            border:     `1px solid color-mix(in srgb, ${compVar} 26.6667%, transparent)`,
          }}
        >
          {compLabel}
        </span>
      </div>
      {/* Row 2: last event + position data */}
      <div className={styles.monRow2}>
        {ac.lastEvent && (
          <span
            className={styles.lastEvent}
            style={{ color: lastEventColorVar }}
          >
            {ac.lastEvent}
          </span>
        )}
        <span className={styles.posData}>
          {altStr}{ac.speedKt != null ? ` · ${ac.speedKt}kt` : ""} · {ac.distNm.toFixed(1)}nm
        </span>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface Props {
  aircraft:  AircraftInfo[];
  hoveredId: string | null;
  onHover:   (id: string | null) => void;
}

export function AircraftList({ aircraft, hoveredId, onHover }: Props) {
  if (aircraft.length === 0) {
    return (
      <p className={styles.noData}>
        No aircraft data — OpenSky may be rate-limiting
      </p>
    );
  }

  const monitored  = aircraft.filter(a => a.monitored);
  const background = aircraft.filter(a => !a.monitored);

  return (
    <div style={{ marginTop: 10 }}>
      {/* Monitored aircraft */}
      {monitored.length > 0 && (
        <>
          <div className={styles.sectionLabel}>
            Monitored ({monitored.length})
          </div>
          {monitored.map(ac => (
            <MonitoredRow key={ac.id} ac={ac} hoveredId={hoveredId} onHover={onHover} />
          ))}
        </>
      )}

      {monitored.length === 0 && (
        <p className={styles.noMonitored}>
          No monitored callsigns currently in range
        </p>
      )}

      {/* Background traffic — count only, no clutter */}
      {background.length > 0 && (
        <div className={styles.bgBar}>
          <div className={styles.bgCounts}>
            {(["arr", "dep", "gnd", "enr"] as const).map(p => {
              const n = background.filter(a => a.phase === p).length;
              if (n === 0) return null;
              return (
                <span
                  key={p}
                  className={`${styles.bgCount} ${styles[`phase-${p}`]}`}
                >
                  {n} {PHASE_LABEL[p]}
                </span>
              );
            })}
          </div>
          <span className={styles.bgLabel}>background traffic</span>
        </div>
      )}
    </div>
  );
}
