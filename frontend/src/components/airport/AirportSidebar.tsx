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
import type { RawAircraft } from "../../lib/adsb";
import type { AnalysisResult } from "../../lib/types";

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
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CAT_COLOR: Record<string, string> = {
  VFR: "#3fb950", MVFR: "#44aaff", IFR: "#ff8800", LIFR: "#ff4444",
};

// ── Main component ────────────────────────────────────────────────────────────

export function AirportSidebar({ airportCode, onClose, results = [] }: Props) {
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
  const activeRwy = activeRunway(metar?.wdir ?? null, feed?.runways ?? []);

  const catColor  = metar?.fltCat ? (CAT_COLOR[metar.fltCat] ?? "#8b949e") : "#484f58";
  const catLabel  = metar?.fltCat ? (CAT_LABEL[metar.fltCat] ?? metar.fltCat) : null;
  const ceiling   = metar ? deriveCeiling(metar.clouds) : null;
  const ceilStr   = ceiling !== null ? `${ceiling.toLocaleString()} ft` : (metar ? "CAVOK" : "—");
  const windStr   = (() => {
    if (!metar) return "—";
    const dir = metar.wdir !== null ? `${String(metar.wdir).padStart(3, "0")}°` : "VRB";
    const spd = metar.wspd !== null ? `${metar.wspd} kt` : "";
    const gst = metar.wgst !== null ? ` G${metar.wgst} kt` : "";
    return `${dir} / ${spd}${gst}`;
  })();
  const visStr    = metar?.visib != null ? `${metar.visib} SM` : "—";
  const altimStr  = metar?.altim != null ? `${hpaToInhg(metar.altim)} inHg` : "—";
  const tempStr   = metar ? `${metar.temp ?? "—"} °C / ${metar.dewp ?? "—"} °C` : "—";

  const adsbAge = adsb.dataUpdatedAt ? Math.round((Date.now() - adsb.dataUpdatedAt) / 1000) : null;
  const ageLabel  = adsbAge == null ? "" : adsbAge < 10 ? "Live" : adsbAge < 120 ? `${adsbAge}s ago` : `${Math.round(adsbAge / 60)}m ago`;
  const airborne    = aircraft.filter(a => a.phase !== "gnd").length;
  const onGround    = aircraft.filter(a => a.phase === "gnd").length;
  const monitoredCt = aircraft.filter(a => a.monitored).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0d1117", borderLeft: "1px solid #21262d", overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", flexShrink: 0, background: "#161b22", borderBottom: "1px solid #21262d" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#e6edf3", letterSpacing: 0.3 }}>{airportCode}</span>
          {metar?.fltCat && (
            <span title={catLabel ?? undefined} style={{ fontSize: 10, fontWeight: 700, color: catColor, background: catColor + "22", border: `1px solid ${catColor}55`, borderRadius: 4, padding: "1px 7px" }}>
              {metar.fltCat}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onClose} style={{ background: "none", border: "1px solid #30363d", color: "#6e7681", cursor: "pointer", fontSize: 12, padding: "2px 8px", borderRadius: 4, lineHeight: 1 }}>✕</button>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: "auto" }}>

        {/* ── Airport Scope / Live Map ── */}
        <div style={{ borderBottom: "1px solid #21262d" }}>
          <button
            onClick={() => setScopeOpen(v => !v)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 16px", background: "none", border: "none", cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#484f58", letterSpacing: 1.3, textTransform: "uppercase" as const }}>
                Live Traffic Map
              </span>
              {aircraft.length > 0 && (
                <span style={{ fontSize: 9, color: "#8b949e", fontFamily: "monospace" }}>
                  {monitoredCt > 0 && <span style={{ color: "#e3b341" }}>{monitoredCt} monitored · </span>}
                  {airborne} airborne{onGround > 0 ? ` · ${onGround} gnd` : ""}
                </span>
              )}
            </div>
            <span style={{ fontSize: 10, color: "#3a3f47" }}>{scopeOpen ? "▲" : "▼"}</span>
          </button>

          {scopeOpen && geo && (
            <div style={{ padding: "0 16px 14px" }}>

              {/* Info bar */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8, flexWrap: "wrap" as const }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const }}>
                  {activeRwy && (
                    <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, color: "#3fb950", background: "#3fb95018", border: "1px solid #3fb95044", borderRadius: 3, padding: "2px 7px" }}>
                      ACTIVE RWY {activeRwy}
                    </span>
                  )}
                  <span style={{ fontSize: 9, color: "#484f58", fontFamily: "monospace" }}>
                    OSM · scroll/pinch to zoom
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {adsbAge != null && (
                    <span style={{ fontSize: 9, fontFamily: "monospace", color: adsbAge < 15 ? "#3fb950" : adsbAge < 90 ? "#e3b341" : "#ff8800" }}>
                      ADS-B {ageLabel}
                    </span>
                  )}
                  <button
                    onClick={() => adsb.refetch()}
                    style={{ background: "none", border: "1px solid #30363d", color: "#6e7681", cursor: "pointer", fontSize: 11, padding: "1px 6px", borderRadius: 3 }}
                  >
                    ↻
                  </button>
                </div>
              </div>

              <AirportMap
                aircraft={aircraft}
                hoveredId={hoveredId}
                onHover={setHoveredId}
                apLat={geo[0]}
                apLon={geo[1]}
                airportCode={airportCode}
                mapHeight={mapHeight}
              />

              {/* Drag-to-resize handle */}
              <div
                onMouseDown={e => { dragRef.current = { startY: e.clientY, startH: mapHeight }; e.preventDefault(); }}
                style={{
                  height: 6, marginTop: 4, borderRadius: 3,
                  background: "#1c2128", cursor: "ns-resize",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <div style={{ width: 24, height: 2, borderRadius: 1, background: "#30363d" }} />
              </div>

              <AircraftList
                aircraft={aircraft}
                hoveredId={hoveredId}
                onHover={setHoveredId}
              />
            </div>
          )}

          {scopeOpen && !geo && (
            <div style={{ padding: "0 16px 14px" }}>
              <p style={{ fontSize: 11, color: "#484f58", fontStyle: "italic" }}>No coordinates for {airportCode}</p>
            </div>
          )}
        </div>

        {/* ── Weather · METAR ── */}
        <div style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#484f58", letterSpacing: 1.3, textTransform: "uppercase" as const, marginBottom: 10 }}>Weather · METAR</div>
          {loading && <p style={{ fontSize: 12, color: "#484f58", fontStyle: "italic" }}>Fetching METAR…</p>}
          {error && !loading && <p style={{ fontSize: 12, color: "#ff4444" }}>Failed to load METAR for {airportCode}</p>}
          {metar && !loading && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: catColor + "18", border: `1px solid ${catColor}44`, borderRadius: 6, padding: "7px 10px", marginBottom: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: catColor, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: catColor }}>{metar.fltCat}</span>
                <span style={{ fontSize: 11, color: "#6e7681" }}>{catLabel}</span>
                {metar.wxString && <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 600, color: "#e3b341", background: "#e3b34122", border: "1px solid #e3b34144", borderRadius: 4, padding: "1px 6px" }}>{metar.wxString}</span>}
                {metar.wdir !== null && <div style={{ marginLeft: "auto" }}><WindArrow deg={metar.wdir} size={28} /></div>}
              </div>
              <DataRow label="Wind"       value={windStr} />
              <DataRow label="Visibility" value={visStr}  warn={metar.visib != null && metar.visib < 3} />
              <DataRow label="Ceiling"    value={ceilStr} warn={ceiling !== null && ceiling < 1000} />
              <DataRow label="Temp / Dew" value={tempStr} />
              <DataRow label="Altimeter"  value={altimStr} />
              <div style={{ marginTop: 10, background: "#161b22", border: "1px solid #21262d", borderRadius: 6, padding: "8px 10px", fontSize: 10, fontFamily: "'SF Mono','Fira Code',monospace", color: "#484f58", lineHeight: 1.7, wordBreak: "break-all" as const }}>
                {metar.rawOb}
              </div>
            </>
          )}
        </div>

        {/* ── NOTAMs ── */}
        <div style={{ borderTop: "1px solid #21262d", padding: "14px 16px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#484f58", letterSpacing: 1.3, textTransform: "uppercase" as const, marginBottom: 8 }}>
            Active NOTAMs
            {notams.length > 0 && (
              <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: notams.some((n: any) => n.critical) ? "#ff4444" : "#e3b341", background: notams.some((n: any) => n.critical) ? "#ff444418" : "#e3b34118", border: `1px solid ${notams.some((n: any) => n.critical) ? "#ff444444" : "#e3b34144"}`, borderRadius: 3, padding: "1px 5px" }}>{notams.length}</span>
            )}
          </div>
          {notams.length === 0
            ? <p style={{ fontSize: 11, color: "#484f58", fontStyle: "italic", margin: 0 }}>No active NOTAMs</p>
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {notams.slice(0, 8).map((n: any, i: number) => {
                  const color = n.critical ? "#ff4444" : n.keyword === "TWY" ? "#ff8800" : n.keyword === "NAVAID" ? "#e3b341" : "#8b949e";
                  return (
                    <div key={i} style={{ background: color + "0d", border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`, borderRadius: "0 6px 6px 0", padding: "7px 10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color, background: color + "22", borderRadius: 3, padding: "1px 5px" }}>{n.keyword}</span>
                        <span style={{ fontSize: 9, fontFamily: "monospace", color: "#484f58" }}>{n.id}</span>
                      </div>
                      <p style={{ fontSize: 10, color: "#c9d1d9", margin: 0, lineHeight: 1.6, fontFamily: "'SF Mono','Fira Code',monospace", whiteSpace: "pre-wrap" as const, maxHeight: 60, overflow: "hidden" }}>{n.body}</p>
                    </div>
                  );
                })}
                {notams.length > 8 && <p style={{ fontSize: 10, color: "#484f58", margin: 0 }}>+{notams.length - 8} more NOTAMs</p>}
              </div>
            )
          }
        </div>

        <AirportAnalytics results={airportResults} />
      </div>
    </div>
  );
}
