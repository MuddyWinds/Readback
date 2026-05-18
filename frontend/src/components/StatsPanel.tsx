import React, { useState, useEffect, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { AnalysisResult, getCardSeverity } from "./LiveFeed";

const API_BASE = "http://localhost:8000";
const KNOWN_AIRPORTS = new Set(["KJFK", "KATL", "VHHH", "KLAX", "KORD"]);

// ── Types ─────────────────────────────────────────────────────────────────────

interface AirportRow { critical: number; high: number; medium: number; low: number; checked: number; }
interface ViolationDetail { count: number; critical: number; high: number; medium: number; low: number; top_airport: string | null; }
interface Stats {
  total_chunks_analyzed: number;
  assessable_chunks: number;
  unassessable_chunks: number;
  non_compliant_chunks: number;
  compliance_rate: number | null;
  severity_breakdown: Record<string, number>;
  airport_compliance: Record<string, number | null>;
  airport_risk_matrix: Record<string, AirportRow>;
  violation_type_details: Record<string, ViolationDetail>;
}

// ── Expert knowledge — hardcoded per violation type ───────────────────────────

interface ViolationIntel {
  implication: string;
  prevention: string[];
  typical_hfacs: string[];
  regulation: string;
  risk_weight: number;  // 1–5, used for sorting and risk score
}

const VIOLATION_INTEL: Record<string, ViolationIntel> = {
  "Runway Incursion": {
    implication: "Highest-risk category. Any unauthorised entry onto a protected runway creates collision potential between landing and departing aircraft. Even low-severity Category D incidents mandate formal investigation.",
    prevention: [
      "Enforce strict hold-short phraseology — no ambiguous taxi instructions near active runways",
      "Require explicit runway-crossing clearance and read-back for every surface movement",
      "Brief flight crews on airport hot spots at complex layouts (e.g. KJFK 13R/31L intersection)",
    ],
    typical_hfacs: ["Unsafe Act", "Precondition"],
    regulation: "FAA AC 150/5210-20A · ICAO Doc 9870",
    risk_weight: 5,
  },
  "Runway Excursion": {
    implication: "Aircraft departing the runway surface during landing or takeoff roll. Collision risk with runway infrastructure, drainage structures, or adjacent taxiway traffic.",
    prevention: [
      "Ensure runway condition reports (RCR/RCAM) are current before each operation",
      "Verify declared landing distance vs available runway — especially with contamination",
      "Confirm rejected-takeoff decision speeds briefed and within limits",
    ],
    typical_hfacs: ["Unsafe Act", "Precondition"],
    regulation: "FAA AC 91-79B · ICAO Annex 6 Part I",
    risk_weight: 4,
  },
  "Altitude Deviation": {
    implication: "Non-adherence to a cleared altitude creates vertical separation loss. Risk of mid-air collision is acute during busy approach/departure transitions and in RVSM airspace.",
    prevention: [
      "Cross-check all altitude clearances: issued → read-back → Mode C confirmation",
      "Challenge any Mode C deviation of ≥300 ft from cleared altitude immediately",
      "Coordinate level-busts across adjacent sectors before they compound",
    ],
    typical_hfacs: ["Unsafe Act"],
    regulation: "14 CFR 91.123 · ICAO Doc 4444 §8.6",
    risk_weight: 4,
  },
  "Speed Deviation": {
    implication: "Non-compliance with speed restrictions reduces ATC's ability to maintain traffic separation. Critical during approach sequencing when aircraft are within 3 nm of each other.",
    prevention: [
      "Confirm all speed assignments are read back with acknowledgement",
      "Monitor radar groundspeed; query abnormal deceleration patterns before wake turbulence builds",
      "Coordinate speed requirements explicitly during sector boundary handoffs",
    ],
    typical_hfacs: ["Unsafe Act", "Precondition"],
    regulation: "14 CFR 91.117 · ICAO Doc 4444 §7.10",
    risk_weight: 3,
  },
  "Read-back Error": {
    implication: "An uncorrected read-back error means the crew will execute the wrong clearance believing it is correct. This is a direct precursor to altitude busts, runway incursions, and wrong-runway operations.",
    prevention: [
      "Controllers must challenge every incomplete or incorrect read-back — silence is not acceptance",
      "Track read-back error rate by frequency/sector to identify high-workload hotspots",
      "Reinforce ICAO standard phraseology in recurrent training — non-standard phrases degrade accuracy",
    ],
    typical_hfacs: ["Unsafe Act"],
    regulation: "ICAO Doc 9432 §5.4 · FAA JO 7110.65 §2-4-3",
    risk_weight: 3,
  },
  "Frequency/Channel Error": {
    implication: "An aircraft on the wrong frequency is invisible to ATC — it cannot receive instructions, cannot be warned of traffic, and adjacent controllers may issue conflicting clearances without knowing.",
    prevention: [
      "Verify callsign confirmation on every sector handoff before releasing the aircraft",
      "Establish and brief lost-comms squawk (7600) and navigation procedures proactively",
      "Monitor guard frequency (121.5 / 243.0) for misrouted aircraft",
    ],
    typical_hfacs: ["Unsafe Act", "Precondition"],
    regulation: "14 CFR 91.183 · ICAO Annex 10 Vol II §8.2",
    risk_weight: 3,
  },
  "CFIT Risk": {
    implication: "Controlled Flight Into Terrain is historically responsible for the greatest number of hull-loss accidents with fatalities. Terrain clearance loss during IMC or night operations can be irrecoverable in seconds.",
    prevention: [
      "Verify minimum safe altitudes (MSA) are observed on all instrument approaches",
      "GPWS/TAWS alerts must be actioned immediately — never disregard or delay response",
      "Confirm instrument approach procedures reflect current NOTAM and terrain data",
    ],
    typical_hfacs: ["Unsafe Act", "Precondition", "Unsafe Supervision"],
    regulation: "ICAO Annex 6 §3.6 · FAA AC 25-23",
    risk_weight: 5,
  },
  "TCAS Non-compliance": {
    implication: "TCAS Resolution Advisories are the last automated barrier before a mid-air collision. Ignoring or delaying an RA response negates the entire ACAS safety layer.",
    prevention: [
      "Reinforce in recurrent training: TCAS RA takes absolute priority over ATC instructions",
      "ATC must suspend conflicting instructions and remain silent during active RA",
      "Document and report every RA encounter for safety data aggregation",
    ],
    typical_hfacs: ["Unsafe Act"],
    regulation: "14 CFR 91.221 · ICAO Doc 8168 PANS-OPS §3.3",
    risk_weight: 5,
  },
  "Go-around Non-compliance": {
    implication: "Failure to execute an issued go-around creates runway occupancy conflict and approach path incursion. When combined with an unstabilised approach, the fatality risk is substantially elevated.",
    prevention: [
      "Issue go-around instructions with sufficient notice — not as aircraft crosses threshold",
      "Require acknowledgement before issuing further clearances",
      "Monitor approach stability indicators: if not stable by 1000 ft AAL, initiate go-around",
    ],
    typical_hfacs: ["Unsafe Act", "Precondition"],
    regulation: "14 CFR 91.175 · ICAO Doc 4444 §7.9",
    risk_weight: 4,
  },
  "Navigation Error": {
    implication: "An aircraft deviating from its cleared route creates uncontrolled airspace penetration and unexpected separation loss. Particularly hazardous in congested terminal areas.",
    prevention: [
      "Verify navigation database currency before each flight — AIRAC cycle compliance",
      "Require explicit waypoint read-back on complex re-clearances",
      "Monitor radar track against filed/cleared route; query deviations >1 nm promptly",
    ],
    typical_hfacs: ["Unsafe Act", "Precondition"],
    regulation: "14 CFR 91.181 · ICAO Annex 2 §3.6",
    risk_weight: 3,
  },
  "Communication Failure": {
    implication: "Loss of two-way communication removes ATC's ability to direct the aircraft. Uncoordinated movements in controlled airspace follow lost-comms procedures that may not be current or crew-briefed.",
    prevention: [
      "Brief lost-comms squawk (7600) and navigation procedures at every pre-departure stage",
      "Ensure backup frequencies and relay procedures are established for remote/oceanic sectors",
      "Confirm equipment serviceability in pre-departure checks — do not accept borderline radios",
    ],
    typical_hfacs: ["Precondition", "Unsafe Supervision"],
    regulation: "14 CFR 91.185 · ICAO Doc 4444 §15.2",
    risk_weight: 3,
  },
  "Fuel Mismanagement": {
    implication: "A fuel emergency requires immediate ATC priority. Holding, route extensions, or missed approaches without fuel reassessment can leave an aircraft with insufficient reserves for a divert.",
    prevention: [
      "Track declared endurance on all flights in holding — challenge if holding exceeds planned time",
      "Coordinate diversion options with airline ops early, before minimum fuel is declared",
      "Validate fuel declarations against actual routing and expected delays at destination",
    ],
    typical_hfacs: ["Unsafe Supervision", "Organizational Influence"],
    regulation: "14 CFR 91.151 · ICAO Annex 6 §4.3.6",
    risk_weight: 4,
  },
  "Other": {
    implication: "Unclassified safety deviation. Requires manual review to apply correct violation taxonomy and determine regulatory applicability.",
    prevention: [
      "Assign to senior safety analyst for correct categorisation",
      "Document for trend analysis even if below individual action threshold",
      "Flag for supervisor review if transcript excerpt suggests escalation potential",
    ],
    typical_hfacs: ["Unsafe Act"],
    regulation: "Review applicable 14 CFR Part 91 / ICAO Annex provisions",
    risk_weight: 1,
  },
};

const HFACS_MEANING: Record<string, string> = {
  "Unsafe Act":               "Direct error or wilful violation by the flight crew or controller — individual-level intervention needed",
  "Precondition":             "Environmental, physiological, or crew condition that enabled the error — systems and environment review needed",
  "Unsafe Supervision":       "Inadequate oversight or assignment by supervisors — management-level review needed",
  "Organizational Influence": "Policy, culture, or resource allocation failure at the organisation level — executive intervention needed",
};

const HFACS_ORDER = ["Unsafe Act", "Precondition", "Unsafe Supervision", "Organizational Influence"];

// ── Colours ───────────────────────────────────────────────────────────────────

const SEV: Record<string, string> = { critical: "#ff4444", high: "#ff8800", medium: "#e3b341", low: "#44aaff", standard: "#3fb950" };
const SEVERITIES = ["critical", "high", "medium", "low"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = { background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: "16px 18px" };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "#484f58", letterSpacing: 1.2, textTransform: "uppercase" };

function riskScore(row: AirportRow): number {
  return row.checked > 0
    ? Math.round(((row.critical * 5 + row.high * 3 + row.medium * 2 + row.low) / row.checked) * 100)
    : 0;
}

// ── Sub-components ─────────────────────────────────────────────────────────────


function SeverityBar({ critical, high, medium, low }: { critical: number; high: number; medium: number; low: number }) {
  const total = critical + high + medium + low;
  if (total === 0) return null;
  const segs = [
    { key: "critical", count: critical },
    { key: "high", count: high },
    { key: "medium", count: medium },
    { key: "low", count: low },
  ].filter(s => s.count > 0);
  return (
    <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", gap: 1, marginTop: 8 }}>
      {segs.map(s => (
        <div key={s.key} title={`${s.key}: ${s.count}`} style={{
          flex: s.count / total, background: SEV[s.key],
        }} />
      ))}
    </div>
  );
}

// ── Violation Intelligence Card ────────────────────────────────────────────────

function ViolationIntelCard({
  type, detail, examples, hfacsActual,
}: {
  type: string;
  detail: ViolationDetail;
  examples: { excerpt: string; airport: string; description: string }[];
  hfacsActual: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const intel = VIOLATION_INTEL[type] ?? VIOLATION_INTEL["Other"];
  const topSev = detail.critical > 0 ? "critical" : detail.high > 0 ? "high" : detail.medium > 0 ? "medium" : "low";
  const borderColor = SEV[topSev];
  const labelColor = ["medium", "low"].includes(topSev) ? "#0d1117" : "#fff";

  // Detect HFACS divergence — actual distribution differs from typical
  const actualLevels = Object.entries(hfacsActual).filter(([, c]) => c > 0).map(([l]) => l);
  const divergent = actualLevels.filter(l => !intel.typical_hfacs.includes(l));

  return (
    <div style={{
      background: "#0d1117",
      border: `1px solid ${open ? borderColor + "44" : "#21262d"}`,
      borderLeft: `3px solid ${borderColor}`,
      borderRadius: "0 8px 8px 0",
    }}>
      {/* ── Header row ── */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{ padding: "13px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3" }}>{type}</span>
            <span style={{ fontSize: 10, fontWeight: 700, background: borderColor, color: labelColor, padding: "2px 8px", borderRadius: 10 }}>
              ×{detail.count}
            </span>
            {detail.top_airport && (
              <span style={{ fontSize: 11, color: "#484f58", fontFamily: "monospace", background: "#161b22", border: "1px solid #21262d", padding: "1px 6px", borderRadius: 4 }}>
                ▲ {detail.top_airport}
              </span>
            )}
            {divergent.length > 0 && (
              <span style={{ fontSize: 10, color: "#e3b341", border: "1px solid #e3b34133", padding: "1px 6px", borderRadius: 4 }}>
                ⚠ Atypical causal pattern
              </span>
            )}
          </div>
          <SeverityBar critical={detail.critical} high={detail.high} medium={detail.medium} low={detail.low} />
        </div>
        <span style={{ fontSize: 11, color: "#484f58", marginLeft: 12, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${borderColor}22` }}>

          {/* Safety Implication */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #21262d", background: `${borderColor}08` }}>
            <div style={{ ...label, marginBottom: 6 }}>Safety Implication</div>
            <p style={{ fontSize: 13, color: "#e6edf3", margin: 0, lineHeight: 1.7 }}>{intel.implication}</p>
          </div>

          {/* HFACS: typical vs actual */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #21262d" }}>
            <div style={{ ...label, marginBottom: 10 }}>Causal Layer Analysis (HFACS)</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
              {HFACS_ORDER.map(level => {
                const isTypical = intel.typical_hfacs.includes(level);
                const actualCount = hfacsActual[level] ?? 0;
                const isDivergent = actualCount > 0 && !isTypical;
                return (
                  <div key={level} style={{
                    padding: "6px 10px", borderRadius: 6,
                    border: `1px solid ${isDivergent ? "#e3b341" : isTypical ? "#30363d" : "#21262d"}`,
                    background: isDivergent ? "#1f1a0d" : isTypical ? "#161b22" : "transparent",
                    opacity: !isTypical && actualCount === 0 ? 0.4 : 1,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: isDivergent ? "#e3b341" : isTypical ? "#8b949e" : "#484f58" }}>
                      {level} {actualCount > 0 ? `(${actualCount})` : ""}
                      {isDivergent ? " ⚠" : isTypical ? " ✓" : ""}
                    </div>
                  </div>
                );
              })}
            </div>
            {divergent.length > 0 && (
              <p style={{ fontSize: 11, color: "#e3b341", margin: 0, lineHeight: 1.6 }}>
                This session shows violations at <strong>{divergent.join(", ")}</strong> level — atypical for this violation type. This may indicate a systemic or organisational contributor beyond individual crew error.
              </p>
            )}
          </div>

          {/* Prevention */}
          <div style={{ padding: "14px 16px", borderBottom: examples.length > 0 ? "1px solid #21262d" : "none" }}>
            <div style={{ ...label, marginBottom: 10 }}>Prevention Actions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {intel.prevention.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span style={{ color: borderColor, fontSize: 13, flexShrink: 0, fontWeight: 700 }}>—</span>
                  <span style={{ fontSize: 13, color: "#c9d1d9", lineHeight: 1.6 }}>{p}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: "#484f58" }}>
              Ref: <span style={{ fontFamily: "monospace", color: "#6e7681" }}>{intel.regulation}</span>
            </div>
          </div>

          {/* Session evidence */}
          {examples.length > 0 && (
            <div style={{ padding: "14px 16px" }}>
              <div style={{ ...label, marginBottom: 10 }}>Evidence from This Session</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {examples.slice(0, 3).map((ex, i) => (
                  <div key={i} style={{
                    background: `${borderColor}0d`,
                    border: `1px solid ${borderColor}33`,
                    borderLeft: `3px solid ${borderColor}`,
                    borderRadius: "0 6px 6px 0",
                    padding: "9px 12px",
                  }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 5, alignItems: "center" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, background: "#21262d", color: "#e6edf3", padding: "1px 6px", borderRadius: 4, fontFamily: "monospace" }}>
                        {ex.airport}
                      </span>
                    </div>
                    {ex.excerpt && (
                      <div style={{ fontSize: 12, fontFamily: "'SF Mono','Fira Code',monospace", color: "#ffa657", fontStyle: "italic", lineHeight: 1.6, marginBottom: 5 }}>
                        "{ex.excerpt}"
                      </div>
                    )}
                    <p style={{ fontSize: 12, color: "#8b949e", margin: 0, lineHeight: 1.6 }}>{ex.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  results: AnalysisResult[];
  dateFilter: string;
  getStartDate: (f: any) => string | null;
}

export function StatsPanel({ results: rawResults, dateFilter, getStartDate }: Props) {
  const results = rawResults.filter(r => KNOWN_AIRPORTS.has(r.airport_code));
  const [stats, setStats] = useState<Stats | null>(null);
  const [airports, setAirports] = useState<string[]>([]);
  const [airportFilter, setAirportFilter] = useState("all");

  useEffect(() => {
    fetch(`${API_BASE}/api/airports`)
      .then(r => r.json())
      .then((all: string[]) => setAirports(all.filter(a => KNOWN_AIRPORTS.has(a))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (airportFilter !== "all") params.set("airport", airportFilter);
    const sd = getStartDate(dateFilter);
    if (sd) params.set("start_date", sd);
    fetch(`${API_BASE}/api/stats?${params}`).then(r => r.json()).then(setStats).catch(() => {});
  }, [airportFilter, dateFilter, getStartDate]);

  // ── Derived data from results ──────────────────────────────────────────────

  // HFACS breakdown per violation type
  const hfacsByType = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    results.forEach(r => {
      r.observations?.forEach((v) => {
        if (!map[v.note_type]) map[v.note_type] = {};
        map[v.note_type][v.hfacs_level] = (map[v.note_type][v.hfacs_level] ?? 0) + 1;
      });
    });
    return map;
  }, [results]);

  // Overall HFACS distribution
  const hfacsTotal = useMemo(() => {
    const counts: Record<string, number> = {};
    results.forEach(r => {
      r.observations?.forEach((v) => {
        counts[v.hfacs_level] = (counts[v.hfacs_level] ?? 0) + 1;
      });
    });
    return counts;
  }, [results]);

  // Regulation citation details — count, severity split, contributing violation types, airports
  const regulationDetails = useMemo(() => {
    type RegRow = { count: number; critical: number; high: number; medium: number; low: number; types: Record<string, number>; airports: Set<string> };
    const map: Record<string, RegRow> = {};
    results.forEach(r => {
      r.observations?.forEach((v) => {
        if (!v.relevant_regulation) return;
        const doc = v.relevant_regulation.split(",")[0].trim();
        if (!map[doc]) map[doc] = { count: 0, critical: 0, high: 0, medium: 0, low: 0, types: {}, airports: new Set() };
        map[doc].count++;
        const sev = v.significance as keyof RegRow;
        if (sev === "critical" || sev === "high" || sev === "medium" || sev === "low") map[doc][sev]++;
        map[doc].types[v.note_type] = (map[doc].types[v.note_type] ?? 0) + 1;
        map[doc].airports.add(r.airport_code);
      });
    });
    return Object.entries(map)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([reg, d]) => ({ reg, ...d, topTypes: Object.entries(d.types).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t) }));
  }, [results]);

  // Per-violation-type: gather transcript excerpts + descriptions for evidence
  const violationExamples = useMemo(() => {
    const map: Record<string, { excerpt: string; airport: string; description: string }[]> = {};
    results.forEach(r => {
      r.observations?.forEach((v) => {
        if (!map[v.note_type]) map[v.note_type] = [];
        if (map[v.note_type].length < 3) {
          map[v.note_type].push({
            excerpt: v.transcript_excerpt ?? "",
            airport: r.airport_code,
            description: v.description ?? "",
          });
        }
      });
    });
    return map;
  }, [results]);

  // Sorted violation types by risk score
  const sortedViolations = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.violation_type_details)
      .map(([type, d]) => ({
        type, ...d,
        score: (d.critical * 5 + d.high * 3 + d.medium * 2 + d.low) * (VIOLATION_INTEL[type]?.risk_weight ?? 1),
      }))
      .sort((a, b) => b.score - a.score);
  }, [stats]);

  // Sorted airports by risk score
  const sortedAirports = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.airport_risk_matrix)
      .map(([code, row]) => ({ code, row, rate: stats.airport_compliance[code] ?? 100, score: riskScore(row) }))
      .sort((a, b) => b.score - a.score);
  }, [stats]);

  // Invert hfacsByType → for each HFACS level, which violation types contribute
  const violationsByHFACS = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    Object.entries(hfacsByType).forEach(([violType, levels]) => {
      Object.entries(levels).forEach(([level, count]) => {
        if (!map[level]) map[level] = {};
        map[level][violType] = (map[level][violType] ?? 0) + (count as number);
      });
    });
    return map;
  }, [hfacsByType]);

  // Violation types per airport (from results)
  const violationsByAirport = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    results.forEach(r => {
      if (!map[r.airport_code]) map[r.airport_code] = {};
      r.observations?.forEach((v) => {
        map[r.airport_code][v.note_type] = (map[r.airport_code][v.note_type] ?? 0) + 1;
      });
    });
    return map;
  }, [results]);

  // Dominant HFACS level per airport
  const hfacsByAirport = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    results.forEach(r => {
      if (!map[r.airport_code]) map[r.airport_code] = {};
      r.observations?.forEach((v) => {
        map[r.airport_code][v.hfacs_level] = (map[r.airport_code][v.hfacs_level] ?? 0) + 1;
      });
    });
    return map;
  }, [results]);

  // KPI derivations
  const criticalHighCount = (stats?.severity_breakdown?.critical ?? 0) + (stats?.severity_breakdown?.high ?? 0);
  const airportsAtRisk = sortedAirports.filter(a => a.rate < 80).length;
  const hfacsMax = Math.max(...Object.values(hfacsTotal), 1);
  const totalViolations = Object.values(hfacsTotal).reduce((a, b) => a + b, 0);

  // Session status
  const statusInfo = (() => {
    if (!stats) return { label: "—", color: "#484f58", message: "" };
    const cr = stats.compliance_rate;
    if (cr === null) return { label: "NO DATA", color: "#484f58", message: "No assessable transmissions yet" };
    const ch = criticalHighCount;
    if (ch > 3 || cr < 75) return { label: "CRITICAL", color: "#ff4444", message: `${ch} high-priority violations require immediate escalation` };
    if (ch > 0 || cr < 90) return { label: "ELEVATED RISK", color: "#ff8800", message: `${ch} high-priority violation${ch !== 1 ? "s" : ""} detected — formal documentation required` };
    if (cr < 95) return { label: "NOMINAL", color: "#e3b341", message: "Minor deviations detected — continue monitoring" };
    return { label: "CLEAR", color: "#3fb950", message: "No significant violations in current session" };
  })();

  // ── 24-hour activity chart data ───────────────────────────────────────────
  const hourlyData = useMemo(() => {
    const now  = new Date();
    const bins: Record<number, { hour: string; critical: number; high: number; medium: number; low: number; standard: number }> = {};
    for (let h = 23; h >= 0; h--) {
      const t = new Date(now.getTime() - h * 3600000);
      bins[h]  = {
        hour:     `${String(t.getUTCHours()).padStart(2, "0")}:00`,
        critical: 0, high: 0, medium: 0, low: 0, standard: 0,
      };
    }
    results.forEach(r => {
      const age = (now.getTime() - new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z").getTime()) / 3600000;
      const h   = Math.floor(age);
      if (h < 0 || h > 23) return;
      const bin = bins[h];
      if (!bin) return;
      const sev = getCardSeverity(r);
      if (sev === "unassessable") return;
      (bin as any)[sev] = ((bin as any)[sev] ?? 0) + 1;
    });
    return Object.values(bins).reverse();
  }, [results]);

  const selectSt: React.CSSProperties = {
    background: "#0d1117", color: "#e6edf3",
    border: "1px solid #30363d", borderRadius: 6,
    padding: "4px 10px", fontSize: 12, cursor: "pointer",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Filter ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, color: "#8b949e" }}>Airport</span>
        <select value={airportFilter} onChange={e => setAirportFilter(e.target.value)} style={selectSt}>
          <option value="all">All airports</option>
          {airports.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* ── 24h Activity Chart ── */}
      <div style={{ ...card, padding: "16px 18px" }}>
        <div style={{ ...label, marginBottom: 14 }}>Violation Activity — Last 24 Hours</div>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={hourlyData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <defs>
              {(["critical","high","medium","low","standard"] as const).map(sev => (
                <linearGradient key={sev} id={`g-${sev}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={SEV[sev] ?? "#3fb950"} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={SEV[sev] ?? "#3fb950"} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
            <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#484f58" }} tickLine={false} axisLine={false} interval={3} />
            <YAxis tick={{ fontSize: 9, fill: "#484f58" }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 6, fontSize: 11 }}
              labelStyle={{ color: "#8b949e" }}
              itemStyle={{ color: "#e6edf3" }}
            />
            {(["critical","high","medium","low","standard"] as const).map(sev => (
              <Area
                key={sev} type="monotone" dataKey={sev}
                stroke={SEV[sev] ?? "#3fb950"} strokeWidth={1.5}
                fill={`url(#g-${sev})`}
                stackId="1"
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {!stats ? (
        <p style={{ color: "#8b949e", textAlign: "center", marginTop: 40 }}>Loading statistics…</p>
      ) : (
        <>
          {/* ── 1. SITUATION REPORT ── */}
          {/* Wide status card */}
          <div style={{ ...card, padding: 0, overflow: "hidden", display: "flex" }}>
            {/* Status */}
            <div style={{
              padding: "18px 20px", minWidth: 170, flexShrink: 0,
              borderRight: "1px solid #21262d",
              background: `${statusInfo.color}0a`,
            }}>
              <div style={{ ...label, marginBottom: 10 }}>Session Status</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: statusInfo.color, boxShadow: `0 0 8px ${statusInfo.color}88`, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: statusInfo.color, letterSpacing: 0.3 }}>{statusInfo.label}</span>
              </div>
              <p style={{ fontSize: 11, color: "#8b949e", margin: 0, lineHeight: 1.6 }}>{statusInfo.message}</p>
            </div>

            {/* Compliance Rate */}
            <div style={{ padding: "18px 24px", flexShrink: 0, width: 240, borderRight: "1px solid #21262d" }}>
              <div style={{ ...label, marginBottom: 8 }}>Compliance Rate</div>
              {stats.compliance_rate === null ? (
                <div style={{ fontSize: 13, color: "#484f58", fontStyle: "italic" }}>No assessable data yet</div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
                    <span style={{
                      fontSize: 36, fontWeight: 700, lineHeight: 1,
                      color: stats.compliance_rate >= 90 ? "#3fb950" : stats.compliance_rate >= 75 ? "#e3b341" : "#ff4444",
                    }}>
                      {stats.compliance_rate}%
                    </span>
                    <span style={{ fontSize: 11, color: "#484f58" }}>target 90%</span>
                  </div>
                  <div style={{ position: "relative", marginBottom: 8 }}>
                    <div style={{ background: "#21262d", borderRadius: 3, height: 7 }}>
                      <div style={{
                        width: `${Math.min(stats.compliance_rate, 100)}%`,
                        background: stats.compliance_rate >= 90 ? "#3fb950" : stats.compliance_rate >= 75 ? "#e3b341" : "#ff4444",
                        height: "100%", borderRadius: 3,
                      }} />
                    </div>
                    <div style={{ position: "absolute", left: "90%", top: -3, width: 2, height: 13, background: "#484f58", borderRadius: 1 }} />
                  </div>
                  <div style={{ fontSize: 11, color: "#484f58" }}>
                    {stats.non_compliant_chunks} violations / {stats.assessable_chunks ?? stats.total_chunks_analyzed} assessable tx
                  </div>
                  {(stats.unassessable_chunks ?? 0) > 0 && (
                    <div style={{ fontSize: 11, color: "#3a3f47", marginTop: 4 }}>
                      + {stats.unassessable_chunks} unassessable (excluded)
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Violation breakdown */}
            <div style={{ padding: "18px 20px", flex: 1 }}>
              <div style={{ ...label, marginBottom: 10 }}>Violation Breakdown</div>
              <div style={{ display: "flex", height: 10, borderRadius: 4, overflow: "hidden", gap: 1, marginBottom: 12 }}>
                {SEVERITIES.filter(s => (stats.severity_breakdown[s] ?? 0) > 0).map(s => {
                  const total = SEVERITIES.reduce((a, sv) => a + (stats.severity_breakdown[sv] ?? 0), 0);
                  return (
                    <div key={s} title={`${s}: ${stats.severity_breakdown[s]}`} style={{
                      flex: (stats.severity_breakdown[s] ?? 0) / total,
                      background: SEV[s],
                    }} />
                  );
                })}
                {SEVERITIES.every(s => (stats.severity_breakdown[s] ?? 0) === 0) && (
                  <div style={{ flex: 1, background: "#3fb950" }} />
                )}
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {SEVERITIES.map(s => {
                  const count = stats.severity_breakdown[s] ?? 0;
                  return (
                    <div key={s} style={{ opacity: count === 0 ? 0.3 : 1 }}>
                      <span style={{ fontSize: 20, fontWeight: 700, color: SEV[s], lineHeight: 1 }}>{count}</span>
                      <span style={{ fontSize: 10, color: "#484f58", marginLeft: 4, textTransform: "uppercase" }}>{s}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 3 action cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {/* Immediate Attention */}
            <div style={card}>
              <div style={{ ...label, marginBottom: 12 }}>Immediate Attention</div>
              {criticalHighCount === 0 ? (
                <p style={{ fontSize: 12, color: "#3fb950", margin: 0, lineHeight: 1.6 }}>No immediate action required</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {(stats.severity_breakdown.critical ?? 0) > 0 && (
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 24, fontWeight: 700, color: "#ff4444", lineHeight: 1, flexShrink: 0 }}>
                        {stats.severity_breakdown.critical}
                      </span>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#ff4444" }}>CRITICAL</div>
                        <div style={{ fontSize: 11, color: "#8b949e" }}>Notify supervisor immediately</div>
                      </div>
                    </div>
                  )}
                  {(stats.severity_breakdown.high ?? 0) > 0 && (
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 24, fontWeight: 700, color: "#ff8800", lineHeight: 1, flexShrink: 0 }}>
                        {stats.severity_breakdown.high}
                      </span>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#ff8800" }}>HIGH</div>
                        <div style={{ fontSize: 11, color: "#8b949e" }}>File documentation by end of shift</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Leading Pattern */}
            <div style={card}>
              <div style={{ ...label, marginBottom: 12 }}>Leading Pattern</div>
              {sortedViolations[0] ? (
                <>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3", margin: "0 0 5px", lineHeight: 1.4 }}>
                    {sortedViolations[0].type}
                  </p>
                  <p style={{ fontSize: 11, color: "#8b949e", margin: "0 0 6px" }}>
                    ×{sortedViolations[0].count} occurrence{sortedViolations[0].count !== 1 ? "s" : ""}
                    {sortedViolations[0].top_airport ? ` · most at ${sortedViolations[0].top_airport}` : ""}
                  </p>
                  {VIOLATION_INTEL[sortedViolations[0].type] && (
                    <p style={{ fontSize: 11, color: "#484f58", margin: 0, lineHeight: 1.5 }}>
                      Typical cause: {VIOLATION_INTEL[sortedViolations[0].type].typical_hfacs[0]}
                    </p>
                  )}
                </>
              ) : (
                <p style={{ fontSize: 12, color: "#484f58", margin: 0 }}>No violations recorded</p>
              )}
            </div>

            {/* Airport Exposure */}
            <div style={card}>
              <div style={{ ...label, marginBottom: 12 }}>Airport Exposure</div>
              {airportsAtRisk === 0 ? (
                <p style={{ fontSize: 12, color: "#3fb950", margin: 0, lineHeight: 1.6 }}>All airports within 80% threshold</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {sortedAirports.filter(a => a.rate < 80).map(a => (
                    <div key={a.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontFamily: "monospace", color: "#e6edf3", fontWeight: 700 }}>{a.code}</span>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#ff4444" }}>{a.rate}%</span>
                        <span style={{ fontSize: 10, color: "#484f58", marginLeft: 4 }}>compliance</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── 2. VIOLATION INTELLIGENCE ── */}
          {sortedViolations.length > 0 && (
            <div style={card}>
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: "#8b949e", textTransform: "uppercase", letterSpacing: 1, margin: "0 0 4px" }}>
                  Violation Intelligence
                </h3>
                <p style={{ fontSize: 11, color: "#484f58", margin: 0 }}>
                  Sorted by weighted risk · expand each type for safety implications, causal analysis, and prevention actions
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {sortedViolations.map(vd => (
                  <ViolationIntelCard
                    key={vd.type}
                    type={vd.type}
                    detail={vd}
                    examples={violationExamples[vd.type] ?? []}
                    hfacsActual={hfacsByType[vd.type] ?? {}}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── 3. HFACS CAUSAL LAYER ANALYSIS ── */}
          {totalViolations > 0 && (() => {
            const systemicCount = (hfacsTotal["Unsafe Supervision"] ?? 0) + (hfacsTotal["Organizational Influence"] ?? 0);
            const systemicPct = Math.round((systemicCount / totalViolations) * 100);
            const hfacsColors = ["#ff4444", "#ff8800", "#e3b341", "#8b949e"] as const;
            const interventions = [
              "Individual retraining, phraseology review, and competency re-assessment",
              "Equipment checks, crew resource management review, and rest/fatigue audit",
              "Supervisory procedures review, task assignment audit, and workload management",
              "Policy review, resource allocation audit, and safety culture assessment — escalate to executive level",
            ];
            return (
              <div style={card}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: "#8b949e", textTransform: "uppercase", letterSpacing: 1, margin: "0 0 4px" }}>
                  Causal Layer Analysis (HFACS)
                </h3>
                <p style={{ fontSize: 11, color: "#484f58", margin: "0 0 16px" }}>
                  Identifies where in the system errors originate — determines whether intervention must be individual, supervisory, or organisational.
                </p>

                {/* Systemic Risk Index */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 16,
                  padding: "12px 16px", borderRadius: 6, marginBottom: 20,
                  background: systemicPct > 20 ? "#1f1a0d" : systemicPct > 0 ? "#161b22" : "#0d1f12",
                  border: `1px solid ${systemicPct > 20 ? "#e3b34144" : systemicPct > 0 ? "#30363d" : "#23863644"}`,
                }}>
                  <div style={{ flexShrink: 0, textAlign: "center" }}>
                    <div style={{ ...label, marginBottom: 4 }}>Systemic Risk</div>
                    <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, color: systemicPct > 20 ? "#e3b341" : systemicPct > 0 ? "#ff8800" : "#3fb950" }}>
                      {systemicPct}%
                    </div>
                  </div>
                  <div style={{ width: 1, alignSelf: "stretch", background: "#21262d", flexShrink: 0 }} />
                  <p style={{ fontSize: 12, color: "#c9d1d9", margin: 0, lineHeight: 1.7 }}>
                    {systemicPct === 0
                      ? "All violations are individual-level errors. Targeted retraining and phraseology review is the primary intervention."
                      : systemicPct <= 20
                      ? `${systemicCount} violation(s) have supervisory or organisational contributors. Supplement individual retraining with supervisory review.`
                      : `${systemicPct}% of violations originate above the individual level. Individual retraining alone will not resolve the root cause — management escalation is required.`}
                  </p>
                </div>

                {/* 4 HFACS level rows */}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {HFACS_ORDER.map((level, idx) => {
                    const count = hfacsTotal[level] ?? 0;
                    const pct = Math.round((count / totalViolations) * 100);
                    const color = hfacsColors[idx];
                    const isSystemic = idx >= 2;
                    const topViolations = Object.entries(violationsByHFACS[level] ?? {}).sort((a, b) => b[1] - a[1]);
                    return (
                      <div key={level} style={{
                        padding: "16px 0",
                        borderBottom: idx < 3 ? "1px solid #21262d" : "none",
                        opacity: count === 0 ? 0.4 : 1,
                      }}>
                        {/* Header */}
                        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: count > 0 ? 10 : 0 }}>
                          {/* Colored left strip */}
                          <div style={{ width: 4, borderRadius: 2, background: count > 0 ? color : "#30363d", alignSelf: "stretch", flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: count > 0 ? color : "#484f58" }}>{level}</span>
                              {isSystemic && count > 0 && (
                                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.8, color: "#e3b341", border: "1px solid #e3b34133", padding: "1px 5px", borderRadius: 3 }}>
                                  SYSTEMIC
                                </span>
                              )}
                            </div>
                            <p style={{ fontSize: 11, color: "#484f58", margin: 0, lineHeight: 1.5 }}>{HFACS_MEANING[level]}</p>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: count > 0 ? color : "#30363d", lineHeight: 1 }}>{count}</div>
                            <div style={{ fontSize: 11, color: "#484f58" }}>{pct}%</div>
                          </div>
                        </div>

                        {count > 0 && (
                          <div style={{ paddingLeft: 18 }}>
                            {/* Progress bar */}
                            <div style={{ background: "#21262d", borderRadius: 3, height: 5, overflow: "hidden", marginBottom: 10 }}>
                              <div style={{ width: `${(count / hfacsMax) * 100}%`, background: color, height: "100%", borderRadius: 3 }} />
                            </div>
                            {/* Violation type tags */}
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                              {topViolations.map(([type, c]) => (
                                <span key={type} style={{
                                  fontSize: 10, padding: "2px 8px", borderRadius: 4,
                                  background: "#21262d", border: `1px solid ${color}33`, color: "#c9d1d9",
                                }}>
                                  {type} ×{c}
                                </span>
                              ))}
                            </div>
                            {/* Required action */}
                            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.9, color: color, flexShrink: 0, paddingTop: 2 }}>ACTION</span>
                              <span style={{ fontSize: 11, color: "#8b949e", lineHeight: 1.6 }}>{interventions[idx]}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── 4. AIRPORT RISK PROFILES ── */}
          {sortedAirports.length > 0 && (
            <div style={card}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "#8b949e", textTransform: "uppercase", letterSpacing: 1, margin: "0 0 4px" }}>
                Airport Risk Profiles
              </h3>
              <p style={{ fontSize: 11, color: "#484f58", margin: "0 0 16px" }}>
                Risk score = weighted violations per 100 transmissions (Critical ×5, High ×3, Medium ×2, Low ×1) · sorted highest risk first
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {sortedAirports.map(({ code, row, rate, score }) => {
                  const rateColor = rate >= 90 ? "#3fb950" : rate >= 75 ? "#e3b341" : "#ff4444";
                  const topSevColor = row.critical > 0 ? SEV.critical : row.high > 0 ? SEV.high : row.medium > 0 ? SEV.medium : row.low > 0 ? SEV.low : "#3fb950";
                  const totalViol = row.critical + row.high + row.medium + row.low;
                  const topViolations = Object.entries(violationsByAirport[code] ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
                  const dominantHFACS = Object.entries(hfacsByAirport[code] ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
                  const isSystemicAirport = dominantHFACS === "Unsafe Supervision" || dominantHFACS === "Organizational Influence";
                  return (
                    <div key={code} style={{
                      background: "#0d1117",
                      border: `1px solid ${topSevColor}33`,
                      borderLeft: `4px solid ${topSevColor}`,
                      borderRadius: "0 8px 8px 0",
                      padding: "16px 16px",
                    }}>
                      {/* Header: code + compliance */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: "#e6edf3", fontFamily: "monospace", lineHeight: 1 }}>{code}</div>
                          <div style={{ fontSize: 11, color: "#484f58", marginTop: 3 }}>{row.checked} tx checked</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 26, fontWeight: 700, color: rateColor, lineHeight: 1 }}>{rate}%</div>
                          <div style={{ fontSize: 10, color: "#484f58" }}>compliance</div>
                        </div>
                      </div>

                      {/* Severity bar */}
                      <SeverityBar critical={row.critical} high={row.high} medium={row.medium} low={row.low} />

                      {/* Severity counts */}
                      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                        {SEVERITIES.filter(s => row[s] > 0).map(s => (
                          <div key={s}>
                            <span style={{ fontSize: 16, fontWeight: 700, color: SEV[s], lineHeight: 1 }}>{row[s]}</span>
                            <span style={{ fontSize: 10, color: "#484f58", marginLeft: 3 }}>{s}</span>
                          </div>
                        ))}
                        {totalViol === 0 && <span style={{ fontSize: 12, color: "#3fb950" }}>No violations</span>}
                      </div>

                      {/* Top violation types */}
                      {topViolations.length > 0 && (
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #21262d" }}>
                          <div style={{ ...label, marginBottom: 8 }}>Top Violations</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            {topViolations.map(([type, c]) => (
                              <div key={type} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 11, color: "#c9d1d9", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>{type}</span>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#8b949e", flexShrink: 0 }}>×{c}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Risk score + dominant HFACS */}
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #21262d", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                        <div>
                          <div style={{ ...label, marginBottom: 3 }}>Risk Score</div>
                          <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, color: score > 20 ? "#ff4444" : score > 10 ? "#ff8800" : score > 0 ? "#e3b341" : "#3fb950" }}>
                            {score}
                          </div>
                        </div>
                        {dominantHFACS && (
                          <div style={{ textAlign: "right" }}>
                            <div style={{ ...label, marginBottom: 3 }}>Primary Cause</div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: isSystemicAirport ? "#e3b341" : "#8b949e", lineHeight: 1.3 }}>
                              {dominantHFACS}{isSystemicAirport ? " ⚠" : ""}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── 5. REGULATORY CITATIONS ── */}
          {regulationDetails.length > 0 && (
            <div style={card}>
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: "#8b949e", textTransform: "uppercase", letterSpacing: 1, margin: "0 0 4px" }}>
                  Regulatory Exposure
                </h3>
                <p style={{ fontSize: 11, color: "#484f58", margin: 0 }}>
                  Regulations triggered this session with severity breakdown, causal behaviour, and affected airports
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {regulationDetails.map((d, i) => {
                  const maxCount = regulationDetails[0].count;
                  const sevTotal = d.critical + d.high + d.medium + d.low;
                  const dominantSev = d.critical > 0 ? "critical" : d.high > 0 ? "high" : d.medium > 0 ? "medium" : "low";
                  const accentColor = { critical: "#ff4444", high: "#ff8800", medium: "#e3b341", low: "#44aaff" }[dominantSev];
                  return (
                    <div key={d.reg} style={{
                      background: "#0d1117", border: "1px solid #21262d",
                      borderLeft: `3px solid ${accentColor}`,
                      borderRadius: 6, padding: "10px 12px",
                    }}>
                      {/* Row 1: reg ref + count */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: "#c9d1d9" }}>{d.reg}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: accentColor }}>×{d.count}</span>
                      </div>

                      {/* Row 2: stacked severity bar */}
                      <div style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", marginBottom: 8, gap: 1 }}>
                        {(["critical","high","medium","low"] as const).map(sev => {
                          const n = d[sev]; if (!n) return null;
                          const w = `${(n / sevTotal) * 100}%`;
                          const c = { critical: "#ff4444", high: "#ff8800", medium: "#e3b341", low: "#44aaff" }[sev];
                          return <div key={sev} style={{ width: w, background: c, borderRadius: 2 }} title={`${sev}: ${n}`} />;
                        })}
                      </div>

                      {/* Row 3: severity counts + violation types + airports */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
                        {/* Severity micro counts */}
                        <div style={{ display: "flex", gap: 5 }}>
                          {(["critical","high","medium","low"] as const).filter(s => d[s] > 0).map(s => (
                            <span key={s} style={{
                              fontSize: 10, fontWeight: 700,
                              color: { critical: "#ff4444", high: "#ff8800", medium: "#e3b341", low: "#44aaff" }[s],
                            }}>{d[s]}{s[0].toUpperCase()}</span>
                          ))}
                        </div>
                        <div style={{ width: 1, height: 10, background: "#30363d" }} />
                        {/* Top violation types */}
                        {d.topTypes.map(t => (
                          <span key={t} style={{
                            fontSize: 10, color: "#8b949e",
                            background: "#21262d", borderRadius: 3, padding: "1px 6px",
                          }}>{t}</span>
                        ))}
                        <div style={{ flex: 1 }} />
                        {/* Airports */}
                        <div style={{ display: "flex", gap: 3 }}>
                          {Array.from(d.airports).map(a => (
                            <span key={a} style={{
                              fontSize: 10, fontWeight: 700, fontFamily: "monospace",
                              color: "#3fb950", background: "#0d1f12",
                              border: "1px solid #238636", borderRadius: 3, padding: "1px 5px",
                            }}>{a}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
