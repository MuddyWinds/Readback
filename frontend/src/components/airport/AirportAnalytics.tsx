import React, { useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AnalysisResult } from "../LiveFeed";
import { getCardSeverity, type Severity } from "../../lib/severity";
import {
  complianceRate,
  detectSpike,
  hfacsCounts,
  hourlyActivity,
  topNoteTypes,
} from "../../lib/analytics";
import styles from "./AirportAnalytics.module.css";

const SEV_COLOR: Record<Severity, string> = {
  standard: "var(--sev-standard, #3fb950)",
  low: "var(--sev-low, #44aaff)",
  medium: "var(--sev-medium, #e3b341)",
  high: "var(--sev-high, #ff8800)",
  critical: "var(--sev-critical, #ff4444)",
  unassessable: "var(--sev-unassessable, #484f58)",
};

const HFACS_COLOR: Record<string, string> = {
  "Unsafe Act": "var(--sev-critical, #ff4444)",
  Precondition: "var(--sev-high, #ff8800)",
  "Unsafe Supervision": "var(--sev-medium, #e3b341)",
  "Organizational Influence": "var(--sev-low, #44aaff)",
};

function metricColor(rate: number | null): string {
  if (rate == null) return "var(--text-faint, #484f58)";
  if (rate >= 90) return "var(--sev-standard, #3fb950)";
  if (rate >= 75) return "var(--sev-medium, #e3b341)";
  return "var(--sev-critical, #ff4444)";
}

function cssVars(vars: Record<string, string>): React.CSSProperties {
  return vars as React.CSSProperties;
}

function Bars({
  data,
  colorFor,
  empty,
}: {
  data: [string, number][];
  colorFor: (label: string, index: number) => string;
  empty: string;
}) {
  if (data.length === 0) return <p className={styles.empty}>{empty}</p>;
  const max = Math.max(...data.map(([, count]) => count), 1);
  return (
    <div className={styles.bars}>
      {data.map(([label, count], index) => {
        const color = colorFor(label, index);
        return (
          <div
            key={label}
            className={styles.barRow}
            style={cssVars({
              "--bar-color": color,
              "--bar-width": `${(count / max) * 100}%`,
            })}
          >
            <span className={styles.barLabel} title={label}>{label}</span>
            <span className={styles.barCount}>{count}</span>
            <div className={styles.track}>
              <div className={styles.bar} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventTimeline({ results }: { results: AnalysisResult[] }) {
  const events = useMemo(
    () => [...results]
      .filter(r => {
        const sev = getCardSeverity(r);
        return sev !== "standard" && sev !== "unassessable";
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 12),
    [results],
  );

  if (events.length === 0) return <p className={styles.empty}>No observations yet.</p>;

  return (
    <div className={styles.timeline}>
      {events.map((result, index) => {
        const severity = getCardSeverity(result);
        const color = SEV_COLOR[severity];
        const ts = new Date(result.timestamp.endsWith("Z") ? result.timestamp : `${result.timestamp}Z`);
        return (
          <div
            key={`${result.id ?? result.timestamp}-${index}`}
            className={styles.event}
            style={cssVars({ "--event-color": color })}
          >
            <span className={styles.dot} />
            <div className={styles.eventMain}>
              <div className={styles.eventMeta}>
                <span className={styles.severityPill}>{severity.toUpperCase()}</span>
                <span className={styles.eventTime}>{formatDistanceToNow(ts, { addSuffix: true })}</span>
              </div>
              {result.summary && (
                <p className={styles.eventSummary}>
                  {result.summary}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActivityChart({ results }: { results: AnalysisResult[] }) {
  const data = useMemo(() => hourlyActivity(results), [results]);
  return (
    <ResponsiveContainer width="100%" height={132}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
        <defs>
          {(["critical", "high", "medium", "low", "standard"] as const).map(sev => (
            <linearGradient key={sev} id={`airport-analytics-${sev}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={SEV_COLOR[sev]} stopOpacity={0.35} />
              <stop offset="95%" stopColor={SEV_COLOR[sev]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-dim, #21262d)" vertical={false} />
        <XAxis dataKey="hour" tick={{ fontSize: 8, fill: "var(--text-faint, #484f58)" }} tickLine={false} axisLine={false} interval={5} />
        <YAxis tick={{ fontSize: 8, fill: "var(--text-faint, #484f58)" }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            background: "var(--surface, #161b22)",
            border: "1px solid var(--border, #30363d)",
            borderRadius: 6,
            fontSize: 10,
          }}
          labelStyle={{ color: "var(--text-dim, #8b949e)" }}
          itemStyle={{ color: "var(--text, #e6edf3)" }}
        />
        {(["critical", "high", "medium", "low", "standard"] as const).map(sev => (
          <Area
            key={sev}
            type="monotone"
            dataKey={sev}
            stroke={SEV_COLOR[sev]}
            strokeWidth={1.5}
            fill={`url(#airport-analytics-${sev})`}
            stackId="1"
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function AirportAnalytics({ results }: { results: AnalysisResult[] }) {
  const compliance = useMemo(() => complianceRate(results), [results]);
  const spike = useMemo(() => detectSpike(results), [results]);
  const hfacs = useMemo(
    () => Object.entries(hfacsCounts(results)).sort((a, b) => b[1] - a[1]),
    [results],
  );
  const noteTypes = useMemo(() => topNoteTypes(results), [results]);
  const assessable = results.filter(r => r.assessable !== false).length;

  return (
    <section className={styles.section}>
      <div className={styles.titleRow}>
        <div className={styles.title}>Analytics</div>
        <div className={styles.count}>{assessable} assessable</div>
      </div>

      <div className={styles.summaryGrid}>
        <div className={styles.metric} style={cssVars({ "--metric-color": metricColor(compliance) })}>
          <span className={styles.metricLabel}>Compliance</span>
          <span className={styles.metricValue}>{compliance == null ? "--" : `${compliance}%`}</span>
          <span className={styles.metricSub}>{results.length} total transmissions</span>
        </div>
        <div className={styles.metric} style={cssVars({ "--metric-color": spike.isSpike ? "var(--sev-critical, #ff4444)" : "var(--accent, #58a6ff)" })}>
          <span className={styles.metricLabel}>Recent observations</span>
          <span className={styles.metricValue}>{spike.last30}</span>
          <span className={styles.metricSub}>prior 30 min: {spike.prior30}</span>
        </div>
      </div>

      {spike.isSpike && (
        <div className={styles.spike}>
          <strong>Observation spike detected</strong>
          {spike.last30} in the last 30 min, {Math.round(spike.ratio)}x above the prior window.
        </div>
      )}

      <div className={styles.card}>
        <div className={styles.cardHead}>24h activity</div>
        <div className={styles.cardBody}>
          <ActivityChart results={results} />
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHead}>HFACS breakdown</div>
        <div className={styles.cardBody}>
          <Bars
            data={hfacs}
            colorFor={(label) => HFACS_COLOR[label] ?? "var(--text-dim, #8b949e)"}
            empty="No HFACS data yet."
          />
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHead}>Note types</div>
        <div className={styles.cardBody}>
          <Bars
            data={noteTypes}
            colorFor={() => "var(--accent, #58a6ff)"}
            empty="No note types recorded yet."
          />
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHead}>Event timeline</div>
        <div className={styles.cardBody}>
          <EventTimeline results={results} />
        </div>
      </div>
    </section>
  );
}
