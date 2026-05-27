import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { AnalysisResult, getCardSeverity } from "./LiveFeed";
import { formatDistanceToNow } from "date-fns";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { useSettings } from "../SettingsContext";
// @ts-ignore
import landJSON from "world-atlas/land-110m.json";
import { feature } from "topojson-client";

// ── Constants ─────────────────────────────────────────────────────────────────

interface Airport { code: string; name: string; lat: number; lon: number; }

const SEV_COLOR: Record<string, string> = {
  critical: "#ff4444", high: "#ff8800", medium: "#e3b341",
  low: "#44aaff", standard: "#3fb950", unassessable: "#484f58",
};
const SEV_ORDER: Record<string, number> = {
  critical: 5, high: 4, medium: 3, low: 2, standard: 1, unassessable: 0,
};
const SEVERITIES = ["critical", "high", "medium", "low"] as const;

const HFACS_INFO: Record<string, { color: string; desc: string }> = {
  "Unsafe Act":               { color: "#ff4444", desc: "Front-line action or communication choice" },
  "Precondition":             { color: "#ff8800", desc: "Environmental / physiological factor" },
  "Unsafe Supervision":       { color: "#e3b341", desc: "Supervisory or task-management context" },
  "Organizational Influence": { color: "#44aaff", desc: "Policy, culture, or resource context" },
};

// ── Shared UI primitives ──────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, overflow: "hidden",
};

function CardHead({ label, badge }: { label: string; badge?: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "10px 16px", borderBottom: "1px solid #21262d", background: "#161b22",
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "#484f58", letterSpacing: 1.3, textTransform: "uppercase" as const }}>
        {label}
      </span>
      {badge}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p style={{ fontSize: 11, color: "#484f58", fontStyle: "italic", margin: 0 }}>{label}</p>;
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "4px 0" }}>
      <div style={{ flex: 1, height: 1, background: "#1c2128" }} />
      <span style={{ fontSize: 9, fontWeight: 700, color: "#30363d", letterSpacing: 1.5, textTransform: "uppercase" as const, whiteSpace: "nowrap" as const }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: "#1c2128" }} />
    </div>
  );
}

// ── Computed statistics ───────────────────────────────────────────────────────

interface AirportStat {
  total: number; standard: number;
  critical: number; high: number; medium: number; low: number;
  violationTypes: Record<string, number>;
  hfacs: Record<string, number>;
}

function useAirportStats(results: AnalysisResult[], airports: Airport[]) {
  return useMemo(() => {
    const map: Record<string, AirportStat> = {};
    for (const ap of airports)
      map[ap.code] = { total: 0, standard: 0, critical: 0, high: 0, medium: 0, low: 0, violationTypes: {}, hfacs: {} };
    results.forEach(r => {
      const s = map[r.airport_code];
      if (!s) return;
      s.total++;
      const sev = getCardSeverity(r);
      if (sev === "standard") s.standard++;
      else if (sev in s) (s as any)[sev]++;
      (r.observations ?? []).forEach((v) => {
        s.violationTypes[v.note_type] = (s.violationTypes[v.note_type] ?? 0) + 1;
        if (v.hfacs_level) s.hfacs[v.hfacs_level] = (s.hfacs[v.hfacs_level] ?? 0) + 1;
      });
    });
    return map;
  }, [results, airports]);
}

function riskScore(s: AirportStat): number {
  if (s.total === 0) return 0;
  return Math.round(((s.critical * 5 + s.high * 3 + s.medium * 2 + s.low) / s.total) * 100);
}

function topEntry(map: Record<string, number>): string | null {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? null;
}

function useSessionStatus(results: AnalysisResult[]) {
  return useMemo(() => {
    const assessable = results.filter(r => r.assessable !== false);
    const nonStandard = assessable.filter(r => !r.is_standard);
    const critical    = nonStandard.filter(r => getCardSeverity(r) === "critical").length;
    const high        = nonStandard.filter(r => getCardSeverity(r) === "high").length;
    const compRate    = assessable.length > 0
      ? Math.round(((assessable.length - nonStandard.length) / assessable.length) * 100) : null;
    const ch = critical + high;
    let label: string, color: string, message: string;
    if      (compRate === null)           { label = "NO DATA";  color = "#484f58"; message = "No assessable transmissions yet"; }
    else if (ch > 3 || compRate < 75)     { label = "CRITICAL"; color = "#ff4444"; message = `${ch} high-priority observation${ch !== 1 ? "s" : ""} — verify transcript and context`; }
    else if (ch > 0 || compRate < 90)     { label = "ELEVATED"; color = "#ff8800"; message = `${ch} high-priority observation${ch !== 1 ? "s" : ""} — review before using for study`; }
    else if (compRate < 95)               { label = "NOMINAL";  color = "#e3b341"; message = "Minor deviations — continue monitoring"; }
    else                                  { label = "CLEAR";    color = "#3fb950"; message = "No significant observations this session"; }
    return { label, color, message, compRate, critical, high, total: assessable.length, violations: nonStandard.length };
  }, [results]);
}

