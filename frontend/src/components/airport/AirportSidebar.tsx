import React, { useEffect, useRef, useState, useMemo } from "react";
import { useWindowWidth } from "../../hooks/useWindowWidth";
import { useSettings } from "../../SettingsContext";
import { AirportAnalytics } from "./AirportAnalytics";
import { AircraftList } from "./AircraftList";
import { AirportMap } from "./AirportMap";
import { DataRow } from "./DataRow";
import { WindArrow } from "./WindArrow";
import { useAdsb, useMetar, useNotam } from "../../lib/queries";
import {
  buildMonitorIndex, processAdsb,
  activeRunway, deriveCeiling, hpaToInhg, CAT_LABEL,
} from "../../lib/adsb";
import { normalizeCallsign } from "../../lib/callsign";
import type { RawAircraft } from "../../lib/adsb";
import type { AnalysisResult } from "../../lib/types";
import styles from "./AirportSidebar.module.css";

// ── Types ────────────────────────────────────────────────────────────────────

interface MetarData {
  icaoId:   string;
  rawOb:    string;
  wdir:     number | null;
  wspd:     number | null;
  wgst:     number | null;
  visib:    number | null;
  altim:    number | null;
  temp:     number | null;
  dewp:     number | null;
  fltCat:   string | null;
  wxString: string | null;
  clouds:   { cover: string; base: number }[] | null;
  error?:   string;
}

