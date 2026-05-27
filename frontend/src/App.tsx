import React, { useEffect, useMemo, useRef, useState } from "react";
import { LiveFeed, AnalysisResult, Filter } from "./components/LiveFeed";
import { AirportSidebar } from "./components/AirportSidebar";
import { SettingsPage } from "./components/SettingsPage";
import { useSettings } from "./SettingsContext";
import { useWindowWidth } from "./hooks/useWindowWidth";
import { API_BASE, fetchJson } from "./lib/api";
import { DateFilter } from "./lib/format";
import { PipelineStatus } from "./lib/types";
import { useMonitorStatus, usePipelineStatus, useResults } from "./lib/queries";
import { useLiveSocket } from "./hooks/useLiveSocket";
import { severityCounts } from "./lib/selectors";

const SEV_COLOR: Record<string, string> = {
  standard: "#3fb950", low: "#44aaff", medium: "#e3b341", high: "#ff8800", critical: "#ff4444",
  unassessable: "#484f58",
};

const FILTER_BUTTONS: { key: Filter; label: string }[] = [
  { key: "all",          label: "All" },
  { key: "standard",     label: "Standard" },
  { key: "low",          label: "Low" },
  { key: "medium",       label: "Medium" },
  { key: "high",         label: "High" },
  { key: "critical",     label: "Critical" },
  { key: "unassessable", label: "Unassessable" },
];

const DATE_FILTERS: { key: DateFilter; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d",    label: "Last 7 days" },
  { key: "30d",   label: "Last 30 days" },
  { key: "ytd",   label: "YTD" },
  { key: "all",   label: "All time" },
];

type StageDotColor = "#484f58" | "#3fb950" | "#e3b341" | "#ff4444" | "#8b949e";

function stageDotColor(stage: string, active: boolean): StageDotColor {
  if (!active) return "#484f58";
  if (stage === "error") return "#ff4444";
  if (stage === "audio") return "#3fb950";
  if (stage === "transcribing" || stage.startsWith("queued")) return "#e3b341";
  if (stage === "silent" || stage === "too_short") return "#8b949e";
  return "#3fb950";
}

function stageLabel(stage: string, active: boolean): string {
  if (!active) return "off";
  if (stage === "queued_unassessable") return "queued (unassessable)";
  if (stage.startsWith("queued_")) return "queued (" + stage.slice("queued_".length) + ")";
  return stage;
}

