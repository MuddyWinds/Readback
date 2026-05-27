import React from "react";
import { useSettings } from "../../SettingsContext";
import type { AnalysisResult } from "../../lib/types";
import { useAdsb, useAdsbSnapshot } from "../../lib/queries";
import { detectConflicts, AdsbAircraft } from "../../lib/conflicts";
import styles from "./PositionSnapshot.module.css";

// Workload color token — 4 tiers mapped to existing theme tokens (no hex)
function workloadToken(airborneCount: number): string {
  if (airborneCount >= 15) return "--sev-critical";
  if (airborneCount >= 10) return "--sev-high";
  if (airborneCount >= 5)  return "--sev-medium";
  return "--sev-standard";
}

function workloadLabel(airborneCount: number): string {
  if (airborneCount >= 15) return "Very high";
  if (airborneCount >= 10) return "High";
  if (airborneCount >= 5)  return "Moderate";
  return "Low";
}

// ─── ADS-B position snapshot — fetches live data per-airport ──────────────────
export function PositionSnapshot({
  r, callsign, confidence, borderColor,
}: { r: AnalysisResult; callsign: string | null; confidence: "high" | "low"; borderColor: string }) {
  const { geo } = useSettings();
  const snapshot = useAdsbSnapshot(r.id);
  const snapshotData = snapshot.data;
  const shouldFetchLive =
    !r.id || snapshot.isError || Boolean(snapshotData?.error) || (snapshot.isSuccess && !snapshotData?.aircraft);
  const live = useAdsb(shouldFetchLive ? r.airport_code : "");
  const aircraft = (shouldFetchLive ? live.data?.aircraft : snapshotData?.aircraft) as AdsbAircraft[] | null | undefined;
  const loading = (r.id && snapshot.isLoading) || (shouldFetchLive && live.isLoading);
  const err = shouldFetchLive && live.isError ? "Could not fetch ADS-B data" : null;
  const dataSource: "snapshot" | "live" | null = aircraft
    ? (shouldFetchLive ? "live" : "snapshot")
    : null;

  const matched = aircraft?.find(a =>
    callsign && a.callsign && a.callsign.replace(/\s/g, "") === callsign.replace(/\s/g, "")
  ) ?? null;

  // Derive human-readable flight phase from ADS-B state
  const flightPhase = (a: AdsbAircraft): { label: string; detail: string } => {
    const altFt = a.altitude_m != null ? Math.round(a.altitude_m * 3.281) : null;
    const spdKt = a.velocity_ms != null ? Math.round(a.velocity_ms * 1.944) : null;
    const hdg   = a.heading != null ? Math.round(a.heading) : null;
    if (a.on_ground) return { label: "On ground", detail: `Taxiing · ${spdKt != null ? spdKt + " kt" : "—"}` };
    if (altFt == null) return { label: "Airborne", detail: "Altitude unknown" };
    if (altFt < 1000)  return { label: "Final approach / low-level", detail: `${altFt.toLocaleString()} ft · ${spdKt ?? "—"} kt` };
    if (altFt < 5000)  return { label: "Approach / departure", detail: `${altFt.toLocaleString()} ft · ${spdKt ?? "—"} kt · HDG ${hdg ?? "—"}°` };
    if (altFt < 18000) return { label: "Climb / descent", detail: `${altFt.toLocaleString()} ft · ${spdKt ?? "—"} kt` };
    return { label: "En-route", detail: `FL${Math.round(altFt / 100)} · ${spdKt ?? "—"} kt` };
  };

  const distNmFromAirport = (a: AdsbAircraft): number | null => {
    const g = geo[r.airport_code];
    if (!g || a.latitude == null || a.longitude == null) return null;
    const dlat = (a.latitude - g[0]) * 60;
    const dlon = (a.longitude - g[1]) * 60 * Math.cos(g[0] * Math.PI / 180);
    return Math.round(Math.sqrt(dlat*dlat + dlon*dlon) * 10) / 10;
  };

  const fmtAlt = (m: number | null) => m != null ? `${Math.round(m * 3.281).toLocaleString()} ft` : "—";
  const fmtSpd = (ms: number | null) => ms != null ? `${Math.round(ms * 1.944)} kt` : "—";

  return (
    <div
      className={styles.container}
      style={{ ["--ps-border" as any]: borderColor }}
    >
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>Traffic Context</span>
        {callsign ? (
          <span className={styles.callsignBadge}>{callsign}</span>
        ) : (
          <span className={styles.callsignUnclear}>callsign unclear</span>
        )}
        {callsign && confidence === "low" && (
          <span className={styles.phoneticMatch}>⚠ phonetic match</span>
        )}
        {dataSource && (
          <span className={dataSource === "snapshot" ? styles.dataSourceSnapshot : styles.dataSourceLive}>
            {dataSource === "snapshot" ? "⏱ at transmission time" : "⚡ current"}
          </span>
        )}
        <span className={styles.timestamp}>
          {new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z").toISOString().slice(11, 19)}Z
        </span>
      </div>

      {loading && <p className={styles.loadingText}>Fetching ADS-B…</p>}
      {err    && <p className={styles.errText}>{err}</p>}

      {!loading && !err && aircraft && (() => {
        const airborne  = aircraft.filter(a => !a.on_ground);
        const conflicts = detectConflicts(aircraft);
        const wlToken   = workloadToken(airborne.length);
        const wlLabel   = workloadLabel(airborne.length);

        return (
          <div className={styles.body}>
            {/* ── Subject aircraft state ── */}
            {matched ? (
              <div className={styles.aircraftBox}>
                <div className={styles.aircraftPhaseRow}>
                  <span className={styles.aircraftPhaseLabel}>{flightPhase(matched).label}</span>
                  <span className={styles.aircraftPhaseDetail}>{flightPhase(matched).detail}</span>
                </div>
                <div className={styles.aircraftStats}>
                  {[
                    ["Altitude",  fmtAlt(matched.altitude_m)],
                    ["Speed",     fmtSpd(matched.velocity_ms)],
                    ["Heading",   matched.heading != null ? `${Math.round(matched.heading)}°` : "—"],
                    ["Squawk",    matched.squawk ?? "—"],
                    ["Dist from apt", distNmFromAirport(matched) != null ? `${distNmFromAirport(matched)} nm` : "—"],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div className={styles.statLabel}>{label}</div>
                      <div className={styles.statValue}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : callsign ? (
              <p className={styles.notFoundText}>
                {callsign} not found in ADS-B data — may have landed, departed, or transponder ID differs.
              </p>
            ) : (
              <p className={styles.notFoundText}>
                No callsign identified. Cannot correlate with ADS-B.
              </p>
            )}

            {/* ── Sector load — mitigating factor context ── */}
            {airborne.length > 0 && (
              <div
                className={styles.workloadRow}
                style={{ ["--wl-color" as any]: `var(${wlToken})` }}
              >
                <div className={styles.workloadDot} />
                <span className={styles.workloadPrefix}>Sector load:</span>
                <span className={styles.workloadValue}>{wlLabel}</span>
                <span className={styles.workloadCounts}>
                  ({airborne.length} airborne · {aircraft.filter(a => a.on_ground).length} ground)
                </span>
                {airborne.length >= 10 && (
                  <span className={styles.workloadNote}>— potential mitigating factor</span>
                )}
              </div>
            )}

            {/* ── Separation alerts ── */}
            {conflicts.map((c, i) => {
              const isSepLoss = c.level === "SEPARATION LOSS";
              return (
                <div
                  key={i}
                  className={`${styles.conflictRow} ${isSepLoss ? styles.conflictSepLoss : styles.conflictProxAlert}`}
                >
                  <span className={isSepLoss ? styles.conflictLevelSepLoss : styles.conflictLevelProx}>
                    {c.level}
                  </span>
                  <span className={styles.conflictCallsigns}>{c.callA} ↔ {c.callB}</span>
                  <span className={styles.conflictDist}>
                    {c.distNm.toFixed(1)} nm · Δ{Math.round(c.altDiffFt)} ft
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
