import type { CSSProperties } from "react";
import { useState } from "react";

import { hourlyActivity } from "../../lib/analytics";
import { resolveAggregateNavTarget, type AggregateNavTarget } from "../../lib/alerts";
import { exportUrl } from "../../lib/api";
import { DateFilter, getStartDate } from "../../lib/format";
import type { AnalysisResult } from "../../lib/types";
import styles from "./InsightsTab.module.css";

type SeverityKey = "critical" | "high" | "medium" | "low";

interface NoteTypeDetail {
  count: number;
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
  top_airport?: string | null;
}

interface AirportRisk {
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
  checked?: number;
  unassessable?: number;
}

export interface InsightsStats {
  total_chunks_analyzed: number;
  assessable_chunks: number;
  unassessable_chunks: number;
  non_standard_chunks: number;
  conformance_rate: number | null;
  severity_breakdown: Record<SeverityKey, number>;
  hfacs_breakdown: Record<string, number>;
  airport_conformance: Record<string, number | null>;
  airport_risk_matrix: Record<string, AirportRisk>;
  note_type_details: Record<string, NoteTypeDetail>;
}

interface Props {
  stats: InsightsStats;
  results: AnalysisResult[];
  onNavigate: (target: AggregateNavTarget) => void;
  dateFilter?: DateFilter;
  airport?: string;
}

const SEVERITIES: SeverityKey[] = ["critical", "high", "medium", "low"];
const SEV_LABEL: Record<SeverityKey, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function pct(value: number | null): string {
  return value == null ? "n/a" : `${value}%`;
}

function barStyle(value: number, max: number, token = "--accent"): CSSProperties {
  const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return {
    "--bar-width": `${width}%`,
    "--bar-color": `var(${token})`,
  } as CSSProperties;
}

function metricStyle(token: string): CSSProperties {
  return { "--metric-color": `var(${token})` } as CSSProperties;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>{title}</div>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}