function useHourlyData(results: AnalysisResult[]) {
  return useMemo(() => {
    const now  = new Date();
    const bins: { hour: string; critical: number; high: number; medium: number; low: number; standard: number }[] = [];
    for (let h = 23; h >= 0; h--) {
      const t = new Date(now.getTime() - h * 3_600_000);
      bins.push({ hour: `${String(t.getUTCHours()).padStart(2, "0")}:00`, critical: 0, high: 0, medium: 0, low: 0, standard: 0 });
    }
    results.forEach(r => {
      const age = (now.getTime() - new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z").getTime()) / 3_600_000;
      const idx = 23 - Math.floor(age);
      if (idx < 0 || idx > 23) return;
      const sev = getCardSeverity(r);
      if (sev === "unassessable") return;
      (bins[idx] as any)[sev] = ((bins[idx] as any)[sev] ?? 0) + 1;
    });
    return bins;
  }, [results]);
}

/** All deep-analysis intelligence derived from results in one memoised hook. */
function useObservationIntelligence(results: AnalysisResult[]) {
  return useMemo(() => {
    const allObservations = results.flatMap(r => r.observations ?? []);

    // HFACS distribution
    const hfacsCounts: Record<string, number> = {};
    allObservations.forEach((v) => {
      if (v.hfacs_level) hfacsCounts[v.hfacs_level] = (hfacsCounts[v.hfacs_level] ?? 0) + 1;
    });

    // Note type breakdown (top 8)
    const typeCounts: Record<string, number> = {};
    allObservations.forEach((v) => {
      if (v.note_type) typeCounts[v.note_type] = (typeCounts[v.note_type] ?? 0) + 1;
    });
    const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 8) as [string, number][];

    // Most-cited regulations (top 6, truncate to doc name)
    const regCounts: Record<string, number> = {};
    allObservations.forEach((v) => {
      if (v.relevant_regulation) {
        const short = v.relevant_regulation.split(",")[0].trim();
        regCounts[short] = (regCounts[short] ?? 0) + 1;
      }
    });
    const sortedRegs = Object.entries(regCounts).sort((a, b) => b[1] - a[1]).slice(0, 6) as [string, number][];

    // Repeat callsigns (callsigns with >=2 non-standard appearances)
    const csData: Record<string, { count: number; maxSev: string; lastTs: number }> = {};
    results.forEach(r => {
      if (r.is_standard || r.assessable === false) return;
      const cs = r.enrichment?.callsign_detected
        ?? r.transcript?.match(/\b([A-Z]{2,3}\d{1,4}[A-Z]?)\b/)?.[1];
      if (!cs) return;
      const sev = getCardSeverity(r);
      const ts  = new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z").getTime();
      if (!csData[cs]) csData[cs] = { count: 0, maxSev: "low", lastTs: 0 };
      csData[cs].count++;
      if ((SEV_ORDER[sev] ?? 0) > (SEV_ORDER[csData[cs].maxSev] ?? 0)) csData[cs].maxSev = sev;
      if (ts > csData[cs].lastTs) csData[cs].lastTs = ts;
    });
    const repeatCallsigns = Object.entries(csData)
      .filter(([, d]) => d.count >= 2)
      .sort((a, b) => {
        const d = (SEV_ORDER[b[1].maxSev] ?? 0) - (SEV_ORDER[a[1].maxSev] ?? 0);
        return d !== 0 ? d : b[1].count - a[1].count;
      })
      .slice(0, 10)
      .map(([callsign, d]) => ({ callsign, count: d.count, maxSev: d.maxSev, lastTs: d.lastTs }));

    // Readback quality
    const enriched = results.filter(r => r.assessable !== false && r.enrichment);
    const readback = {
      correct:     enriched.filter(r => r.enrichment?.readback_correct === true).length,
      discrepancy: enriched.filter(r => r.enrichment?.readback_correct === false).length,
      unknown:     enriched.filter(r => r.enrichment?.readback_correct == null).length,
      total:       enriched.length,
    };

    // Spike detection: last 30 min vs prior 30 min (violation-weighted)
    const now = Date.now();
    const inWindow = (r: AnalysisResult, minAge: number, maxAge: number) => {
      const age = (now - new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z").getTime()) / 60000;
      const sev = getCardSeverity(r);
      return age >= minAge && age < maxAge && sev !== "standard" && sev !== "unassessable";
    };
    const last30  = results.filter(r => inWindow(r, 0, 30)).length;
    const prior30 = results.filter(r => inWindow(r, 30, 60)).length;
    const spikeRatio = prior30 > 0 ? last30 / prior30 : (last30 >= 3 ? 3 : 0);

    return {
      hfacsCounts, sortedTypes, sortedRegs, repeatCallsigns, readback,
      spike: { last30, prior30, ratio: spikeRatio, isSpike: spikeRatio >= 2 && last30 >= 2 },
    };
  }, [results]);
}

// ── Globe maths ───────────────────────────────────────────────────────────────

interface Vec3 { x: number; y: number; z: number; }
function latLonToXYZ(lat: number, lon: number): Vec3 {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  return { x: Math.cos(la) * Math.cos(lo), y: Math.sin(la), z: Math.cos(la) * Math.sin(lo) };
}
function rotateY(v: Vec3, a: number): Vec3 {
  return { x: v.x * Math.cos(a) + v.z * Math.sin(a), y: v.y, z: -v.x * Math.sin(a) + v.z * Math.cos(a) };
}
function project(v: Vec3, cx: number, cy: number, r: number) {
  return { px: cx + v.x * r, py: cy - v.y * r, visible: v.z >= -0.1 };
}
function makeDots(n: number): Vec3[] {
  const g = Math.PI * (3 - Math.sqrt(5)), out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2, rr = Math.sqrt(Math.max(0, 1 - y * y)), th = g * i;
    out.push({ x: rr * Math.cos(th), y, z: rr * Math.sin(th) });
  }
  return out;
}
function greatCircleArc(a: Vec3, b: Vec3, steps: number): Vec3[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const cx = a.x + (b.x - a.x) * t, cy = a.y + (b.y - a.y) * t, cz = a.z + (b.z - a.z) * t;
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
    const lift = 1 + 0.12 * Math.sin(t * Math.PI);
    return { x: (cx / len) * lift, y: (cy / len) * lift, z: (cz / len) * lift };
  });
}
const GLOBE_DOTS = makeDots(1400); // 1400 sufficient for visual quality; 2200 was unnecessary

function buildArcs(airports: Airport[]): Vec3[][] {
  const arcs: Vec3[][] = [];
  for (let i = 0; i + 1 < airports.length; i++) {
    arcs.push(greatCircleArc(
      latLonToXYZ(airports[i].lat, airports[i].lon),
      latLonToXYZ(airports[i + 1].lat, airports[i + 1].lon),
      40,
    ));
  }
  return arcs;
}

function buildLandMask(dots: Vec3[]): boolean[] {
  const W = 360, H = 180;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  const geo = feature(landJSON as any, (landJSON as any).objects.land) as any;
  ctx.fillStyle = "#fff";
  const drawRings = (rings: number[][][]) => {
    ctx.beginPath();
    rings.forEach(ring => ring.forEach(([lon, lat], i) => {
      const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * H;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }));
    ctx.closePath(); ctx.fill("evenodd");
  };
  geo.features.forEach((f: any) => {
    const g = f.geometry;
    if      (g.type === "Polygon")      drawRings(g.coordinates);
    else if (g.type === "MultiPolygon") g.coordinates.forEach(drawRings);
  });
  const img = ctx.getImageData(0, 0, W, H);
  return dots.map(d => {
    const lat = Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI;
    const lon = Math.atan2(d.z, d.x) * 180 / Math.PI;
    const px  = Math.min(W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * W)));
    const py  = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
    return img.data[(py * W + px) * 4] > 128;
  });
}
const LAND_MASK = buildLandMask(GLOBE_DOTS);

// ── Globe component ───────────────────────────────────────────────────────────

