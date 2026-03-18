import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface Stats {
  total_chunks_analyzed: number;
  non_compliant_chunks: number;
  compliance_rate: number;
  violation_type_breakdown: Record<string, number>;
  hfacs_breakdown: Record<string, number>;
  severity_breakdown: Record<string, number>;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ff4444",
  high: "#ff8800",
  medium: "#ffcc00",
  low: "#44aaff",
};

export function StatsPanel({ stats }: { stats: Stats | null }) {
  if (!stats) return null;

  const violationData = Object.entries(stats.violation_type_breakdown).map(([name, count]) => ({
    name: name.replace(" ", "\n"),
    count,
  }));

  const hfacsData = Object.entries(stats.hfacs_breakdown).map(([name, count]) => ({ name, count }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {[
          { label: "Chunks Analyzed", value: stats.total_chunks_analyzed },
          { label: "Violations Found", value: stats.non_compliant_chunks },
          { label: "Compliance Rate", value: `${stats.compliance_rate}%` },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 8,
            padding: "12px 16px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#e6edf3" }}>{value}</div>
            <div style={{ fontSize: 12, color: "#8b949e", marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Severity breakdown */}
      <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
        <h3 style={{ fontSize: 13, color: "#8b949e", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
          Severity Breakdown
        </h3>
        <div style={{ display: "flex", gap: 10 }}>
          {Object.entries(stats.severity_breakdown).map(([sev, count]) => (
            <div key={sev} style={{
              flex: 1,
              background: "#0d1117",
              border: `1px solid ${SEVERITY_COLORS[sev] ?? "#888"}`,
              borderRadius: 6,
              padding: "8px 12px",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: SEVERITY_COLORS[sev] }}>{String(count)}</div>
              <div style={{ fontSize: 11, color: "#8b949e", textTransform: "capitalize" }}>{sev}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Violation type chart */}
      {violationData.length > 0 && (
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
          <h3 style={{ fontSize: 13, color: "#8b949e", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            Violation Types
          </h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={violationData} layout="vertical" margin={{ left: 100 }}>
              <XAxis type="number" tick={{ fill: "#8b949e", fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: "#8b949e", fontSize: 11 }} width={100} />
              <Tooltip
                contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 6 }}
                labelStyle={{ color: "#e6edf3" }}
              />
              <Bar dataKey="count" fill="#388bfd" radius={3} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* HFACS chart */}
      {hfacsData.length > 0 && (
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
          <h3 style={{ fontSize: 13, color: "#8b949e", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            HFACS Categories
          </h3>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={hfacsData} layout="vertical" margin={{ left: 140 }}>
              <XAxis type="number" tick={{ fill: "#8b949e", fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: "#8b949e", fontSize: 11 }} width={140} />
              <Tooltip
                contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 6 }}
                labelStyle={{ color: "#e6edf3" }}
              />
              <Bar dataKey="count" fill="#3fb950" radius={3} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
