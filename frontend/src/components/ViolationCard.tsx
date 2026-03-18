import React from "react";

interface Violation {
  violation_type: string;
  hfacs_level: string;
  severity: string;
  description: string;
  relevant_regulation?: string;
  transcript_excerpt?: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#ff4444",
  high: "#ff8800",
  medium: "#ffcc00",
  low: "#44aaff",
};

export function ViolationCard({ v }: { v: Violation }) {
  const color = SEVERITY_COLOR[v.severity] ?? "#888";
  return (
    <div style={{
      border: `1px solid ${color}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 6,
      padding: "10px 14px",
      marginBottom: 10,
      background: "#161b22",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 700, color }}>{v.violation_type}</span>
        <span style={{
          background: color,
          color: "#000",
          padding: "1px 8px",
          borderRadius: 12,
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
        }}>{v.severity}</span>
      </div>
      <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 4 }}>
        HFACS: {v.hfacs_level}
        {v.relevant_regulation && <> &nbsp;·&nbsp; {v.relevant_regulation}</>}
      </div>
      <p style={{ fontSize: 13, color: "#c9d1d9", marginBottom: 4 }}>{v.description}</p>
      {v.transcript_excerpt && (
        <blockquote style={{
          fontSize: 12,
          color: "#8b949e",
          borderLeft: "3px solid #30363d",
          paddingLeft: 8,
          fontStyle: "italic",
        }}>
          "{v.transcript_excerpt}"
        </blockquote>
      )}
    </div>
  );
}