function PipelineStatusStrip({
  status,
  apiError,
  feeds,
  activeFeeds,
  activeAudio,
  airportFilter,
  onAirportSelect,
  onAudioStop,
}: {
  status: PipelineStatus | null;
  apiError: string | null;
  feeds: { label: string; url: string; code: string }[];
  activeFeeds: Set<string>;
  activeAudio: string | null;
  airportFilter: string;
  onAirportSelect: (code: string) => void;
  onAudioStop: () => void;
}) {
  const hardError = apiError;
  const softError = status?.last_gemini_error || status?.last_error || null;

  let statusLabel: string;
  let statusColor: string;
  let statusTextColor: string;
  let statusTooltip: string | undefined;

  if (hardError) {
    statusLabel = "API unreachable";
    statusColor = "#ff4444";
    statusTextColor = "#ff4444";
    statusTooltip = hardError;
  } else if (status?.last_gemini_error) {
    statusLabel = "Gemini Down";
    statusColor = "#e3b341";
    statusTextColor = "#e3b341";
    statusTooltip = status.last_gemini_error;
  } else if (softError) {
    statusLabel = "Pipeline error";
    statusColor = "#e3b341";
    statusTextColor = "#e3b341";
    statusTooltip = softError;
  } else if (status?.queued_transcripts) {
    statusLabel = "Batch Queued";
    statusColor = "#58a6ff";
    statusTextColor = "#58a6ff";
  } else {
    statusLabel = "Listening";
    statusColor = "#3fb950";
    statusTextColor = "#3fb950";
  }

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap" as const,
      maxWidth: "100%",
      minWidth: 0,
    }}>
      {/* Status pill */}
      <div
        title={statusTooltip}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          background: "#0d1117",
          border: "1px solid #30363d",
          borderRadius: 6,
          padding: "4px 10px",
          flexShrink: 0,
          cursor: statusTooltip ? "help" : "default",
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: statusColor,
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: 12,
          color: statusTextColor,
          fontWeight: 500,
          whiteSpace: "nowrap" as const,
        }}>{statusLabel}</span>
      </div>

      {/* Airport pill row */}
      <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "#0d1117",
        border: "1px solid #21262d",
        borderRadius: 10,
        padding: "4px 6px",
        flexWrap: "wrap" as const,
        minWidth: 0,
      }}>
        {feeds.map(feed => {
          const active = activeFeeds.has(feed.url);
          const stage = status?.feed_status?.[feed.url]?.stage ?? (active ? "starting" : "off");
          const dot = stageDotColor(stage, active);
          const selected = airportFilter === feed.code;
          const playing = activeAudio === feed.url;
          return (
            <button
              key={feed.code}
              type="button"
              aria-pressed={selected}
              onClick={(event) => {
                const target = event.target as Element;
                if (target.closest("[data-audio-stop]")) {
                  event.preventDefault();
                  event.stopPropagation();
                  onAudioStop();
                  return;
                }
                onAirportSelect(feed.code);
              }}
              title={`${feed.label} — ${stageLabel(stage, active)}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 500,
                color: selected ? "#e6edf3" : "#8b949e",
                background: playing ? "#0d1f12" : selected ? "#21262d" : "transparent",
                border: "none",
                borderRadius: 6,
                padding: "4px 10px",
                cursor: "pointer",
                whiteSpace: "nowrap" as const,
                flexShrink: 0,
                transition: "background 0.12s, color 0.12s",
              }}
            >
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: dot,
                flexShrink: 0,
              }} />
              {playing && (
                <span style={{
                  color: "#3fb950",
                  fontSize: 12,
                  lineHeight: 1,
                  animation: "pulse 1s infinite",
                  display: "inline-block",
                  flexShrink: 0,
                }}>♪</span>
              )}
              <span>{feed.code}</span>
              {playing && (
                <span
                  data-audio-stop
                  role="button"
                  aria-label={`Stop ${feed.code} audio`}
                  title={`Stop ${feed.code} audio`}
                  style={{
                    color: "#8b949e",
                    fontSize: 12,
                    lineHeight: 1,
                    marginLeft: 2,
                    cursor: "pointer",
                  }}
                >
                  ✕
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const { settings, needsSetup, loading: settingsLoading } = useSettings();
  const feeds = useMemo(
    () => (settings?.feeds ?? []).map(f => ({
      label: f.label || f.name || f.airport_code,
      url: f.url,
      code: f.airport_code,
    })),
    [settings]
  );
  const [activeFeeds, setActiveFeeds]   = useState<Set<string>>(new Set());
  const [tab, setTab]                   = useState<"live" | "settings">("live");
  const [filter, setFilter]             = useState<Filter>("all");
  const [airportFilter, setAirportFilter] = useState<string>("all");
  const [dateFilter, setDateFilter]     = useState<DateFilter>("all");
  const [activeAudio, setActiveAudio]   = useState<string | null>(null);
  const [actionError, setActionError]   = useState<string | null>(null);
  const [starting, setStarting]         = useState(false);
  const [stopping, setStopping]         = useState(false);
  // Sidebar: which airport's panel is open in Live Feed (null = hidden)
  const [sidebarAirport, setSidebarAirport] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: queryResults, error: resultsError } = useResults(dateFilter);
  const { data: pipelineStatus = null, error: pipelineError } = usePipelineStatus();
  const { data: monitorStatus, error: monitorError } = useMonitorStatus();
  const results: AnalysisResult[] = queryResults ?? [];

  useLiveSocket(dateFilter);

  const apiError =
    actionError
    ?? (resultsError ? `Unable to load analysis cards: ${(resultsError as Error).message}` : null)
    ?? (pipelineError ? `Unable to load pipeline status: ${(pipelineError as Error).message}` : null)
    ?? (monitorError ? `Unable to load monitor status: ${(monitorError as Error).message}` : null);

  useEffect(() => {
    if (monitorStatus) setActiveFeeds(new Set(Object.keys(monitorStatus.feeds || {})));
  }, [monitorStatus]);

  useEffect(() => {
    if (!settingsLoading && needsSetup) setTab("settings");
  }, [settingsLoading, needsSetup]);

  const getAudio = () => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  };

  useEffect(() => {
    return () => {
      if (!audioRef.current) return;
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    };
  }, []);

  const handleStart = async () => {
    setStarting(true);
    setActionError(null);
    const next = new Set(activeFeeds);
    const failures: string[] = [];
    for (const feed of feeds) {
      try {
        await fetchJson(
          `${API_BASE}/api/monitor/start?feed_url=${encodeURIComponent(feed.url)}&airport_code=${feed.code}`,
          { method: "POST" }
        );
        next.add(feed.url);
        setActiveFeeds(new Set(next));
      } catch (err: any) {
        failures.push(`${feed.code}: ${err.message}`);
      }
    }
    if (failures.length > 0) setActionError(`Some feeds failed to start: ${failures.join("; ")}`);
    setStarting(false);
  };

  const stopAudio = () => {
    const audio = getAudio();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setActiveAudio(null);
  };

  const handleStop = async () => {
    setStopping(true);
    setActionError(null);
    try {
      await fetchJson(`${API_BASE}/api/monitor/stop`, { method: "POST" });
      setActiveFeeds(new Set());
      setAirportFilter("all");
      setSidebarAirport(null);
      stopAudio();
    } catch (err: any) {
      setActionError(`Unable to stop feeds: ${err.message}`);
    } finally {
      setStopping(false);
    }
  };

  // Click airport chip: open sidebar + start audio + filter feed to that airport.
  // Click same chip again: close sidebar + reset filter. Audio keeps playing until stopped.
  const toggleAirport = (code: string) => {
    const feed = feeds.find(f => f.code === code);
    if (!feed) return;
    const isActive = sidebarAirport === code;
    setTab("live");
    if (isActive) {
      setSidebarAirport(null);
      setAirportFilter("all");
      return;
    }
    setSidebarAirport(code);
    setAirportFilter(code);
    const audio = getAudio();
    audio.src = feed.url;
    audio.play().catch(() => {});
    setActiveAudio(feed.url);
  };

  const closeSidebar = () => {
    setSidebarAirport(null);
    setAirportFilter("all");
  };

  const isRunning  = activeFeeds.size > 0;

  // Filter counts scoped to current airportFilter so badge numbers match what's visible
  const sevCounts = useMemo<Record<Filter, number>>(
    () => severityCounts(results, airportFilter),
    [results, airportFilter],
  );

  // ── Styles ──────────────────────────────────────────────────────────────────

  const tabBtnStyle = (active: boolean) => ({
    background: "none" as const, border: "none" as const,
    color: active ? "#e6edf3" : "#8b949e",
    borderBottom: active ? "2px solid #f78166" : "2px solid transparent",
    padding: "10px 16px", cursor: "pointer" as const,
    fontSize: 14, fontWeight: active ? 600 : 400,
  });

  const filterBtnStyle = (active: boolean, accent: string) => ({
    display: "flex", alignItems: "center", gap: 7,
    padding: "6px 13px", borderRadius: 7, cursor: "pointer" as const,
    background: active ? accent + "22" : "transparent",
    border: `1px solid ${active ? accent + "88" : "transparent"}`,
    color: active ? "#e6edf3" : "#8b949e",
    fontSize: 13, fontWeight: active ? 600 : 400,
    transition: "all 0.1s", whiteSpace: "nowrap" as const,
  });

  const periodBtnStyle = (active: boolean) => ({
    background: active ? "#21262d" : "none" as const,
    color: active ? "#58a6ff" : "#8b949e",
    border: "none" as const, borderRadius: 4, padding: "3px 9px",
    cursor: "pointer" as const, fontSize: 11, fontWeight: active ? 600 : 400,
    transition: "all 0.1s",
  });

  const { bp } = useWindowWidth();
  const isMobile  = bp === "mobile";
  const isTablet  = bp === "tablet";
  const isLarge   = bp === "large";

  // ── Render ───────────────────────────────────────────────────────────────────

  // On tablet/mobile, sidebar becomes a bottom drawer instead of a side panel
  const sidebarOpen    = tab === "live" && sidebarAirport !== null;
  const sidebarIsDrawer = sidebarOpen && (isMobile || isTablet);

  return (
    <div style={{
      minHeight: "100vh",
      maxWidth: "100vw",
      overflowX: "hidden",
      background: "#0d1117",
      color: "#e6edf3",
      display: "flex",
      flexDirection: "column",
    }}>

      {/* ── Header ── */}
      <header style={{
        background: "#161b22", borderBottom: "1px solid #30363d",
        padding: isMobile ? "10px 16px" : "14px 24px",
        display: "flex", alignItems: "center",
        flexShrink: 0, gap: isMobile ? 10 : 16, flexWrap: "wrap" as const,
      }}>
        <div style={{ flex: isMobile ? "1 1 0" : "0 0 210px", minWidth: 0 }}>
          <h1 style={{ fontSize: isMobile ? 14 : 18, fontWeight: 700, letterSpacing: 0.5 }}>
            ✈ Readback
          </h1>
          {!isMobile && <p style={{ fontSize: 12, color: "#8b949e", marginTop: 2 }}>ATC phraseology, read back to you</p>}
        </div>

        {isRunning && (
          <div style={{
            order: isMobile ? 3 : 0,
            flex: isMobile ? "1 1 100%" : "1 1 auto",
            minWidth: isMobile ? "100%" : 0,
            margin: 0,
          }}>
            <PipelineStatusStrip
              status={pipelineStatus}
              apiError={apiError}
              feeds={feeds}
              activeFeeds={activeFeeds}
              activeAudio={activeAudio}
              airportFilter={airportFilter}
              onAirportSelect={toggleAirport}
              onAudioStop={stopAudio}
            />
          </div>
        )}

        <div style={{
          display: "flex",
          gap: isMobile ? 6 : 12,
          alignItems: "center",
          flexWrap: "wrap" as const,
          justifyContent: "flex-end",
          marginLeft: "auto",
          flex: "0 0 auto",
        }}>
          {/* Start / Stop */}
          {!isRunning ? (
            <button
              onClick={handleStart}
              disabled={starting}
              aria-label="Start all monitored ATC feeds"
              style={{
                background: starting ? "#1f6f3b" : "#238636", color: "#fff", border: "none",
                borderRadius: 6, padding: "7px 16px", cursor: starting ? "wait" : "pointer",
                fontSize: 13, fontWeight: 600, minHeight: isMobile ? 44 : undefined,
              }}
            >
              {starting ? "Starting..." : `▶ Start All (${feeds.length})`}
            </button>
          ) : (
            <button
              onClick={handleStop}
              disabled={stopping}
              aria-label="Stop all monitored ATC feeds"
              style={{
                background: stopping ? "#8f2422" : "#da3633", color: "#fff", border: "none",
                borderRadius: 6, padding: isMobile ? "7px 12px" : "7px 16px", cursor: stopping ? "wait" : "pointer",
                fontSize: 13, fontWeight: 600, minHeight: isMobile ? 44 : undefined,
              }}
            >
              {stopping ? "Stopping..." : isMobile ? "■ Stop" : "■ Stop All"}
            </button>
          )}

          {isRunning && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#3fb950" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3fb950", animation: "pulse 1.5s infinite", display: "inline-block" }} />
              {!isMobile && "LIVE"}
            </div>
          )}
        </div>
      </header>

      {/* ── Tab + period bar ── */}
      <div style={{ borderBottom: "1px solid #30363d", background: "#161b22", flexShrink: 0 }}>
        <div style={{
          padding: isMobile ? "0 16px" : "0 24px",
          display: "flex",
          flexDirection: isMobile ? "column" as const : "row" as const,
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          paddingBottom: isMobile ? 8 : 0,
        }}>
          <div style={{ display: "flex", alignSelf: isMobile ? "stretch" : undefined }}>
            <button onClick={() => setTab("live")}      style={tabBtnStyle(tab === "live")}>
              {isMobile ? "Feed" : "Live Feed"}
            </button>
            <button onClick={() => setTab("settings")} style={tabBtnStyle(tab === "settings")}>
              {isMobile ? "Setup" : "Settings"}
            </button>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 2,
            background: "#0d1117", border: "1px solid #30363d",
            borderRadius: 6, padding: "3px",
              alignSelf: isMobile ? "stretch" : undefined,
              justifyContent: isMobile ? "space-between" : undefined,
              width: isMobile ? "100%" : undefined,
              boxSizing: "border-box" as const,
          }}>
            {DATE_FILTERS.filter(({ key }) => !(isMobile && key === "ytd")).map(({ key, label }) => (
              <button key={key} onClick={() => setDateFilter(key)} style={periodBtnStyle(dateFilter === key)}>
                {isMobile ? ({ today: "Today", "7d": "7d", "30d": "30d", ytd: "YTD", all: "All" } as Record<DateFilter, string>)[key] : label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      {tab === "settings" ? (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {needsSetup && (
            <div style={{ background: "#1f1a0d", borderBottom: "1px solid #e3b34133", color: "#e3b341", padding: "10px 24px", fontSize: 13 }}>
              Add at least one feed and a Gemini API key to get started.
            </div>
          )}
          {settings
            ? <SettingsPage key={settings.gemini_api_key + ":" + settings.feeds.length} />
            : <p style={{ color: "#8b949e", padding: 24 }}>Loading settings...</p>}
        </div>
      ) : (
        /* Live Feed — flex layout; sidebar is side panel on desktop, drawer on mobile/tablet */
        <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden", flexDirection: "column" }}>

          {/* Main row: feed + sidebar — centered + capped on large screens */}
          <div style={{
            display: "flex", flex: 1, minHeight: 0, overflow: "hidden",
            maxWidth: isLarge ? 1360 : "none",
            margin: isLarge ? "0 auto" : undefined,
            width: "100%",
          }}>

            {/* Feed column */}
            <div style={{
              flex: (sidebarOpen && !sidebarIsDrawer) ? "1 1 0" : "1 1 100%",
              display: "flex", flexDirection: "column",
              transition: "flex 0.2s ease",
              overflowY: "auto",
            }}>
              <div style={{
                maxWidth: (sidebarOpen && !sidebarIsDrawer) ? "none" : 900,
                margin:   (sidebarOpen && !sidebarIsDrawer) ? 0 : "0 auto",
                width: "100%",
                padding: isMobile ? "12px" : "24px",
                boxSizing: "border-box" as const,
                transition: "max-width 0.2s ease, margin 0.2s ease",
              }}>
                {/* Severity filter bar — wraps on small screens */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 4, marginBottom: 16,
                  background: "#161b22", border: "1px solid #21262d",
                  borderRadius: 10, padding: isMobile ? "6px 8px" : "8px 12px",
                  flexWrap: isMobile ? "nowrap" as const : "wrap" as const,
                  overflowX: isMobile ? "auto" as const : undefined,
                  WebkitOverflowScrolling: isMobile ? "touch" as const : undefined,
                }}>
                  {FILTER_BUTTONS.map(({ key, label }) => {
                    const active = filter === key;
                    const accent = key === "all" ? "#58a6ff" : SEV_COLOR[key];
                    // On mobile: skip "unassessable" label text, show counts only
                    const displayLabel = isMobile && key === "unassessable" ? "N/A" : label;
                    return (
                      <button key={key} onClick={() => setFilter(key)} style={{
                        ...filterBtnStyle(active, accent),
                        padding: isMobile ? "4px 8px" : "6px 13px",
                        fontSize: isMobile ? 11 : 13,
                      }}>
                        {displayLabel}
                        <span style={{
                          fontSize: isMobile ? 11 : 13, fontWeight: 700,
                          color: active ? accent : (sevCounts[key] > 0 ? "#c9d1d9" : "#484f58"),
                        }}>
                          {sevCounts[key]}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <LiveFeed
                    results={results}
                    filter={filter}
                    airportFilter={airportFilter}
                    isRunning={isRunning}
                    pipelineStatus={pipelineStatus}
                    apiError={apiError}
                  />
              </div>
            </div>

            {/* Side panel sidebar (desktop only) */}
            {sidebarOpen && !sidebarIsDrawer && (
              <div style={{
                flex: "0 0 400px", maxWidth: 400, minWidth: 300,
                borderLeft: "1px solid #21262d", overflow: "hidden",
              }}>
                <AirportSidebar airportCode={sidebarAirport!} onClose={closeSidebar} results={results} />
              </div>
            )}
          </div>

          {/* Bottom drawer sidebar (mobile / tablet) */}
          {sidebarIsDrawer && (
            <div style={{
              flexShrink: 0, height: isTablet ? 360 : 280,
              borderTop: "1px solid #21262d", overflow: "hidden",
            }}>
              <AirportSidebar airportCode={sidebarAirport!} onClose={closeSidebar} results={results} />
            </div>
          )}
        </div>
      )}

      {/* ── Advisory footer ── */}
      <footer style={{
        flexShrink: 0,
        borderTop: "1px solid #21262d",
        padding: isMobile ? "8px 16px" : "10px 24px",
        background: "#0d1117",
      }}>
        <p style={{ fontSize: 10, color: "#484f58", margin: 0, lineHeight: 1.6 }}>
          Readback is an educational tool. Transcriptions may be imperfect and feeds are
          often one-sided — notes and events are advisory, not authoritative.
        </p>
      </footer>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
      `}</style>
    </div>
  );
}
