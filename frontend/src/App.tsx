import React, { useEffect, useMemo, useRef, useState } from "react";
import { LiveFeed, AnalysisResult, Filter, getCardSeverity } from "./components/LiveFeed";
import { AirportSidebar } from "./components/AirportSidebar";
import { SituationRoom } from "./components/SituationRoom";
import { useWindowWidth } from "./hooks/useWindowWidth";

const API_BASE = "http://localhost:8000";
const WS_URL = "ws://localhost:8000/ws/live";

const KNOWN_FEEDS: { label: string; url: string; code: string }[] = [
  { label: "New York JFK",            url: "http://audio.liveatc.net/kjfk9_s",            code: "KJFK" },
  { label: "Atlanta Tower",           url: "http://audio.liveatc.net/katl_twr",           code: "KATL" },
  { label: "Hong Kong App/Dep",       url: "http://audio.liveatc.net/vhhh5",              code: "VHHH" },
  { label: "Los Angeles Tower",       url: "http://audio.liveatc.net/klax_twr",           code: "KLAX" },
  { label: "Chicago O'Hare Approach", url: "http://audio.liveatc.net/kord1n2_app_133625", code: "KORD" },
];

const SEV_COLOR: Record<string, string> = {
  compliant: "#3fb950", low: "#44aaff", medium: "#e3b341", high: "#ff8800", critical: "#ff4444",
  unassessable: "#484f58",
};

const FILTER_BUTTONS: { key: Filter; label: string }[] = [
  { key: "all",          label: "All" },
  { key: "compliant",    label: "Compliant" },
  { key: "low",          label: "Low" },
  { key: "medium",       label: "Medium" },
  { key: "high",         label: "High" },
  { key: "critical",     label: "Critical" },
  { key: "unassessable", label: "Unassessable" },
];

type DateFilter = "today" | "7d" | "30d" | "ytd" | "all";

const DATE_FILTERS: { key: DateFilter; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d",    label: "Last 7 days" },
  { key: "30d",   label: "Last 30 days" },
  { key: "ytd",   label: "YTD" },
  { key: "all",   label: "All time" },
];

function getStartDate(f: DateFilter): string | null {
  const now = new Date();
  if (f === "today") {
    const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString();
  }
  if (f === "7d")  return new Date(now.getTime() - 7  * 86400000).toISOString();
  if (f === "30d") return new Date(now.getTime() - 30 * 86400000).toISOString();
  if (f === "ytd") return new Date(now.getFullYear(), 0, 1).toISOString();
  return null;
}

