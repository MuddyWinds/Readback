import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AircraftInfo } from "../../lib/adsb";
import { PHASE_LABEL } from "../../lib/adsb";
import { cssVar } from "../../lib/theme-colors";
import styles from "./AirportMap.module.css";

// ── Constants ─────────────────────────────────────────────────────────────────

const ZOOM_PRESETS = [
  { label: "Region",   zoom: 9,  title: "~60nm — arrival/departure corridors" },
  { label: "Approach", zoom: 11, title: "~30nm — approach & hold patterns"    },
  { label: "Airport",  zoom: 13, title: "~8nm — runway layout visible"         },
  { label: "Ground",   zoom: 15, title: "~2nm — taxiway detail"                },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return the CSS var() string for a monitored aircraft's phraseology status.
 * Tokens resolve to the exact same hex as the original literals:
 *   false → var(--sev-critical)  (non-standard)
 *   true  → var(--sev-standard)  (standard)
 *   null  → var(--sev-medium)    (unassessed)
 */
function monitoredColor(ac: AircraftInfo): string {
  if (ac.standard === false) return "var(--sev-critical)";
  if (ac.standard === true)  return "var(--sev-standard)";
  return "var(--sev-medium)";
}

/**
 * Build an SVG-based Leaflet divIcon for an aircraft target.
 * All paint uses inline style= so var() tokens resolve in the live DOM.
 */
function makeAircraftIcon(ac: AircraftInfo, hovered: boolean): L.DivIcon {
  const isMonitored = ac.monitored;
  // Monitored: colour by phraseology status; unmonitored: dim grey background
  const color = isMonitored ? monitoredColor(ac) : "var(--aircraft-unmon)";
  const hdg   = ac.heading ?? 0;

  if (!isMonitored && !hovered) {
    // Background traffic: tiny featureless dot, no label
    const dot = `<div style="width:6px;height:6px;border-radius:50%;background:${color};opacity:0.5;margin:5px"></div>`;
    return L.divIcon({ html: dot, className: "", iconSize: [16, 16], iconAnchor: [8, 8] });
  }

  const sz    = hovered ? 12 : (isMonitored ? 10 : 7);
  const shape = ac.onGround
    ? `<rect x="${-sz * 0.55}" y="${-sz * 0.55}" width="${sz * 1.1}" height="${sz * 1.1}" style="fill:${color}" opacity="0.95"/>`
    : `<polygon points="0,${-sz} ${sz * 0.6},${sz * 0.5} 0,${sz * 0.18} ${-sz * 0.6},${sz * 0.5}" style="fill:${color}" opacity="0.95"/>`;

  const vLen  = ac.speedKt != null ? Math.min(ac.speedKt * 0.04, 20) : 0;
  const vLine = (!ac.onGround && vLen > 0 && isMonitored)
    ? `<line x1="0" y1="${-sz}" x2="0" y2="${-sz - vLen}" style="stroke:${color}" stroke-width="1.2" opacity="0.4"/>`
    : "";

  // Ring around monitored aircraft
  const ring = isMonitored
    ? `<circle cx="0" cy="0" r="${sz + 3}" fill="none" style="stroke:${color}" stroke-width="${hovered ? 1.2 : 0.6}" opacity="0.35"/>`
    : "";

  const inner = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="-22 -36 44 56" width="44" height="56"
      style="transform:rotate(${hdg}deg);overflow:visible;display:block">
      ${vLine}${ring}${shape}
    </svg>`;

  // Label: monitored always visible; background only on hover.
  // At rest we show a single callsign line to keep the map legible when several
  // monitored targets cluster near the field — altitude/speed (and the event,
  // which also appears in the aircraft list below) are revealed on hover.
  const showLabel = isMonitored || hovered;
  const labelContent = showLabel
    ? `<div style="
        position:absolute;top:50%;left:24px;transform:translateY(-50%);
        font:bold 11px var(--font-mono);
        color:${color};white-space:nowrap;
        text-shadow:0 0 4px var(--icon-shadow),0 0 4px var(--icon-shadow),0 0 5px var(--icon-shadow);
        pointer-events:none;line-height:1.4;
      ">
        ${ac.callsign}
        ${hovered && ac.altFt != null
          ? `<br/><span style="font-size:10px;opacity:0.8;font-weight:normal">${
              ac.altFt >= 18000 ? `FL${Math.round(ac.altFt / 100)}` : `${ac.altFt.toLocaleString()}ft`
            }${ac.speedKt != null ? ` · ${ac.speedKt}kt` : ""}</span>`
          : ""}
        ${hovered && ac.lastEvent
          ? `<br/><span style="font-size:10px;opacity:0.7;font-weight:normal">${ac.lastEvent}</span>`
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

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  aircraft:    AircraftInfo[];
  hoveredId:   string | null;
  selectedId?: string | null;
  onHover:     (id: string | null) => void;
  apLat:       number;
  apLon:       number;
  mapHeight:   number;
}

export function AirportMap({
  aircraft, hoveredId, selectedId, onHover, apLat, apLon, mapHeight,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const markersRef   = useRef<Map<string, L.Marker>>(new Map());
  const ringsRef     = useRef<L.Circle[]>([]);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center:             [apLat, apLon],
      zoom:               11,
      zoomControl:        false,
      attributionControl: false,
    });

    // CartoDB dark tiles — free, no API key, matches dark UI perfectly
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { maxZoom: 19, subdomains: "abcd" },
    ).addTo(map);

    // Attribution: use var(--text-faint)
    L.control.attribution({ prefix: false, position: "bottomright" })
      .addAttribution(
        '© <a href="https://carto.com" style="color:var(--text-faint)">CARTO</a> ' +
        '© <a href="https://openstreetmap.org" style="color:var(--text-faint)">OSM</a>',
      )
      .addTo(map);

    // Range rings: 10nm, 20nm, 30nm — cssVar used because Leaflet option object is JS-only
    ringsRef.current = [10, 20, 30].map(nm =>
      L.circle([apLat, apLon], {
        radius:    nm * 1852,
        color:     cssVar("--ring-green"),
        weight:    0.8,
        fill:      false,
        dashArray: "5,8",
      }).addTo(map),
    );

    // Airport centre dot — cssVar because Leaflet option object is JS-only
    L.circleMarker([apLat, apLon], {
      radius:      6,
      color:       cssVar("--sev-standard"),
      fillColor:   cssVar("--sev-standard"),
      fillOpacity: 0.9,
      weight:      1.5,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current     = null;
      markersRef.current.clear();
      ringsRef.current   = [];
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
      const isSel = ac.id === selectedId;
      const isHov = ac.id === hoveredId || isSel;
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
  }, [aircraft, hoveredId, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const map = mapRef.current;
    if (!map) return;
    const ac = aircraft.find(a => a.id === selectedId);
    if (ac) map.flyTo([ac.lat, ac.lon], Math.max(map.getZoom(), 12), { duration: 0.6 });
  }, [selectedId, aircraft]);

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
      <div className={styles.zoomPresets}>
        {ZOOM_PRESETS.map(p => (
          <button
            key={p.zoom}
            title={p.title}
            onClick={() => flyTo(apLat, apLon, p.zoom)}
            className={styles.presetBtn}
          >
            {p.label}
          </button>
        ))}
        {aircraft.length > 0 && (
          <button
            title="Fit all aircraft in view"
            onClick={fitAircraft}
            className={styles.fitBtn}
          >
            Fit aircraft
          </button>
        )}
      </div>

      {/* Map container */}
      <div
        className={styles.mapWrap}
        style={{ height: mapHeight }}
      >
        <div ref={containerRef} className={styles.mapEl} />

        {/* Zoom +/- overlay */}
        <div className={styles.zoomCtrl}>
          {(["+", "−"] as const).map((sym, i) => (
            <button
              key={sym}
              onClick={() => mapRef.current?.[i === 0 ? "zoomIn" : "zoomOut"]()}
              className={`${styles.zoomBtn} ${i === 0 ? styles.zoomBtnTop : styles.zoomBtnBottom}`}
            >
              {sym}
            </button>
          ))}
        </div>

        {/* Centre-on-airport button */}
        <button
          title="Centre on airport"
          onClick={() => flyTo(apLat, apLon, 11)}
          className={styles.centreBtn}
        >
          ⌖
        </button>

        {/* Phase legend overlay */}
        <div className={styles.phaseLegend}>
          {(["arr", "dep", "gnd", "enr"] as const).map(p => (
            <div key={p} className={styles.legendItem}>
              <span
                className={`${styles.legendDot} ${styles[`phase-${p}`]}`}
                style={{ borderRadius: p === "gnd" ? 1 : "50%" }}
              />
              <span className={styles.legendLabel}>{PHASE_LABEL[p]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