function Globe({
  results, activeAirports, airports, onAirportClick,
}: {
  results: AnalysisResult[];
  activeAirports: Set<string>;
  airports: Airport[];
  onAirportClick?: (code: string) => void;
}) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const angleRef    = useRef(0);
  const pulseRef    = useRef(0);
  const rafRef      = useRef<number | null>(null);
  const lastRef     = useRef<number>(0);
  const lastDrawRef = useRef<number>(0); // for 30fps cap
  const gradRef     = useRef<CanvasGradient | null>(null); // cached atmosphere gradient
  const gradSizeRef = useRef<number>(0); // invalidate when canvas size changes
  // Store last-rendered canvas positions for hit testing
  const apPosRef    = useRef<Record<string, { px: number; py: number }>>({});
  const arcs = useMemo(() => buildArcs(airports), [airports]);

  const airportSeverity = useMemo(() => {
    const map: Record<string, string> = {};
    results.forEach(r => {
      const sev = getCardSeverity(r), cur = map[r.airport_code];
      if (!cur || (SEV_ORDER[sev] ?? 0) > (SEV_ORDER[cur] ?? 0)) map[r.airport_code] = sev;
    });
    return map;
  }, [results]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const FRAME_MS = 1000 / 30; // 30 fps cap
    const draw = (ts: number) => {
      rafRef.current = requestAnimationFrame(draw);
      const elapsed = ts - lastDrawRef.current;
      if (elapsed < FRAME_MS) return; // skip frame — not enough time has passed
      const delta = lastRef.current ? Math.min(elapsed, 100) : 16; // clamp to 100ms max
      lastRef.current  = ts;
      lastDrawRef.current = ts - (elapsed % FRAME_MS); // keep phase aligned
      angleRef.current = (angleRef.current + delta * 0.00014) % (2 * Math.PI);
      pulseRef.current = (pulseRef.current + delta * 0.003)   % (2 * Math.PI);

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.42;
      ctx.clearRect(0, 0, W, H);

      // Cache atmosphere gradient — recreate only when canvas size changes
      if (!gradRef.current || gradSizeRef.current !== R) {
        const atm = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.15);
        atm.addColorStop(0,   "rgba(0,40,15,0.18)");
        atm.addColorStop(0.8, "rgba(0,20,8,0.06)");
        atm.addColorStop(1,   "rgba(0,0,0,0)");
        gradRef.current  = atm;
        gradSizeRef.current = R;
      }
      ctx.fillStyle = gradRef.current;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.2, 0, Math.PI * 2); ctx.fill();

      const rot = angleRef.current;
      for (let i = 0; i < GLOBE_DOTS.length; i++) {
        const d = GLOBE_DOTS[i], r = rotateY(d, rot);
        const { px, py, visible } = project(r, cx, cy, R);
        if (!visible) continue;
        const depth = (r.z + 1) / 2;
        if (LAND_MASK[i]) {
          ctx.fillStyle = `rgba(0,210,90,${(0.22 + depth * 0.58).toFixed(2)})`;
          const sz = 0.9 + depth * 0.9;
          ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
        } else {
          ctx.fillStyle = `rgba(30,90,160,${(0.03 + depth * 0.04).toFixed(2)})`;
          ctx.fillRect(px - 0.6, py - 0.6, 1.2, 1.2);
        }
      }

      // Use pre-computed world-space arc points — only rotate+project per frame
      for (const arcPts of arcs) {
        ctx.beginPath();
        let first = true;
        for (const pt of arcPts) {
          const r2 = rotateY(pt, rot);
          const { px, py, visible } = project(r2, cx, cy, R);
          if (!visible) { first = true; continue; }
          if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = "rgba(68,170,255,0.20)"; ctx.lineWidth = 0.9; ctx.stroke();
      }

      const pulse = 0.5 + 0.5 * Math.sin(pulseRef.current);
      const newPos: Record<string, { px: number; py: number }> = {};
      for (const ap of airports) {
        const rot3 = rotateY(latLonToXYZ(ap.lat, ap.lon), rot);
        const { px, py, visible } = project(rot3, cx, cy, R);
        if (!visible) continue;
        newPos[ap.code] = { px, py };
        const sev      = airportSeverity[ap.code] ?? "standard";
        const isActive = activeAirports.has(ap.code);
        const color    = SEV_COLOR[sev] ?? "#3fb950";
        const hasCrit  = sev === "critical" || sev === "high";
        if (isActive || hasCrit) {
          const glowR = 9 + (hasCrit ? 7 * pulse : 3);
          const grd = ctx.createRadialGradient(px, py, 0, px, py, glowR);
          grd.addColorStop(0, color + "66"); grd.addColorStop(1, color + "00");
          ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(px, py, glowR, 0, Math.PI * 2); ctx.fill();
        }
        const dotR = isActive ? 6 : 5;
        ctx.beginPath(); ctx.arc(px, py, dotR, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = "#0d1117"; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = "#e6edf3"; ctx.font = "bold 10px 'SF Mono',monospace";
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(ap.code, px + dotR + 3, py);
        // Click hint ring when hoverable
        if (onAirportClick) {
          ctx.beginPath(); ctx.arc(px, py, dotR + 3.5, 0, Math.PI * 2);
          ctx.strokeStyle = color + "44"; ctx.lineWidth = 0.8; ctx.stroke();
        }
      }
      apPosRef.current = newPos;
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [airportSeverity, activeAirports, airports, arcs, onAirportClick]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) { canvas.width = rect.width; canvas.height = rect.height; }
    });
    ro.observe(canvas.parentElement!);
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (rect) { canvas.width = rect.width; canvas.height = rect.height; }
    return () => ro.disconnect();
  }, []);

  // Click and hover cursor for airport dots
  useEffect(() => {
    if (!onAirportClick) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const hitTest = (e: MouseEvent): string | null => {
      const rect  = canvas.getBoundingClientRect();
      const sx    = (e.clientX - rect.left) * (canvas.width  / rect.width);
      const sy    = (e.clientY - rect.top)  * (canvas.height / rect.height);
      for (const [code, pos] of Object.entries(apPosRef.current)) {
        const dx = sx - pos.px, dy = sy - pos.py;
        if (Math.sqrt(dx * dx + dy * dy) < 16) return code;
      }
      return null;
    };

    const onMove  = (e: MouseEvent) => { canvas.style.cursor = hitTest(e) ? "pointer" : "default"; };
    const onClick = (e: MouseEvent) => { const c = hitTest(e); if (c) onAirportClick(c); };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click",     onClick);
    return () => {
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click",     onClick);
    };
  }, [onAirportClick]);

  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}

// ── Session status strip ──────────────────────────────────────────────────────