interface Props {
  airportCode: string;
  onClose:     () => void;
  results?:    AnalysisResult[];
  selectedAircraft?: { icao24: string | null; callsign: string | null } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return a CSS var() string for a flight category colour.
 * Exact hex parity: VFR (--sev-standard), MVFR (--sev-low), IFR (--sev-high), LIFR (--sev-critical),
 * unknown (--text-dim), no-data (--text-faint).
 */
function catColorVar(fltCat: string | null | undefined): string {
  if (!fltCat) return "var(--text-faint)";  // no-data
  switch (fltCat) {
    case "VFR":  return "var(--sev-standard)";  // VFR
    case "MVFR": return "var(--sev-low)";        // MVFR
    case "IFR":  return "var(--sev-high)";       // IFR
    case "LIFR": return "var(--sev-critical)";   // LIFR
    default:     return "var(--text-dim)";        // unknown
  }
}

/**
 * Return a CSS var() string for a NOTAM card/chip colour.
 * Exact hex parity: critical (--sev-critical), TWY (--sev-high), NAVAID (--sev-medium), else (--text-dim).
 */
function notamColorVar(n: { critical?: boolean; keyword?: string }): string {
  if (n.critical)              return "var(--sev-critical)";  // critical
  if (n.keyword === "TWY")     return "var(--sev-high)";      // TWY
  if (n.keyword === "NAVAID")  return "var(--sev-medium)";    // NAVAID
  return "var(--text-dim)";                                    // else
}

// ── Main component ────────────────────────────────────────────────────────────

export function AirportSidebar({ airportCode, onClose, results = [], selectedAircraft }: Props) {
  const { bp }  = useWindowWidth();
  const { settings } = useSettings();
  const isSmall = bp === "mobile" || bp === "tablet";
  const feed = useMemo(
    () => (settings?.feeds ?? []).find(f => f.airport_code === airportCode),
    [settings, airportCode],
  );
  const geo: [number, number] | null = useMemo(
    () => feed && feed.lat != null && feed.lon != null ? [feed.lat, feed.lon] : null,
    [feed],
  );

  const [scopeOpen, setScopeOpen] = useState(!isSmall);
  // Resizable map height (drag handle)
  const [mapHeight, setMapHeight] = useState(280);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const airportResults = useMemo(
    () => results.filter(r => r.airport_code === airportCode),
    [results, airportCode],
  );
  const metarQuery = useMetar(airportCode);
  const notamQuery = useNotam(airportCode);
  const adsb = useAdsb(geo ? airportCode : "", 60_000);

  useEffect(() => {
    const t = setInterval(() => forceTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Drag-to-resize handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = e.clientY - dragRef.current.startY;
      setMapHeight(Math.max(160, Math.min(560, dragRef.current.startH + delta)));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // Derived
  const monitorIdx  = useMemo(
    () => buildMonitorIndex(results, airportCode),
    [results, airportCode],
  );
  const metarData = metarQuery.data as MetarData | undefined;
  const metar = metarData && !metarData.error ? metarData : null;
  const loading = metarQuery.isLoading;
  const error = metarData?.error ?? (metarQuery.error ? String((metarQuery.error as Error).message) : null);
  const rawAdsb = (adsb.data?.aircraft ?? []) as RawAircraft[];
  const notams = notamQuery.data?.notams ?? [];
  const aircraft = useMemo(
    () => (geo ? processAdsb(rawAdsb, geo[0], geo[1], monitorIdx) : []),
    [rawAdsb, geo, monitorIdx],
  );
  const selectedId = useMemo(() => {
    if (!selectedAircraft) return null;
    const key = normalizeCallsign(selectedAircraft.callsign);
    const hit = key ? aircraft.find(a => normalizeCallsign(a.callsign) === key) : undefined;
    if (hit) return hit.id;
    return selectedAircraft.icao24 ?? null;
  }, [selectedAircraft, aircraft]);
  const activeRwy = activeRunway(metar?.wdir ?? null, feed?.runways ?? []);

  const catVar   = catColorVar(metar?.fltCat);
  const catLabel = metar?.fltCat ? (CAT_LABEL[metar.fltCat] ?? metar.fltCat) : null;
  const ceiling  = metar ? deriveCeiling(metar.clouds) : null;
  const ceilStr  = ceiling !== null ? `${ceiling.toLocaleString()} ft` : (metar ? "CAVOK" : "—");
  const windStr  = (() => {
    if (!metar) return "—";
    const dir = metar.wdir !== null ? `${String(metar.wdir).padStart(3, "0")}°` : "VRB";
    const spd = metar.wspd !== null ? `${metar.wspd} kt` : "";
    const gst = metar.wgst !== null ? ` G${metar.wgst} kt` : "";
    return `${dir} / ${spd}${gst}`;
  })();
  const visStr   = metar?.visib != null ? `${metar.visib} SM` : "—";
  const altimStr = metar?.altim != null ? `${hpaToInhg(metar.altim)} inHg` : "—";
  const tempStr  = metar ? `${metar.temp ?? "—"} °C / ${metar.dewp ?? "—"} °C` : "—";

  const adsbAge  = adsb.dataUpdatedAt ? Math.round((Date.now() - adsb.dataUpdatedAt) / 1000) : null;
  const ageLabel = adsbAge == null ? "" : adsbAge < 10 ? "Live" : adsbAge < 120 ? `${adsbAge}s ago` : `${Math.round(adsbAge / 60)}m ago`;
  const airborne    = aircraft.filter(a => a.phase !== "gnd").length;
  const onGround    = aircraft.filter(a => a.phase === "gnd").length;
  const monitoredCt = aircraft.filter(a => a.monitored).length;

  const hasCriticalNotam = notams.some((n: any) => n.critical);
  const notamChipVar     = hasCriticalNotam ? "var(--sev-critical)" : "var(--sev-medium)";

  const adsbAgeClass = adsbAge == null ? ""
    : adsbAge < 15  ? styles.adsbAgeLive
    : adsbAge < 90  ? styles.adsbAgeOk
    :                 styles.adsbAgeStale;

  return (
    <div className={styles.root}>

      {/* ── Header ── */}
      <div className={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={styles.airportCode}>{airportCode}</span>
          {metar?.fltCat && (
            <span
              title={catLabel ?? undefined}
              className={styles.catChip}
              style={{ ["--cat-clr" as any]: catVar }}
            >
              {metar.fltCat}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onClose} className={styles.closeBtn}>✕</button>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className={styles.body}>

        {/* ── Airport Scope / Live Map ── */}
        <div className={styles.scopeSection}>
          <button
            onClick={() => setScopeOpen(v => !v)}
            className={styles.scopeToggle}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={styles.scopeTitle}>Live Traffic Map</span>
              {aircraft.length > 0 && (
                <span className={styles.scopeMeta}>
                  {monitoredCt > 0 && (
                    <span className={styles.scopeMonCount}>{monitoredCt} monitored · </span>
                  )}
                  {airborne} airborne{onGround > 0 ? ` · ${onGround} gnd` : ""}
                </span>
              )}
            </div>
            <span className={styles.scopeChevron}>{scopeOpen ? "▲" : "▼"}</span>
          </button>

          {scopeOpen && geo && (
            <div className={styles.scopeBody}>

              {/* Info bar */}
              <div className={styles.infoBar}>
                <div className={styles.infoLeft}>
                  {activeRwy && (
                    <span className={styles.activeRwyBadge}>
                      ACTIVE RWY {activeRwy}
                    </span>
                  )}
                  <span className={styles.infoHint}>OSM · scroll/pinch to zoom</span>
                </div>
                <div className={styles.infoRight}>
                  {adsbAge != null && (
                    <span className={adsbAgeClass}>ADS-B {ageLabel}</span>
                  )}
                  <button onClick={() => adsb.refetch()} className={styles.refetchBtn}>↻</button>
                </div>
              </div>

              <AirportMap
                aircraft={aircraft}
                hoveredId={hoveredId}
                selectedId={selectedId}
                onHover={setHoveredId}
                apLat={geo[0]}
                apLon={geo[1]}
                mapHeight={mapHeight}
              />

              {/* Drag-to-resize handle */}
              <div
                onMouseDown={e => { dragRef.current = { startY: e.clientY, startH: mapHeight }; e.preventDefault(); }}
                className={styles.dragHandle}
              >
                <div className={styles.dragPip} />
              </div>

              <AircraftList
                aircraft={aircraft}
                hoveredId={hoveredId}
                onHover={setHoveredId}
              />
            </div>
          )}

          {scopeOpen && !geo && (
            <p className={styles.noGeo}>No coordinates for {airportCode}</p>
          )}
        </div>

        {/* ── Weather · METAR ── */}
        <div className={styles.weatherSection}>
          <div className={styles.sectionTitle}>Weather · METAR</div>
          {loading && <p className={styles.loadingText}>Fetching METAR…</p>}
          {error && !loading && <p className={styles.errorText}>Failed to load METAR for {airportCode}</p>}
          {metar && !loading && (
            <>
              <div
                className={styles.catBanner}
                style={{ ["--cat-clr" as any]: catVar }}
              >
                <div className={styles.catDot} />
                <span className={styles.catName}>{metar.fltCat}</span>
                <span className={styles.catDesc}>{catLabel}</span>
                {metar.wxString && (
                  <span className={styles.wxPill}>{metar.wxString}</span>
                )}
                {metar.wdir !== null && (
                  <div style={{ marginLeft: "auto" }}>
                    <WindArrow deg={metar.wdir} size={28} />
                  </div>
                )}
              </div>
              <DataRow label="Wind"       value={windStr} />
              <DataRow label="Visibility" value={visStr}  warn={metar.visib != null && metar.visib < 3} />
              <DataRow label="Ceiling"    value={ceilStr} warn={ceiling !== null && ceiling < 1000} />
              <DataRow label="Temp / Dew" value={tempStr} />
              <DataRow label="Altimeter"  value={altimStr} />
              <div className={styles.rawOb}>{metar.rawOb}</div>
            </>
          )}
        </div>

        {/* ── NOTAMs ── */}
        <div className={styles.notamSection}>
          <div className={styles.notamTitle}>
            Active NOTAMs
            {notams.length > 0 && (
              <span
                className={styles.notamCountChip}
                style={{ ["--notam-clr" as any]: notamChipVar }}
              >
                {notams.length}
              </span>
            )}
          </div>
          {notams.length === 0
            ? <p className={styles.notamEmpty}>No active NOTAMs</p>
            : (
              <div className={styles.notamList}>
                {notams.slice(0, 8).map((n: any, i: number) => {
                  const nVar = notamColorVar(n);
                  return (
                    <div
                      key={i}
                      className={styles.notamCard}
                      style={{ ["--notam-clr" as any]: nVar }}
                    >
                      <div className={styles.notamCardHead}>
                        <span className={styles.notamKeyword}>{n.keyword}</span>
                        <span className={styles.notamId}>{n.id}</span>
                      </div>
                      <p className={styles.notamBody}>{n.body}</p>
                    </div>
                  );
                })}
                {notams.length > 8 && (
                  <p className={styles.notamMore}>+{notams.length - 8} more NOTAMs</p>
                )}
              </div>
            )
          }
        </div>

        <AirportAnalytics results={airportResults} />
      </div>
    </div>
  );
}