export default function App() {
  const [results, setResults]           = useState<AnalysisResult[]>([]);
  const [activeFeeds, setActiveFeeds]   = useState<Set<string>>(new Set());
  const [tab, setTab]                   = useState<"live" | "situation">("live");
  const [filter, setFilter]             = useState<Filter>("all");
  const [airportFilter, setAirportFilter] = useState<string>("all");
  const [dateFilter, setDateFilter]     = useState<DateFilter>("all");
  const [activeAudio, setActiveAudio]   = useState<string | null>(null);
  // Sidebar: which airport's panel is open in Live Feed (null = hidden)
  const [sidebarAirport, setSidebarAirport] = useState<string | null>(null);
  // Situation Room airport overlay (separate from live sidebar)
  const [srAirport, setSrAirport] = useState<string | null>(null);

  const wsRef    = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement>(new Audio());

  // Fetch historical results when date filter changes
  useEffect(() => {
    const sd = getStartDate(dateFilter);
    const url = sd
      ? `${API_BASE}/api/results?start_date=${encodeURIComponent(sd)}`
      : `${API_BASE}/api/results`;
    fetch(url).then(r => r.json()).then(setResults).catch(() => {});
  }, [dateFilter]);

  // Fetch active feed status on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/monitor/status`)
      .then(r => r.json())
      .then(s => setActiveFeeds(new Set(Object.keys(s.feeds || {}))))
      .catch(() => {});
  }, []);

  // WebSocket live updates
  useEffect(() => {
    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (!alive) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "analysis") {
          setResults(prev => {
            const sd = getStartDate(dateFilter);
            if (sd && new Date(msg.data.timestamp + "Z") < new Date(sd)) return prev;
            return [msg.data, ...prev].slice(0, 500);
          });
        }
      };
      ws.onclose = () => { if (alive) retryTimer = setTimeout(connect, 3000); };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, []);

  const handleStart = async () => {
    for (const feed of KNOWN_FEEDS) {
      await fetch(
        `${API_BASE}/api/monitor/start?feed_url=${encodeURIComponent(feed.url)}&airport_code=${feed.code}`,
        { method: "POST" }
      );
    }
    setActiveFeeds(new Set(KNOWN_FEEDS.map(f => f.url)));
  };

  const stopAudio = () => {
    const audio = audioRef.current;
    audio.pause();
    audio.src = "";
    audio.load();
    setActiveAudio(null);
  };

  const handleStop = async () => {
    await fetch(`${API_BASE}/api/monitor/stop`, { method: "POST" });
    setActiveFeeds(new Set());
    setAirportFilter("all");
    setSidebarAirport(null);
    stopAudio();
  };

  // Click airport badge: open sidebar + start audio + filter feed to that airport.
  // Click same badge again: close sidebar + reset filter (audio keeps playing).
  const toggleAirport = (f: { url: string; code: string }) => {
    const isActive = sidebarAirport === f.code;
    if (isActive) {
      setSidebarAirport(null);
      setAirportFilter("all");
    } else {
      setSidebarAirport(f.code);
      setAirportFilter(f.code);
      const audio = audioRef.current;
      audio.src = f.url;
      audio.play().catch(() => {});
      setActiveAudio(f.url);
    }
  };

  const closeSidebar = () => {
    setSidebarAirport(null);
    setAirportFilter("all");
  };

  const isRunning  = activeFeeds.size > 0;
  const activeFeed = KNOWN_FEEDS.find(f => f.url === activeAudio);

  // Filter counts scoped to current airportFilter so badge numbers match what's visible
  const visibleResults = airportFilter === "all"
    ? results
    : results.filter(r => r.airport_code === airportFilter);

  const sevCounts = useMemo<Record<Filter, number>>(() => {
    const counts = { all: 0, compliant: 0, low: 0, medium: 0, high: 0, critical: 0, unassessable: 0 };
    for (const r of visibleResults) {
      counts.all++;
      counts[getCardSeverity(r) as Filter]++;
    }
    return counts;
  }, [visibleResults]);

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

  // Airports with active feeds for Situation Room markers
  const activeAirportCodes = useMemo(
    () => new Set(KNOWN_FEEDS.filter(f => activeFeeds.has(f.url)).map(f => f.code)),
    [activeFeeds]
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  // On tablet/mobile, sidebar becomes a bottom drawer instead of a side panel
  const sidebarOpen    = tab === "live" && sidebarAirport !== null;
  const sidebarIsDrawer = sidebarOpen && (isMobile || isTablet);

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#e6edf3", display: "flex", flexDirection: "column" }}>

      {/* ── Header ── */}
      <header style={{
        background: "#161b22", borderBottom: "1px solid #30363d",
        padding: isMobile ? "10px 16px" : "14px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0, gap: 8, flexWrap: "wrap" as const,
      }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 14 : 18, fontWeight: 700, letterSpacing: 0.5 }}>
            ✈ {isMobile ? "ATC Monitor" : "ATC Compliance Monitor"}
          </h1>
          {!isMobile && <p style={{ fontSize: 12, color: "#8b949e", marginTop: 2 }}>Real-time FAA / ICAO compliance analysis</p>}
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>

          {/* Airport badges — click to open sidebar + audio + filter */}
          {isRunning && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {KNOWN_FEEDS.map(f => {
                const isActive  = sidebarAirport === f.code;
                const isPlaying = activeAudio === f.url;
                return (
                  <button
                    key={f.url}
                    onClick={() => toggleAirport(f)}
                    title={isActive
                      ? `Close ${f.label} panel`
                      : `Open ${f.label} — radar, weather & filter`}
                    style={{
                      fontSize: 11, fontWeight: 700,
                      color:      isActive ? "#0d1117" : "#3fb950",
                      background: isActive ? "#3fb950" : "#0d1117",
                      border: `1px solid ${isActive ? "#3fb950" : "#238636"}`,
                      borderRadius: 4, padding: "3px 8px",
                      cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 4,
                      transition: "all 0.15s",
                    }}
                  >
                    {isPlaying ? "▶ " : ""}{f.code}
                  </button>
                );
              })}
            </div>
          )}

          {/* Now playing indicator */}
          {activeFeed && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 11, color: "#3fb950",
              background: "#0d1f12", border: "1px solid #238636",
              borderRadius: 6, padding: "3px 10px",
            }}>
              <span style={{ animation: "pulse 1s infinite", display: "inline-block" }}>♪</span>
              {activeFeed.label}
              <button
                onClick={stopAudio}
                style={{
                  background: "none", border: "none", color: "#8b949e",
                  cursor: "pointer", fontSize: 12, padding: "0 0 0 4px", lineHeight: 1,
                }}
              >✕</button>
            </div>
          )}

          {/* Start / Stop */}
          {!isRunning ? (
            <button onClick={handleStart} style={{
              background: "#238636", color: "#fff", border: "none",
              borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600,
            }}>▶ Start All ({KNOWN_FEEDS.length})</button>
          ) : (
            <button onClick={handleStop} style={{
              background: "#da3633", color: "#fff", border: "none",
              borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600,
            }}>■ Stop All</button>
          )}

          {isRunning && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#3fb950" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3fb950", animation: "pulse 1.5s infinite", display: "inline-block" }} />
              LIVE
            </div>
          )}
        </div>
      </header>

      {/* ── Tab + period bar ── */}
      <div style={{ borderBottom: "1px solid #30363d", background: "#161b22", flexShrink: 0 }}>
        <div style={{ padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex" }}>
            <button onClick={() => setTab("live")}      style={tabBtnStyle(tab === "live")}>
              {isMobile ? "Feed" : "Live Feed"}
            </button>
            <button onClick={() => setTab("situation")} style={tabBtnStyle(tab === "situation")}>
              {isMobile ? "Globe" : "Situation Room"}
            </button>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 2,
            background: "#0d1117", border: "1px solid #30363d",
            borderRadius: 6, padding: "3px",
          }}>
            {DATE_FILTERS.map(({ key, label }) => (
              <button key={key} onClick={() => setDateFilter(key)} style={periodBtnStyle(dateFilter === key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      {tab === "situation" ? (
        <div style={{ flex: 1, overflowY: "auto", position: "relative" }}>
          <SituationRoom
            results={results}
            activeAirports={activeAirportCodes}
            onAirportClick={(code) => setSrAirport(prev => prev === code ? null : code)}
          />

          {/* Airport detail overlay — slides in from right within Situation Room */}
          {srAirport && (
            <>
              {/* Backdrop */}
              <div
                onClick={() => setSrAirport(null)}
                style={{
                  position: "fixed", inset: 0, zIndex: 190,
                  background: "#00000044", backdropFilter: "blur(1px)",
                }}
              />
              {/* Panel */}
              <div style={{
                position: "fixed", right: 0, top: 0, bottom: 0,
                width: isMobile ? "100vw" : isTablet ? 380 : 420,
                zIndex: 200,
                boxShadow: "-6px 0 40px #0009",
                animation: "slideInRight 0.2s ease",
              }}>
                <AirportSidebar
                  airportCode={srAirport}
                  onClose={() => setSrAirport(null)}
                  results={results}
                />
              </div>
            </>
          )}
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
                transition: "max-width 0.2s ease, margin 0.2s ease",
              }}>
                {/* Severity filter bar — wraps on small screens */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 4, marginBottom: 16,
                  background: "#161b22", border: "1px solid #21262d",
                  borderRadius: 10, padding: isMobile ? "6px 8px" : "8px 12px",
                  flexWrap: "wrap" as const,
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
                  {/* Airport filter indicator */}
                  {airportFilter !== "all" && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, marginLeft: "auto",
                      color: "#3fb950", background: "#3fb95018",
                      border: "1px solid #3fb95044",
                      borderRadius: 6, padding: "4px 10px",
                    }}>
                      {airportFilter} only
                    </span>
                  )}
                </div>

                <LiveFeed results={results} filter={filter} airportFilter={airportFilter} />
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

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
      `}</style>
    </div>
  );
}