function Bars({ values, emptyLabel }: { values: Record<string, number>; emptyLabel: string }) {
  const rows = Object.entries(values).filter(([, count]) => count > 0);
  const max = Math.max(0, ...rows.map(([, count]) => count));
  if (rows.length === 0) return <p className={styles.empty}>{emptyLabel}</p>;
  return (
    <div className={styles.bars}>
      {rows.map(([label, count]) => (
        <div key={label} className={styles.barRow}>
          <div className={styles.barLabel}>{label}</div>
          <div className={styles.barCount}>{count}</div>
          <div className={styles.track}>
            <div className={styles.bar} style={barStyle(count, max)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function HeadlineTiles({ stats }: { stats: InsightsStats }) {
  return (
    <div className={styles.tiles}>
      <div className={styles.tile}>
        <span className={styles.tileLabel}>Analyzed</span>
        <span className={styles.tileValue}>{stats.total_chunks_analyzed}</span>
        <span className={styles.tileSub}>transmissions</span>
      </div>
      <div className={styles.tile}>
        <span className={styles.tileLabel}>Assessable</span>
        <span className={styles.tileValue}>{stats.assessable_chunks}</span>
        <span className={styles.tileSub}>{stats.unassessable_chunks} unassessable</span>
      </div>
      <div className={styles.tile}>
        <span className={styles.tileLabel}>Non-standard</span>
        <span className={styles.tileValue} style={metricStyle("--sev-high")}>
          {stats.non_standard_chunks}
        </span>
        <span className={styles.tileSub}>review candidates</span>
      </div>
      <div className={styles.tile}>
        <span className={styles.tileLabel}>Conformance</span>
        <span className={styles.tileValue} style={metricStyle("--sev-standard")}>
          {pct(stats.conformance_rate)}
        </span>
        <span className={styles.tileSub}>assessable only</span>
      </div>
    </div>
  );
}

function SeverityBars({ stats }: { stats: InsightsStats }) {
  const values = SEVERITIES.reduce<Record<string, number>>((out, key) => {
    out[SEV_LABEL[key]] = stats.severity_breakdown[key] ?? 0;
    return out;
  }, {});
  return <Bars values={values} emptyLabel="No severity observations in this period." />;
}

function NoteTypeLeaderboard({
  details,
  onNavigate,
}: {
  details: Record<string, NoteTypeDetail>;
  onNavigate: Props["onNavigate"];
}) {
  const rows = Object.entries(details).sort((a, b) => (b[1].count ?? 0) - (a[1].count ?? 0));
  if (rows.length === 0) return <p className={styles.empty}>No error types in this period.</p>;
  return (
    <div className={styles.table}>
      <div className={`${styles.rowHead} ${styles.noteRowHead}`}>
        <span>Type</span>
        <span>Count</span>
        <span>Peak</span>
        <span>Severity mix</span>
      </div>
      {rows.map(([noteType, detail]) => (
        <button
          key={noteType}
          type="button"
          className={`${styles.row} ${styles.noteRow}`}
          onClick={() => onNavigate(resolveAggregateNavTarget({ noteType }))}
        >
          <span className={styles.cellMain}>{noteType}</span>
          <span className={styles.cellNum}>{detail.count}</span>
          <span className={styles.cellDim}>{detail.top_airport ?? "-"}</span>
          <span className={styles.cellDim}>
            C {detail.critical ?? 0} / H {detail.high ?? 0} / M {detail.medium ?? 0} / L {detail.low ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}

function AirportConformanceTable({
  conformance,
  matrix,
  onNavigate,
}: {
  conformance: Record<string, number | null>;
  matrix: Record<string, AirportRisk>;
  onNavigate: Props["onNavigate"];
}) {
  const rows = Object.keys(conformance).sort();
  if (rows.length === 0) return <p className={styles.empty}>No airport activity in this period.</p>;
  return (
    <div className={styles.table}>
      <div className={`${styles.rowHead} ${styles.airportRowHead}`}>
        <span>Airport</span>
        <span>Conform</span>
        <span>Crit</span>
        <span>High</span>
        <span>Med</span>
        <span>Low</span>
        <span>Checked</span>
      </div>
      {rows.map(code => {
        const risk = matrix[code] ?? {};
        return (
          <button
            key={code}
            type="button"
            className={`${styles.row} ${styles.airportRow}`}
            onClick={() => onNavigate(resolveAggregateNavTarget({ airport: code }))}
          >
            <span className={styles.cellCode}>{code}</span>
            <span className={styles.conformance}>{pct(conformance[code])}</span>
            {SEVERITIES.map(sev => (
              <span
                key={sev}
                className={`${styles.sevNum} ${(risk[sev] ?? 0) === 0 ? styles.sevZero : ""}`}
                style={{ "--sev-color": `var(--sev-${sev})` } as CSSProperties}
              >
                {risk[sev] ?? 0}
              </span>
            ))}
            <span className={styles.cellNum}>{risk.checked ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

function ActivityChart({ results }: { results: AnalysisResult[] }) {
  const bins = hourlyActivity(results);
  const values = bins.reduce<Record<string, number>>((out, bin) => {
    const total = bin.critical + bin.high + bin.medium + bin.low + bin.standard;
    if (total > 0) out[bin.hour] = total;
    return out;
  }, {});
  return <Bars values={values} emptyLabel="No activity in the last 24 hours." />;
}

function ExportControls({ dateFilter, airport }: { dateFilter: DateFilter; airport?: string }) {
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const href = exportUrl({
    format,
    startDate: getStartDate(dateFilter),
    airport: airport && airport !== "all" ? airport : null,
  });

  return (
    <div className={styles.exportControls}>
      <div className={styles.formatToggle} aria-label="Export format">
        {(["csv", "json"] as const).map(f => (
          <button
            key={f}
            type="button"
            className={`${styles.formatBtn} ${format === f ? styles.formatBtnActive : ""}`}
            onClick={() => setFormat(f)}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={styles.exportBtn}
        onClick={() => { window.location.href = href; }}
      >
        Export
      </button>
    </div>
  );
}

export function InsightsTab({ stats, results, onNavigate, dateFilter = "all", airport }: Props) {
  if (stats.total_chunks_analyzed === 0) {
    return (
      <div className={styles.tab}>
        <ExportControls dateFilter={dateFilter} airport={airport} />
        <HeadlineTiles stats={stats} />
        <Section title="Insights">
          <p className={styles.empty}>No analyses in this period.</p>
        </Section>
      </div>
    );
  }

  return (
    <div className={styles.tab}>
      <ExportControls dateFilter={dateFilter} airport={airport} />
      <HeadlineTiles stats={stats} />
      <Section title="Severity">
        <SeverityBars stats={stats} />
      </Section>
      <Section title="HFACS">
        <Bars values={stats.hfacs_breakdown} emptyLabel="No HFACS observations in this period." />
      </Section>
      <Section title="Error Types">
        <NoteTypeLeaderboard details={stats.note_type_details} onNavigate={onNavigate} />
      </Section>
      <Section title="Airport Conformance">
        <AirportConformanceTable
          conformance={stats.airport_conformance}
          matrix={stats.airport_risk_matrix}
          onNavigate={onNavigate}
        />
      </Section>
      <Section title="Activity Over Time">
        <ActivityChart results={results} />
      </Section>
    </div>
  );
}
