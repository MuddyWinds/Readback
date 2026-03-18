import React, { useEffect, useRef, useState } from "react";
import { LiveFeed, AnalysisResult } from "./components/LiveFeed";
import { StatsPanel } from "./components/StatsPanel";

const API_BASE = "http://localhost:8000";
const WS_URL = "ws://localhost:8000/ws/live";

const KNOWN_FEEDS: { label: string; url: string; code: string }[] = [
  { label: "SFO Approach", url: "http://feeds.liveatc.net/ksfo", code: "KSFO" },
  { label: "LAX Ground", url: "http://feeds.liveatc.net/klax_gnd", code: "KLAX" },
  { label: "JFK Approach", url: "http://feeds.liveatc.net/kjfk_app", code: "KJFK" },
  { label: "ORD Tower", url: "http://feeds.liveatc.net/kord_twr", code: "KORD" },
];

export default function App() {
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [feedUrl, setFeedUrl] = useState(KNOWN_FEEDS[0].url);
  const [airportCode, setAirportCode] = useState(KNOWN_FEEDS[0].code);
  const [tab, setTab] = useState<"live" | "stats">("live");
  const wsRef = useRef<WebSocket | null>(null);

  // Load initial results
  useEffect(() => {
    fetch(`${API_BASE}/api/results?limit=20`)
      .then(r => r.json())
      .then(data => setResults(data.reverse()))
      .catch(() => {});
    fetch(`${API_BASE}/api/monitor/status`)
      .then(r => r.json())
      .then(s => setRunning(s.running))
      .catch(() => {});
  }, []);

  // WebSocket connection
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "analysis") {
        setResults(prev => [msg.data, ...prev].slice(0, 100));
        // Refresh stats every 5 new results
        setResults(prev => {
          if (prev.length % 5 === 0) {
            fetch(`${API_BASE}/api/stats`).then(r => r.json()).then(setStats).catch(() => {});
          }
          return prev;
        });
      }
    };
    return () => ws.close();
  }, []);

  const handleStart = async () => {
    await fetch(`${API_BASE}/api/monitor/start?feed_url=${encodeURIComponent(feedUrl)}&airport_code=${airportCode}`, {
      method: "POST",
    });
    setRunning(true);
  };

  const handleStop = async () => {
    await fetch(`${API_BASE}/api/monitor/stop`, { method: "POST" });
    setRunning(false);
  };

  const handleFeedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = KNOWN_FEEDS.find(f => f.url === e.target.value);
    if (selected) {
      setFeedUrl(selected.url);
      setAirportCode(selected.code);
    }
  };

  const loadStats = () => {
    fetch(`${API_BASE}/api/stats`).then(r => r.json()).then(setStats).catch(() => {});
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#e6edf3" }}>
      {/* Header */}
      <header style={{
        background: "#161b22",
        borderBottom: "1px solid #30363d",
        padding: "14px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: 0.5 }}>
            ✈ ATC Compliance Monitor
          </h1>
          <p style={{ fontSize: 12, color: "#8b949e", marginTop: 2 }}>
            Real-time FAA / ICAO compliance analysis
          </p>
        </div>

        {/* Monitor controls */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select
            value={feedUrl}
            onChange={handleFeedChange}
            style={{
              background: "#21262d",
              color: "#e6edf3",
              border: "1px solid #30363d",
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: 13,
            }}
          >
            {KNOWN_FEEDS.map(f => (
              <option key={f.url} value={f.url}>{f.label}</option>
            ))}
          </select>

          {!running ? (
            <button
              onClick={handleStart}
              style={{
                background: "#238636",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "7px 16px",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              ▶ Start
            </button>
          ) : (
            <button
              onClick={handleStop}
              style={{
                background: "#da3633",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "7px 16px",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              ■ Stop
            </button>
          )}

          {/* Live indicator */}
          {running && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#3fb950" }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: "#3fb950",
                animation: "pulse 1.5s infinite",
              }} />
              LIVE
            </div>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div style={{ borderBottom: "1px solid #30363d", padding: "0 24px" }}>
        {(["live", "stats"] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); if (t === "stats") loadStats(); }}
            style={{
              background: "none",
              border: "none",
              color: tab === t ? "#e6edf3" : "#8b949e",
              borderBottom: tab === t ? "2px solid #f78166" : "2px solid transparent",
              padding: "10px 16px",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: tab === t ? 600 : 400,
              textTransform: "capitalize",
            }}
          >
            {t === "live" ? "Live Feed" : "Statistics"}
          </button>
        ))}
      </div>

      {/* Content */}
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
        {tab === "live" && <LiveFeed results={results} />}
        {tab === "stats" && <StatsPanel stats={stats} />}
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