function SessionStatusStrip({
  status, compact,
}: { status: ReturnType<typeof useSessionStatus>; compact: boolean }) {
  const { label, color, message, compRate, critical, high, total, violations } = status;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: compact ? 10 : 16,
      background: color + "0d", border: `1px solid ${color}33`,
      borderRadius: 8, padding: compact ? "8px 12px" : "10px 18px", flexWrap: "wrap" as const,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div style={{ width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: `0 0 7px ${color}99` }} />
        <span style={{ fontSize: compact ? 11 : 13, fontWeight: 700, color, letterSpacing: 0.4 }}>{label}</span>
      </div>
      <span style={{ fontSize: compact ? 10 : 11, color: "#8b949e", flex: 1, minWidth: 120 }}>{message}</span>
      {!compact && (
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexShrink: 0 }}>
          {compRate !== null && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: compRate >= 90 ? "#3fb950" : compRate >= 75 ? "#e3b341" : "#ff4444" }}>
                {compRate}%
              </div>
              <div style={{ fontSize: 9, color: "#484f58", textTransform: "uppercase" as const, letterSpacing: 0.8 }}>Standard</div>
            </div>
          )}
          {critical > 0 && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: "#ff4444" }}>{critical}</div>
              <div style={{ fontSize: 9, color: "#484f58", textTransform: "uppercase" as const, letterSpacing: 0.8 }}>Critical</div>
            </div>
          )}
          {high > 0 && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: "#ff8800" }}>{high}</div>
              <div style={{ fontSize: 9, color: "#484f58", textTransform: "uppercase" as const, letterSpacing: 0.8 }}>High</div>
            </div>
          )}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: "#6e7681" }}>{total}</div>
            <div style={{ fontSize: 9, color: "#484f58", textTransform: "uppercase" as const, letterSpacing: 0.8 }}>Assessed</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: violations > 0 ? "#ff8800" : "#3fb950" }}>{violations}</div>
            <div style={{ fontSize: 9, color: "#484f58", textTransform: "uppercase" as const, letterSpacing: 0.8 }}>Observations</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Spike alert ───────────────────────────────────────────────────────────────

function SpikeAlert({ spike }: { spike: ReturnType<typeof useObservationIntelligence>["spike"] }) {
  if (!spike.isSpike) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: "#ff444410", border: "1px solid #ff444444",
      borderLeft: "3px solid #ff4444", borderRadius: "0 8px 8px 0", padding: "8px 14px",
    }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>🔺</span>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#ff4444", letterSpacing: 1, marginBottom: 2 }}>
          OBSERVATION SPIKE DETECTED
        </div>
        <span style={{ fontSize: 11, color: "#c9d1d9" }}>
          {spike.last30} observation{spike.last30 !== 1 ? "s" : ""} in the last 30 min —{" "}
          {Math.round(spike.ratio)}× higher than the prior 30 min ({spike.prior30} observation{spike.prior30 !== 1 ? "s" : ""}).
          Review recent transmissions immediately.
        </span>
      </div>
    </div>
  );
}

// ── Event timeline ────────────────────────────────────────────────────────────

