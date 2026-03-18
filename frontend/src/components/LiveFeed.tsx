import React from "react";
import { formatDistanceToNow } from "date-fns";
import { ViolationCard } from "./ViolationCard";

export interface AnalysisResult {
  timestamp: string;
  airport_code: string;
  transcript: string;
  is_compliant: boolean;
  violations: any[];
  summary: string;
  confidence_score: number;
}

interface Props {
  results: AnalysisResult[];
}

export function LiveFeed({ results }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {results.length === 0 && (
        <p style={{ color: "#8b949e", textAlign: "center", marginTop: 40 }}>
          Waiting for live ATC data...
        </p>
      )}
      {results.map((r, i) => (
        <div key={i} style={{
          background: "#161b22",
          border: `1px solid ${r.is_compliant ? "#238636" : "#da3633"}`,
          borderRadius: 8,
          padding: 16,
        }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{
                background: r.is_compliant ? "#238636" : "#da3633",
                color: "#fff",
                padding: "2px 10px",
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 700,
              }}>
                {r.is_compliant ? "COMPLIANT" : "VIOLATION"}
              </span>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{r.airport_code}</span>
            </div>
            <span style={{ fontSize: 12, color: "#8b949e" }}>
              {formatDistanceToNow(new Date(r.timestamp), { addSuffix: true })}
            </span>
          </div>

          {/* Transcript */}
          <div style={{
            background: "#0d1117",
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 13,
            fontFamily: "monospace",
            color: "#c9d1d9",
            marginBottom: 10,
            whiteSpace: "pre-wrap",
          }}>
            {r.transcript}
          </div>

          {/* Summary */}
          <p style={{ fontSize: 13, color: "#8b949e", marginBottom: r.violations.length ? 10 : 0 }}>
            {r.summary}
          </p>

          {/* Violations */}
          {r.violations.map((v, j) => <ViolationCard key={j} v={v} />)}

          {/* Confidence */}
          <div style={{ fontSize: 11, color: "#484f58", marginTop: 6, textAlign: "right" }}>
            Confidence: {Math.round(r.confidence_score * 100)}%
          </div>
        </div>
      ))}
    </div>
  );
}
