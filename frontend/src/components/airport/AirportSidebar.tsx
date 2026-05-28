import React, { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useWindowWidth } from "../../hooks/useWindowWidth";
import { useSettings } from "../../SettingsContext";
import { AirportAnalytics } from "./AirportAnalytics";
import { AircraftList } from "./AircraftList";
import { DataRow } from "./DataRow";
import { WindArrow } from "./WindArrow";
import { useAdsb, useMetar, useNotam } from "../../lib/queries";
import {
  buildMonitorIndex, processAdsb,
  activeRunway, deriveCeiling, hpaToInhg, CAT_LABEL, PHASE_LABEL,
} from "../../lib/adsb";
import type { AircraftInfo, RawAircraft } from "../../lib/adsb";
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

const PHASE_COLOR: Record<string, string> = {
  arr: "#44aaff", dep: "#3fb950", gnd: "#e3b341", enr: "#6e7681",
};

// Zoom levels: 9=regional 11=approach 13=airport layout 15=ground ops
const ZOOM_PRESETS = [
  { label: "Region", zoom: 9,  title: "~60nm — arrival/departure corridors" },
  { label: "Approach", zoom: 11, title: "~30nm — approach & hold patterns" },
  { label: "Airport", zoom: 13, title: "~8nm — runway layout visible" },
  { label: "Ground", zoom: 15, title: "~2nm — taxiway detail" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Phraseology-aware colour for monitored aircraft. */
function monitoredColor(ac: AircraftInfo): string {
  if (ac.standard === false) return "#ff4444"; // non-standard observation
  if (ac.standard === true)  return "#3fb950"; // standard
  return "#e3b341";                              // unassessed
}

/** Build an SVG-based Leaflet divIcon for an aircraft target. */
function makeAircraftIcon(ac: AircraftInfo, hovered: boolean): L.DivIcon {
  const isMonitored = ac.monitored;
  // Monitored: colour by phraseology status; background: dim grey
  const color = isMonitored ? monitoredColor(ac) : "#3a4048";
  const hdg   = ac.heading ?? 0;

  if (!isMonitored && !hovered) {
    // Background traffic: tiny featureless dot, no label
    const dot = `<div style="width:6px;height:6px;border-radius:50%;background:${color};opacity:0.5;margin:5px"></div>`;
    return L.divIcon({ html: dot, className: "", iconSize: [16, 16], iconAnchor: [8, 8] });
  }

  const sz    = hovered ? 12 : (isMonitored ? 10 : 7);
  const shape = ac.onGround
    ? `<rect x="${-sz*0.55}" y="${-sz*0.55}" width="${sz*1.1}" height="${sz*1.1}" fill="${color}" opacity="0.95"/>`
    : `<polygon points="0,${-sz} ${sz*0.6},${sz*0.5} 0,${sz*0.18} ${-sz*0.6},${sz*0.5}" fill="${color}" opacity="0.95"/>`;

  const vLen  = ac.speedKt != null ? Math.min(ac.speedKt * 0.04, 20) : 0;
  const vLine = (!ac.onGround && vLen > 0 && isMonitored)
    ? `<line x1="0" y1="${-sz}" x2="0" y2="${-sz - vLen}" stroke="${color}" stroke-width="1.2" opacity="0.4"/>`
    : "";

  // Ring around monitored aircraft
  const ring = isMonitored
    ? `<circle cx="0" cy="0" r="${sz + 3}" fill="none" stroke="${color}" stroke-width="${hovered ? 1.2 : 0.6}" opacity="0.35"/>`
    : "";

  const inner = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="-22 -36 44 56" width="44" height="56"
      style="transform:rotate(${hdg}deg);overflow:visible;display:block">
      ${vLine}${ring}${shape}
    </svg>`;

  // Label: monitored always visible; background only on hover
  const showLabel = isMonitored || hovered;
  const labelContent = showLabel
    ? `<div style="
        position:absolute;top:50%;left:24px;transform:translateY(-50%);
        font:${hovered ? "bold 11px" : "bold 10px"} 'SF Mono',monospace;
        color:${color};white-space:nowrap;
        text-shadow:0 0 4px #000,0 0 4px #000,0 0 5px #000;
        pointer-events:none;line-height:1.4;
      ">
        ${ac.callsign}
        ${hovered && ac.altFt != null
          ? `<br/><span style="font-size:9px;opacity:0.75;font-weight:normal">${
              ac.altFt >= 18000 ? `FL${Math.round(ac.altFt/100)}` : `${ac.altFt.toLocaleString()}ft`
            }${ac.speedKt != null ? ` · ${ac.speedKt}kt` : ""}</span>`
          : ""}
        ${isMonitored && !hovered && ac.lastEvent
          ? `<br/><span style="font-size:8px;opacity:0.6;font-weight:normal">${ac.lastEvent}</span>`
          : ""}
      </div>`
    : "";

  return L.divIcon({
    html:       `<div style="position:relative;width:44px;height:56px">${inner}${labelContent}</div>`,
    className:  "",
    iconSize:   [44, 56],
    iconAnchor: [22, 28],
  });
}

// ── Live Map component ────────────────────────────────────────────────────────

function AirportMap({
  aircraft, hoveredId, onHover, apLat, apLon, airportCode, mapHeight,
}: {
  aircraft:    AircraftInfo[];
  hoveredId:   string | null;
  onHover:     (id: string | null) => void;
  apLat:       number;
  apLon:       number;
  airportCode: string;
  mapHeight:   number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const markersRef   = useRef<Map<string, L.Marker>>(new Map());
  const ringsRef     = useRef<L.Circle[]>([]);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center:      [apLat, apLon],
      zoom:        11,
      zoomControl: false,         // we add our own styled control
      attributionControl: false,
    });

    // CartoDB dark tiles — free, no API key, matches dark UI perfectly
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { maxZoom: 19, subdomains: "abcd" },
    ).addTo(map);

    // Attribution in corner
    L.control.attribution({ prefix: false, position: "bottomright" })
      .addAttribution('© <a href="https://carto.com" style="color:#484f58">CARTO</a> © <a href="https://openstreetmap.org" style="color:#484f58">OSM</a>')
      .addTo(map);

    // Range rings: 10nm, 20nm, 30nm (1nm = 1852m)
    ringsRef.current = [10, 20, 30].map(nm =>
      L.circle([apLat, apLon], {
        radius:    nm * 1852,
        color:     "#1e3a1e",
        weight:    0.8,
        fill:      false,
        dashArray: "5,8",
      }).addTo(map),
    );

    // Airport centre dot
    L.circleMarker([apLat, apLon], {
      radius:      6,
      color:       "#3fb950",
      fillColor:   "#3fb950",
      fillOpacity: 0.9,
      weight:      1.5,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current    = null;
      markersRef.current.clear();
      ringsRef.current  = [];
    };
  }, [apLat, apLon]);

  // Invalidate map size when mapHeight changes
  useEffect(() => {
    setTimeout(() => mapRef.current?.invalidateSize(), 50);
  }, [mapHeight]);

  // Update aircraft markers whenever data or hover changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(aircraft.map(a => a.id));

    // Remove stale markers
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) { marker.remove(); markersRef.current.delete(id); }
    });

    // Add / update markers
    aircraft.forEach(ac => {
      const isHov = ac.id === hoveredId;
      const icon  = makeAircraftIcon(ac, isHov);

      if (markersRef.current.has(ac.id)) {
        const m = markersRef.current.get(ac.id)!;
        m.setLatLng([ac.lat, ac.lon]);
        m.setIcon(icon);
        if (isHov) m.setZIndexOffset(1000);
        else       m.setZIndexOffset(0);
      } else {
        const m = L.marker([ac.lat, ac.lon], { icon, zIndexOffset: isHov ? 1000 : 0 })
          .on("mouseover", () => onHover(ac.id))
          .on("mouseout",  () => onHover(null));
        m.addTo(map);
        markersRef.current.set(ac.id, m);
      }
    });
  }, [aircraft, hoveredId]);

  // Expose flyTo helpers via imperative handle pattern
  const flyTo = (lat: number, lon: number, zoom: number) => {
    mapRef.current?.flyTo([lat, lon], zoom, { duration: 0.7 });
  };
  const fitAircraft = () => {
    const map = mapRef.current;
    if (!map || aircraft.length === 0) return;
    const latlngs = aircraft.map(a => [a.lat, a.lon] as [number, number]);
    map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24], maxZoom: 13 });
  };

  return (
    <div>
      {/* Zoom preset buttons */}
      <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap" as const }}>
        {ZOOM_PRESETS.map(p => (
          <button
            key={p.zoom}
            title={p.title}
            onClick={() => flyTo(apLat, apLon, p.zoom)}
            style={{
              fontSize: 9, padding: "3px 8px",
              background: "#161b22", border: "1px solid #30363d",
              color: "#8b949e", cursor: "pointer", borderRadius: 4,
              fontFamily: "monospace",
            }}
          >
            {p.label}
          </button>
        ))}
        {aircraft.length > 0 && (
          <button
            title="Fit all aircraft in view"
            onClick={fitAircraft}
            style={{
              fontSize: 9, padding: "3px 8px",
              background: "#0d2016", border: "1px solid #3fb95055",
              color: "#3fb950", cursor: "pointer", borderRadius: 4,
              fontFamily: "monospace", marginLeft: "auto",
            }}
          >
            Fit aircraft
          </button>
        )}
      </div>

      {/* Map container */}
      <div style={{ position: "relative", borderRadius: 6, overflow: "hidden", height: mapHeight }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

        {/* Zoom +/- overlay */}
        <div style={{
          position: "absolute", top: 8, right: 8, zIndex: 1000,
          display: "flex", flexDirection: "column", gap: 1,
        }}>
          {(["+", "−"] as const).map((sym, i) => (
            <button
              key={sym}
              onClick={() => mapRef.current?.[i === 0 ? "zoomIn" : "zoomOut"]()}
              style={{
                width: 26, height: 26, fontSize: 16, lineHeight: "1",
                background: "#161b22cc", border: "1px solid #30363d",
                color: "#e6edf3", cursor: "pointer",
                borderRadius: i === 0 ? "4px 4px 0 0" : "0 0 4px 4px",
                backdropFilter: "blur(4px)",
              }}
            >
              {sym}
            </button>
          ))}
        </div>

        {/* Centre-on-airport button */}
        <button
          title="Centre on airport"
          onClick={() => flyTo(apLat, apLon, 11)}
          style={{
            position: "absolute", bottom: 22, right: 8, zIndex: 1000,
            width: 26, height: 26, fontSize: 13,
            background: "#161b22cc", border: "1px solid #30363d",
            color: "#3fb950", cursor: "pointer", borderRadius: 4,
            backdropFilter: "blur(4px)",
          }}
        >
          ⌖
        </button>

        {/* Phase legend overlay */}
        <div style={{
          position: "absolute", bottom: 6, left: 8, zIndex: 1000,
          display: "flex", gap: 6, flexWrap: "wrap" as const,
          background: "#0d111788", backdropFilter: "blur(4px)",
          borderRadius: 4, padding: "3px 7px",
        }}>
          {(["arr","dep","gnd","enr"] as const).map(p => (
            <div key={p} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 7, height: 7, borderRadius: p === "gnd" ? 1 : "50%", background: PHASE_COLOR[p], display: "inline-block" }} />
              <span style={{ fontSize: 9, color: "#8b949e", fontFamily: "monospace" }}>{PHASE_LABEL[p]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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