function EventTimeline({ results, compact = false }: { results: AnalysisResult[]; compact?: boolean }) {
  const events = useMemo(() =>
    [...results]
      .filter(r => { const s = getCardSeverity(r); return s !== "standard" && s !== "unassessable"; })
      .slice(0, compact ? 20 : 40),
    [results, compact]
  );
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {events.length === 0 && <EmptyState label="No observations yet." />}
      {events.map((r, i) => {
        const sev   = getCardSeverity(r);
        const color = SEV_COLOR[sev] ?? "#888";
        const ts    = new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z");
        const cs    = r.enrichment?.callsign_detected ?? r.transcript?.match(/\b([A-Z]{2,3}\d{1,4}[A-Z]?)\b/)?.[1] ?? null;
        return (
          <div key={i} style={{
            display: "flex", gap: 10, alignItems: "flex-start",
            padding: compact ? "7px 0" : "9px 0",
            borderBottom: i < events.length - 1 ? "1px solid #1c2128" : "none",
          }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 14 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, marginTop: 2, flexShrink: 0 }} />
              {i < events.length - 1 && <div style={{ width: 1, flex: 1, background: "#1c2128", marginTop: 3 }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" as const }}>
                <span style={{ fontSize: 9, fontWeight: 700, color, background: color + "18", border: `1px solid ${color}44`, borderRadius: 3, padding: "1px 5px" }}>
                  {sev.toUpperCase()}
                </span>
                <span style={{ fontSize: 9, fontFamily: "monospace", color: "#6e7681", background: "#161b22", border: "1px solid #21262d", borderRadius: 3, padding: "1px 4px" }}>
                  {r.airport_code}
                </span>
                {cs && <span style={{ fontSize: 9, color: "#484f58", fontFamily: "monospace" }}>{cs}</span>}
                <span style={{ marginLeft: "auto", fontSize: 9, color: "#3a3f47", whiteSpace: "nowrap" as const }}>
                  {formatDistanceToNow(ts, { addSuffix: true })}
                </span>
              </div>
              {!compact && r.summary && (
                <p style={{
                  fontSize: 11, color: "#6e7681", margin: "3px 0 0", lineHeight: 1.45,
                  overflow: "hidden", display: "-webkit-box",
                  WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any,
                }}>
                  {r.summary.split(".")[0]}.
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 24h stacked area chart ────────────────────────────────────────────────────

function ActivityChart({ data }: { data: ReturnType<typeof useHourlyData> }) {
  return (
    <ResponsiveContainer width="100%" height={130}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
        <defs>
          {(["critical", "high", "medium", "low", "standard"] as const).map(sev => (
            <linearGradient key={sev} id={`sr-g-${sev}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={SEV_COLOR[sev]} stopOpacity={0.35} />
              <stop offset="95%" stopColor={SEV_COLOR[sev]} stopOpacity={0}    />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1c2128" vertical={false} />
        <XAxis dataKey="hour" tick={{ fontSize: 8, fill: "#484f58" }} tickLine={false} axisLine={false} interval={5} />
        <YAxis tick={{ fontSize: 8, fill: "#484f58" }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 6, fontSize: 10 }}
          labelStyle={{ color: "#8b949e" }} itemStyle={{ color: "#e6edf3" }}
        />
        {(["critical", "high", "medium", "low", "standard"] as const).map(sev => (
          <Area key={sev} type="monotone" dataKey={sev}
            stroke={SEV_COLOR[sev]} strokeWidth={1.5}
            fill={`url(#sr-g-${sev})`} stackId="1" />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Airport risk matrix ───────────────────────────────────────────────────────

function RiskMatrix({
  airportStats, activeAirports, airports,
}: { airportStats: Record<string, AirportStat>; activeAirports: Set<string>; airports: Airport[] }) {
  const maxVal = Math.max(1, ...airports.flatMap(ap => SEVERITIES.map(c => airportStats[ap.code]?.[c] ?? 0)));
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "4px 8px 8px", color: "#484f58", fontSize: 9, fontWeight: 700, letterSpacing: 0.8 }}>
              AIRPORT
            </th>
            {SEVERITIES.map(c => (
              <th key={c} style={{ padding: "4px 8px 8px", color: SEV_COLOR[c], fontSize: 9, fontWeight: 700, letterSpacing: 0.8, textAlign: "center" }}>
                {c.toUpperCase()}
              </th>
            ))}
            <th style={{ padding: "4px 8px 8px", color: "#484f58", fontSize: 9, fontWeight: 700, letterSpacing: 0.8, textAlign: "center" }}>
              RISK
            </th>
            <th style={{ padding: "4px 8px 8px", color: "#484f58", fontSize: 9, fontWeight: 700, letterSpacing: 0.8, textAlign: "center" }}>
              CONF%
            </th>
          </tr>
        </thead>
        <tbody>
          {airports.map(ap => {
            const s = airportStats[ap.code];
            const score = riskScore(s);
            const assessable = s.total > 0 ? s.total : 1;
            const compPct = s.total > 0 ? Math.round((s.standard / s.total) * 100) : null;
            const compColor = compPct == null ? "#484f58" : compPct >= 90 ? "#3fb950" : compPct >= 75 ? "#e3b341" : "#ff4444";
            return (
              <tr key={ap.code} style={{ borderTop: "1px solid #1c2128" }}>
                <td style={{ padding: "7px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: "#e6edf3" }}>{ap.code}</span>
                    {activeAirports.has(ap.code) && (
                      <span style={{ fontSize: 8, color: "#3fb950", background: "#3fb95022", border: "1px solid #3fb95033", borderRadius: 3, padding: "0 4px" }}>
                        LIVE
                      </span>
                    )}
                  </div>
                </td>
                {SEVERITIES.map(c => {
                  const n = (s as any)[c] ?? 0;
                  const intensity = n / maxVal;
                  const hex = Math.round(intensity * 40 + 10).toString(16).padStart(2, "0");
                  return (
                    <td key={c} style={{ padding: "5px 8px", textAlign: "center" }}>
                      {n > 0 ? (
                        <span style={{
                          display: "inline-block", minWidth: 26, padding: "2px 6px",
                          borderRadius: 4, fontSize: 11, fontWeight: 700,
                          color: SEV_COLOR[c], background: SEV_COLOR[c] + hex,
                          border: `1px solid ${SEV_COLOR[c]}44`,
                        }}>{n}</span>
                      ) : <span style={{ color: "#21262d" }}>—</span>}
                    </td>
                  );
                })}
                <td style={{ padding: "5px 8px", textAlign: "center" }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, fontFamily: "monospace",
                    color: score > 300 ? "#ff4444" : score > 150 ? "#ff8800" : score > 0 ? "#e3b341" : "#484f58",
                  }}>
                    {score > 0 ? score : "—"}
                  </span>
                </td>
                <td style={{ padding: "5px 8px", textAlign: "center" }}>
                  {compPct !== null ? (
                    <span style={{ fontSize: 11, fontWeight: 700, color: compColor, fontFamily: "monospace" }}>
                      {compPct}%
                    </span>
                  ) : <span style={{ color: "#21262d" }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Temporal heatmap (hour × airport) ────────────────────────────────────────

function TemporalHeatmap({ results, airports }: { results: AnalysisResult[]; airports: Airport[] }) {
  const grid = useMemo(() => {
    const g: Record<string, number[]> = {};
    for (const ap of airports) g[ap.code] = Array(24).fill(0);
    results.forEach(r => {
      if (!g[r.airport_code]) return;
      const sev = getCardSeverity(r);
      if (sev === "standard" || sev === "unassessable") return;
      const h = new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z").getUTCHours();
      const weight = sev === "critical" ? 4 : sev === "high" ? 3 : sev === "medium" ? 2 : 1;
      g[r.airport_code][h] += weight;
    });
    return g;
  }, [results, airports]);

  const maxVal = Math.max(1, ...Object.values(grid).flatMap(row => row));
  const hours  = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: `44px repeat(24, 1fr)`, gap: 2, minWidth: 380 }}>
        {/* header */}
        <div />
        {hours.map(h => (
          <div key={h} style={{ fontSize: 7, color: "#484f58", textAlign: "center", paddingBottom: 2 }}>
            {h % 6 === 0 ? `${String(h).padStart(2, "0")}Z` : ""}
          </div>
        ))}
        {/* rows */}
        {airports.map(ap => (
          <React.Fragment key={ap.code}>
            <div style={{ fontSize: 9, fontFamily: "monospace", color: "#6e7681", display: "flex", alignItems: "center" }}>
              {ap.code}
            </div>
            {hours.map(h => {
              const val = grid[ap.code]?.[h] ?? 0;
              const t   = val / maxVal;
              const bg  = val === 0 ? "#161b22"
                : t < 0.33 ? `rgba(68,170,255,${(0.25 + t * 0.5).toFixed(2)})`
                : t < 0.66 ? `rgba(227,179,65,${(0.3  + t * 0.4).toFixed(2)})`
                :             `rgba(255,68,68,${(0.4  + t * 0.5).toFixed(2)})`;
              return (
                <div key={h}
                  title={val > 0 ? `${ap.code} ${String(h).padStart(2,"0")}:00 UTC — severity weight ${val}` : undefined}
                  style={{ height: 20, borderRadius: 2, background: bg }}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div style={{ fontSize: 9, color: "#484f58", marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" as const }}>
        <span>
          <span style={{ color: "#44aaff" }}>■</span> low ·{" "}
          <span style={{ color: "#e3b341" }}>■</span> medium ·{" "}
          <span style={{ color: "#ff4444" }}>■</span> high / critical
        </span>
        <span style={{ fontStyle: "italic" }}>Colour intensity = severity-weighted count · Hours in UTC</span>
      </div>
    </div>
  );
}

// ── HFACS root-cause chart ────────────────────────────────────────────────────

function HFACSChart({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return <EmptyState label="No HFACS data yet — observations required." />;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const maxVal = sorted[0][1];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {sorted.map(([level, count]) => {
        const info = HFACS_INFO[level] ?? { color: "#8b949e", desc: level };
        const pct  = Math.round((count / total) * 100);
        return (
          <div key={level}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 8 }}>
              <span style={{ fontSize: 10, color: "#8b949e", flex: 1 }}>{level}</span>
              <span style={{ fontSize: 9, color: "#484f58", flexShrink: 0 }}>{info.desc}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: info.color, fontFamily: "monospace", width: 32, textAlign: "right", flexShrink: 0 }}>
                {pct}%
              </span>
            </div>
            <div style={{ background: "#1c2128", borderRadius: 3, height: 8 }}>
              <div style={{ width: `${(count / maxVal) * 100}%`, height: "100%", background: info.color, borderRadius: 3, transition: "width 0.4s ease" }} />
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 9, color: "#484f58", marginTop: 2, fontStyle: "italic" }}>
        {total} observation instance{total !== 1 ? "s" : ""} classified across all HFACS levels
      </div>
      <div style={{ borderTop: "1px solid #1c2128", paddingTop: 8 }}>
        <div style={{ fontSize: 9, color: "#484f58", lineHeight: 1.7 }}>
          {(() => {
            const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
            if (!top) return null;
            const rec: Record<string, string> = {
              "Unsafe Act": "Focus on individual training, phraseology drills, and refresher assessments.",
              "Precondition": "Review scheduling, fatigue risk management, and environmental conditions.",
              "Unsafe Supervision": "Audit shift supervisor practices and oversight procedures.",
              "Organizational Influence": "Escalate to management — cultural or policy-level intervention required.",
            };
            return <span><strong style={{ color: "#c9d1d9" }}>Recommendation:</strong> {rec[top] ?? "Conduct targeted review."}</span>;
          })()}
        </div>
      </div>
    </div>
  );
}

// ── Violation type breakdown (horizontal bars) ────────────────────────────────

function ViolationTypeChart({ types }: { types: [string, number][] }) {
  if (types.length === 0) return <EmptyState label="No observations recorded yet." />;
  const max = types[0][1];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {types.map(([type, count], i) => (
        <div key={type} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, color: "#484f58", fontFamily: "monospace", width: 14, textAlign: "right", flexShrink: 0 }}>
            {i + 1}
          </span>
          <div style={{ flex: 1, background: "#161b22", borderRadius: 3, height: 18, position: "relative", overflow: "hidden" }}>
            <div style={{
              width: `${(count / max) * 100}%`, height: "100%",
              background: "#44aaff14", borderRight: "2px solid #44aaff88",
              transition: "width 0.4s ease",
            }} />
            <span style={{
              position: "absolute", left: 7, top: 0, height: "100%",
              display: "flex", alignItems: "center",
              fontSize: 10, color: "#8b949e",
            }}>
              {type}
            </span>
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: "#44aaff", width: 22, textAlign: "right", flexShrink: 0 }}>
            {count}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Readback quality index ────────────────────────────────────────────────────

function ReadbackQualityPanel({ readback }: { readback: ReturnType<typeof useObservationIntelligence>["readback"] }) {
  const { correct, discrepancy, unknown, total } = readback;
  if (total === 0) return <EmptyState label="No enriched readback data yet." />;
  const items = [
    { label: "Correct readback",                       count: correct,     color: "#3fb950" },
    { label: "Discrepancy / possible ASR artefact",    count: discrepancy, color: "#ff8800" },
    { label: "Cannot determine (one-sided recording)", count: unknown,     color: "#484f58" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Stacked proportion bar */}
      <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", gap: 1 }}>
        {items.map(item => {
          const pct = (item.count / total) * 100;
          if (pct === 0) return null;
          return <div key={item.label} style={{ flex: pct, background: item.color, transition: "flex 0.4s" }} />;
        })}
      </div>
      {/* Legend with percentages */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map(item => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: item.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: "#6e7681", flex: 1 }}>{item.label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: item.color, width: 30, textAlign: "right" }}>
              {item.count > 0 ? `${Math.round((item.count / total) * 100)}%` : "—"}
            </span>
            <span style={{ fontSize: 9, color: "#484f58", fontFamily: "monospace", width: 20, textAlign: "right" }}>
              {item.count}
            </span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9, color: "#484f58", fontStyle: "italic", borderTop: "1px solid #1c2128", paddingTop: 6 }}>
        Based on {total} assessed transmission{total !== 1 ? "s" : ""} with Gemini enrichment.
        {discrepancy > 0 && discrepancy / total > 0.15 && (
          <span style={{ color: "#ff8800", display: "block", marginTop: 3 }}>
            ⚠ Readback discrepancy rate above 15% — consider systematic phraseology review.
          </span>
        )}
      </div>
    </div>
  );
}

// ── Repeat callsigns leaderboard ──────────────────────────────────────────────

function RepeatCallsignsTable({ callsigns }: { callsigns: ReturnType<typeof useObservationIntelligence>["repeatCallsigns"] }) {
  if (callsigns.length === 0) {
    return <EmptyState label="No callsign has appeared in multiple non-standard transmissions yet." />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {callsigns.map((o, i) => {
        const color = SEV_COLOR[o.maxSev] ?? "#888";
        const ago   = o.lastTs ? formatDistanceToNow(new Date(o.lastTs), { addSuffix: true }) : "—";
        return (
          <div key={o.callsign} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 0", borderTop: i > 0 ? "1px solid #1c2128" : "none",
          }}>
            <span style={{ fontSize: 10, color: "#3a3f47", fontFamily: "monospace", width: 18, flexShrink: 0, textAlign: "right" }}>
              {i + 1}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color: "#e6edf3", flex: 1 }}>
              {o.callsign}
            </span>
            <span style={{
              fontSize: 9, fontWeight: 700, color,
              background: color + "18", border: `1px solid ${color}44`,
              borderRadius: 3, padding: "1px 5px", flexShrink: 0,
            }}>
              {o.maxSev.toUpperCase()}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: "#ff8800", flexShrink: 0 }}>
              ×{o.count}
            </span>
            <span style={{ fontSize: 9, color: "#484f58", flexShrink: 0, whiteSpace: "nowrap" as const }}>
              {ago}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Most-cited regulations ────────────────────────────────────────────────────

function TopRegulations({ regs }: { regs: [string, number][] }) {
  if (regs.length === 0) return <EmptyState label="No regulation citations yet." />;
  const max = regs[0][1];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {regs.map(([reg, count], i) => (
        <div key={reg} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, color: "#3a3f47", fontFamily: "monospace", width: 16, flexShrink: 0, textAlign: "right" }}>
            {i + 1}
          </span>
          <span style={{
            fontSize: 9, color: "#8b949e", flex: 1, fontFamily: "monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
          }} title={reg}>
            {reg}
          </span>
          <div style={{ width: 50, background: "#1c2128", borderRadius: 2, height: 4, flexShrink: 0 }}>
            <div style={{ width: `${(count / max) * 100}%`, height: "100%", background: "#44aaff", borderRadius: 2, transition: "width 0.4s" }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: "#44aaff", width: 20, textAlign: "right", flexShrink: 0 }}>
            {count}
          </span>
        </div>
      ))}
      <div style={{ fontSize: 9, color: "#484f58", fontStyle: "italic", borderTop: "1px solid #1c2128", paddingTop: 6 }}>
        Frequent citations identify training gaps. Prioritise top regulations for next refresher cycle.
      </div>
    </div>
  );
}

// ── Airport detail cards (kept for at-a-glance reference) ────────────────────

function AirportDetailCards({
  airportStats, activeAirports, airports, onAirportClick,
}: {
  airportStats:    Record<string, AirportStat>;
  activeAirports:  Set<string>;
  airports:        Airport[];
  onAirportClick?: (code: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" as const }}>
      {airports.map(ap => {
        const s        = airportStats[ap.code];
        const score    = riskScore(s);
        const topViol  = topEntry(s.violationTypes);
        const topHfacs = topEntry(s.hfacs);
        const compPct  = s.total > 0 ? Math.round((s.standard / s.total) * 100) : null;
        const isActive = activeAirports.has(ap.code);
        const topSev   = s.critical > 0 ? "critical" : s.high > 0 ? "high" : s.medium > 0 ? "medium" : s.low > 0 ? "low" : "standard";
        const borderTop = SEV_COLOR[topSev];
        const compColor = compPct == null ? "#484f58" : compPct >= 90 ? "#3fb950" : compPct >= 75 ? "#e3b341" : "#ff4444";
        return (
          <div
            key={ap.code}
            onClick={() => onAirportClick?.(ap.code)}
            style={{
              flex: "1 1 160px", minWidth: 150, maxWidth: 250,
              background: "#161b22",
              border: `1px solid ${isActive ? borderTop + "55" : "#21262d"}`,
              borderTop: `3px solid ${borderTop}`,
              borderRadius: "0 0 8px 8px", padding: "12px 14px",
              cursor: onAirportClick ? "pointer" : "default",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => { if (onAirportClick) (e.currentTarget as HTMLDivElement).style.background = "#1c2128"; }}
            onMouseLeave={e => { if (onAirportClick) (e.currentTarget as HTMLDivElement).style.background = "#161b22"; }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: "#e6edf3" }}>{ap.code}</span>
                {isActive && (
                  <span style={{ fontSize: 9, color: "#3fb950", background: "#3fb95022", border: "1px solid #3fb95044", borderRadius: 3, padding: "1px 4px" }}>
                    LIVE
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {score > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: score > 300 ? "#ff4444" : score > 150 ? "#ff8800" : "#e3b341" }}>
                    Risk {score}
                  </span>
                )}
                {onAirportClick && (
                  <span style={{ fontSize: 9, color: "#3a3f47" }}>↗</span>
                )}
              </div>
            </div>
            <div style={{ fontSize: 10, color: "#6e7681", marginBottom: 8 }}>{ap.name}</div>
            {s.total === 0 ? (
              <p style={{ fontSize: 11, color: "#30363d", fontStyle: "italic", margin: 0 }}>No data</p>
            ) : (
              <>
                {compPct !== null && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: "#6e7681" }}>Standard</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: compColor }}>{compPct}%</span>
                    </div>
                    <div style={{ background: "#21262d", borderRadius: 2, height: 4 }}>
                      <div style={{ width: `${compPct}%`, background: compColor, height: "100%", borderRadius: 2, transition: "width 0.3s" }} />
                    </div>
                    {compPct < 80 && <div style={{ fontSize: 9, color: "#ff4444", marginTop: 2 }}>⚠ Below 80% threshold</div>}
                  </div>
                )}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" as const, marginBottom: 8 }}>
                  {SEVERITIES.map(sev => (s as any)[sev] > 0 ? (
                    <span key={sev} style={{
                      fontSize: 10, fontWeight: 700, borderRadius: 3, padding: "1px 5px",
                      color: SEV_COLOR[sev], background: SEV_COLOR[sev] + "18", border: `1px solid ${SEV_COLOR[sev]}44`,
                    }}>
                      {(s as any)[sev]} {sev}
                    </span>
                  ) : null)}
                </div>
                {topViol  && <div style={{ fontSize: 10, color: "#8b949e", marginBottom: 2, lineHeight: 1.4 }}><span style={{ color: "#484f58" }}>Top: </span>{topViol}</div>}
                {topHfacs && <div style={{ fontSize: 10, color: "#484f58", lineHeight: 1.4 }}><span>HFACS: </span><span style={{ color: "#6e7681" }}>{topHfacs}</span></div>}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main SituationRoom ────────────────────────────────────────────────────────

interface Props {
  results:         AnalysisResult[];
  activeAirports:  Set<string>;
  onAirportClick?: (code: string) => void;
}

export function SituationRoom({ results, activeAirports, onAirportClick }: Props) {
  const { bp }   = useWindowWidth();
  const { settings } = useSettings();
  const isMobile = bp === "mobile";
  const isTablet = bp === "tablet";
  const isSmall  = isMobile || isTablet;
  const isLarge  = bp === "large";

  const airports: Airport[] = useMemo(
    () => (settings?.feeds ?? [])
      .filter(f => f.lat != null && f.lon != null)
      .map(f => ({ code: f.airport_code, name: f.name || f.label || f.airport_code, lat: f.lat!, lon: f.lon! })),
    [settings]
  );

  const airportStats = useAirportStats(results, airports);
  const status       = useSessionStatus(results);
  const hourlyData   = useHourlyData(results);
  const intel        = useObservationIntelligence(results);
  const violCount    = results.filter(r => {
    const s = getCardSeverity(r); return s !== "standard" && s !== "unassessable";
  }).length;

  const pad = isMobile ? 12 : 20;

  // ── Panel definitions ───────────────────────────────────────────────────────

  const globePanel = (
    <div style={{ ...cardStyle, display: "flex", flexDirection: "column" }}>
      <CardHead label="Global Situation" badge={
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, fontSize: 9, color: "#484f58" }}>
          <span><span style={{ color: "#ff4444" }}>●</span> Critical</span>
          <span><span style={{ color: "#e3b341" }}>●</span> Medium</span>
          <span><span style={{ color: "#3fb950" }}>●</span> Clear</span>
        </div>
      } />
      <div style={{ position: "relative", flex: 1, minHeight: isSmall ? 240 : 320, background: "#0a0f0a" }}>
        <Globe results={results} activeAirports={activeAirports} airports={airports} onAirportClick={onAirportClick} />
      </div>
    </div>
  );

  const timelinePanel = (
    <div style={{ ...cardStyle, display: "flex", flexDirection: "column" }}>
      <CardHead label="Event Timeline" badge={
        violCount > 0 ? (
          <span style={{ fontSize: 9, fontWeight: 700, color: "#ff4444", background: "#ff444418", border: "1px solid #ff444433", borderRadius: 8, padding: "1px 6px" }}>
            {violCount} observations
          </span>
        ) : undefined
      } />
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 14px", maxHeight: isSmall ? 200 : 320 }}>
        <EventTimeline results={results} compact={isMobile} />
      </div>
    </div>
  );

  const chartPanel = (
    <div style={{ ...cardStyle, padding: "0 0 8px" }}>
      <CardHead label="24-Hour Activity Timeline" />
      <div style={{ padding: "10px 4px 4px 16px" }}>
        <ActivityChart data={hourlyData} />
      </div>
    </div>
  );

  const riskMatrixPanel = (
    <div style={{ ...cardStyle }}>
      <CardHead label="Airport Risk Matrix" badge={
        <span style={{ fontSize: 9, color: "#484f58", marginLeft: "auto" }}>
          Risk = weighted observation score per transmission
        </span>
      } />
      <div style={{ padding: "12px 16px" }}>
        <RiskMatrix airportStats={airportStats} activeAirports={activeAirports} airports={airports} />
      </div>
    </div>
  );

  const heatmapPanel = (
    <div style={{ ...cardStyle }}>
      <CardHead label="Observation Heatmap — Hour of Day" badge={
        <span style={{ fontSize: 9, color: "#484f58", marginLeft: "auto" }}>
          Identifies rush-hour or shift-change patterns
        </span>
      } />
      <div style={{ padding: "12px 16px" }}>
        <TemporalHeatmap results={results} airports={airports} />
      </div>
    </div>
  );

  const hfacsPanel = (
    <div style={{ ...cardStyle }}>
      <CardHead label="HFACS Root-Cause Distribution" badge={
        <span style={{ fontSize: 9, color: "#484f58", marginLeft: "auto" }}>
          Drives intervention strategy
        </span>
      } />
      <div style={{ padding: "12px 16px" }}>
        <HFACSChart counts={intel.hfacsCounts} />
      </div>
    </div>
  );

  const typePanel = (
    <div style={{ ...cardStyle }}>
      <CardHead label="Observation Type Breakdown" />
      <div style={{ padding: "12px 16px" }}>
        <ViolationTypeChart types={intel.sortedTypes} />
      </div>
    </div>
  );

  const readbackPanel = (
    <div style={{ ...cardStyle }}>
      <CardHead label="Readback Quality Index" badge={
        <span style={{ fontSize: 9, color: "#484f58", marginLeft: "auto" }}>
          From Gemini enrichment
        </span>
      } />
      <div style={{ padding: "12px 16px" }}>
        <ReadbackQualityPanel readback={intel.readback} />
      </div>
    </div>
  );

  const repeatCallsignsPanel = (
    <div style={{ ...cardStyle }}>
      <CardHead label="Repeat Callsigns" badge={
        intel.repeatCallsigns.length > 0 ? (
          <span style={{ fontSize: 9, fontWeight: 700, color: "#ff8800", background: "#ff880018", border: "1px solid #ff880033", borderRadius: 8, padding: "1px 6px" }}>
            {intel.repeatCallsigns.length} callsign{intel.repeatCallsigns.length !== 1 ? "s" : ""}
          </span>
        ) : undefined
      } />
      <div style={{ padding: "8px 16px 14px" }}>
        <RepeatCallsignsTable callsigns={intel.repeatCallsigns} />
      </div>
    </div>
  );

  const regsPanel = (
    <div style={{ ...cardStyle }}>
      <CardHead label="Most-Cited Regulations" badge={
        <span style={{ fontSize: 9, color: "#484f58", marginLeft: "auto" }}>
          Target these for training focus
        </span>
      } />
      <div style={{ padding: "12px 16px" }}>
        <TopRegulations regs={intel.sortedRegs} />
      </div>
    </div>
  );

  const airportPanel = (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#484f58", letterSpacing: 1.3, textTransform: "uppercase" as const, marginBottom: 10 }}>
        Airport Detail Cards
      </div>
      <AirportDetailCards airportStats={airportStats} activeAirports={activeAirports} airports={airports} onAirportClick={onAirportClick} />
    </div>
  );

  // ── Layout ──────────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 14,
      padding: pad,
      maxWidth: isLarge ? 1360 : "none",
      margin: isLarge ? "0 auto" : undefined,
      width: "100%",
    }}>
      {/* Row 0: Status + Spike alert */}
      <SessionStatusStrip status={status} compact={isMobile} />
      <SpikeAlert spike={intel.spike} />

      {/* Row 1: Globe + Timeline */}
      {isMobile ? (
        <>{timelinePanel}{globePanel}</>
      ) : isTablet ? (
        <>
          {globePanel}
          <div style={{ display: "flex", gap: 14 }}>
            <div style={{ flex: "1 1 55%" }}>{timelinePanel}</div>
            <div style={{ flex: "1 1 45%" }}>{chartPanel}</div>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
          <div style={{ flex: "0 0 58%", display: "flex", flexDirection: "column" }}>{globePanel}</div>
          <div style={{ flex: "0 0 42%", display: "flex", flexDirection: "column" }}>{timelinePanel}</div>
        </div>
      )}

      <SectionDivider label="Operational Intelligence" />

      {/* Row 2: Risk Matrix + HFACS */}
      {isSmall ? (
        <>{riskMatrixPanel}{hfacsPanel}</>
      ) : (
        <div style={{ display: "flex", gap: 14 }}>
          <div style={{ flex: "1 1 55%" }}>{riskMatrixPanel}</div>
          <div style={{ flex: "1 1 45%" }}>{hfacsPanel}</div>
        </div>
      )}

      {/* Row 3: 24h chart (desktop only shown here; tablet already rendered above) */}
      {!isTablet && chartPanel}

      {/* Row 4: Temporal heatmap (too wide for mobile) */}
      {!isMobile && heatmapPanel}

      <SectionDivider label="Pattern Analysis" />

      {/* Row 5: Violation type + Readback quality */}
      {isSmall ? (
        <>{typePanel}{readbackPanel}</>
      ) : (
        <div style={{ display: "flex", gap: 14 }}>
          <div style={{ flex: "1 1 55%" }}>{typePanel}</div>
          <div style={{ flex: "1 1 45%" }}>{readbackPanel}</div>
        </div>
      )}

      {/* Row 6: Repeat callsigns + Top regulations */}
      {isSmall ? (
        <>{repeatCallsignsPanel}{regsPanel}</>
      ) : (
        <div style={{ display: "flex", gap: 14 }}>
          <div style={{ flex: "1 1 55%" }}>{repeatCallsignsPanel}</div>
          <div style={{ flex: "1 1 45%" }}>{regsPanel}</div>
        </div>
      )}

      <SectionDivider label="Airport Summary" />

      {/* Row 7: Airport detail cards */}
      {airportPanel}
    </div>
  );
}
