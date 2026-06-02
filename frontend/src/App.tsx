import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveFeed, AnalysisResult, Filter } from "./components/LiveFeed";
import { AirportSidebar } from "./components/AirportSidebar";
import { SettingsPage } from "./components/SettingsPage";
import { useSettings } from "./SettingsContext";
import { useWindowWidth } from "./hooks/useWindowWidth";
import { API_BASE, fetchJson } from "./lib/api";
import { DateFilter } from "./lib/format";
import { useMonitorStatus, usePipelineStatus, useResults } from "./lib/queries";
import { useLiveSocket } from "./hooks/useLiveSocket";
import { useEventAlerts } from "./hooks/useEventAlerts";
import { resolveNavTarget } from "./lib/alerts";
import { severityCounts } from "./lib/selectors";
import { HeaderBar } from "./components/app/HeaderBar";
import { TabPeriodBar } from "./components/app/TabPeriodBar";
import { type TabKey } from "./lib/tabs";
import styles from "./App.module.css";

const FILTER_BUTTONS: { key: Filter; label: string }[] = [
  { key: "all",          label: "All" },
  { key: "standard",     label: "Standard" },
  { key: "low",          label: "Low" },
  { key: "medium",       label: "Medium" },
  { key: "high",         label: "High" },
  { key: "critical",     label: "Critical" },
  { key: "unassessable", label: "Unassessable" },
];

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
  const [tab, setTab]                   = useState<TabKey>("live");
  const [filter, setFilter]             = useState<Filter>("all");
  const [airportFilter, setAirportFilter] = useState<string>("all");
  const [noteTypeFilter, setNoteTypeFilter] = useState<string | null>(null);
  const [dateFilter, setDateFilter]     = useState<DateFilter>("all");
  const [activeAudio, setActiveAudio]   = useState<string | null>(null);
  const [actionError, setActionError]   = useState<string | null>(null);
  const [starting, setStarting]         = useState(false);
  const [stopping, setStopping]         = useState(false);
  // Sidebar: which airport's panel is open in Live Feed (null = hidden)
  const [sidebarAirport, setSidebarAirport] = useState<string | null>(null);
  // Aircraft hovered in a feed card → highlighted/flown-to on the airport map
  const [selectedAircraft, setSelectedAircraft] = useState<{ icao24: string | null; callsign: string | null } | null>(null);

  // Toast click → navigate: id of a result card to scroll to + flash once the
  // filter/airport/sidebar state has applied and the card mounts.
  const [pendingScrollId, setPendingScrollId] = useState<number | null>(null);
  const filterRef = useRef(filter);
  useEffect(() => { filterRef.current = filter; }, [filter]);

  const navigateToResult = useCallback((result: AnalysisResult) => {
    const t = resolveNavTarget(result, filterRef.current);
    setTab("live");
    setAirportFilter(t.airportFilter);
    setFilter(t.severityFilter);
    setNoteTypeFilter(null);
    setSidebarAirport(t.sidebarAirport);
    setPendingScrollId(t.resultId ?? null);
  }, []);

  const openResultContext = useCallback((
    result: AnalysisResult,
    aircraft: { icao24: string | null; callsign: string | null } | null,
  ) => {
    setTab("live");
    setSidebarAirport(result.airport_code);
    setSelectedAircraft(aircraft);
  }, []);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: queryResults, error: resultsError } = useResults(dateFilter);
  const { data: pipelineStatus = null, error: pipelineError } = usePipelineStatus();
  const { data: monitorStatus, error: monitorError } = useMonitorStatus();
  const results: AnalysisResult[] = queryResults ?? [];

  const onAnalysisAlert = useEventAlerts(navigateToResult);
  useLiveSocket(dateFilter, undefined, onAnalysisAlert);

  // Scroll to + flash the target card once it mounts. The card may not be in
  // the DOM on the first frame after the filter/airport/sidebar change, so we
  // retry for ~10 frames; pendingScrollId clears only once found or exhausted.
  useEffect(() => {
    if (pendingScrollId == null) return;
    let raf = 0;
    let attempts = 0;
    const tryScroll = () => {
      const el = document.getElementById(`result-${pendingScrollId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("result-flash");
        setTimeout(() => el.classList.remove("result-flash"), 1500);
        setPendingScrollId(null);
        return;
      }
      if (++attempts < 10) raf = requestAnimationFrame(tryScroll); // ~10 frames, then give up
      else setPendingScrollId(null);
    };
    raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
  }, [pendingScrollId]);

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
      setNoteTypeFilter(null);
      setSidebarAirport(null);
      setSelectedAircraft(null);
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
    setSelectedAircraft(null);
    setNoteTypeFilter(null);
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
    setNoteTypeFilter(null);
    setSelectedAircraft(null);
  };

  const isRunning  = activeFeeds.size > 0;

  // Filter counts scoped to current airportFilter so badge numbers match what's visible
  const sevCounts = useMemo<Record<Filter, number>>(
    () => severityCounts(results, airportFilter),
    [results, airportFilter],
  );

  const { bp } = useWindowWidth();
  const isMobile  = bp === "mobile";
  const isTablet  = bp === "tablet";
  const isLarge   = bp === "large";

  // ── Render ───────────────────────────────────────────────────────────────────

  // On tablet/mobile, sidebar becomes a bottom drawer instead of a side panel
  const sidebarOpen    = tab === "live" && sidebarAirport !== null;
  const sidebarIsDrawer = sidebarOpen && (isMobile || isTablet);

  return (
    <div className={styles.root}>

      {/* ── Header ── */}
      <HeaderBar
        feeds={feeds}
        activeFeeds={activeFeeds}
        activeAudio={activeAudio}
        airportFilter={airportFilter}
        pipelineStatus={pipelineStatus}
        apiError={apiError}
        isRunning={isRunning}
        starting={starting}
        stopping={stopping}
        isMobile={isMobile}
        feedCount={feeds.length}
        onStart={handleStart}
        onStop={handleStop}
        onAirportSelect={toggleAirport}
        onAudioStop={stopAudio}
      />

      {/* ── Tab + period bar ── */}
      <TabPeriodBar
        tab={tab}
        onTab={setTab}
        dateFilter={dateFilter}
        onDateFilter={setDateFilter}
        isMobile={isMobile}
      />

      {/* ── Content ── */}
      {tab === "settings" ? (
        <div className={styles.contentWrap}>
          {needsSetup && (
            <div className={styles.setupBanner}>
              Add at least one feed and a Gemini API key to get started.
            </div>
          )}
          {settings
            ? <SettingsPage key={settings.gemini_api_key + ":" + settings.feeds.length} />
            : <p className={styles.loadingText}>Loading settings...</p>}
        </div>
      ) : (
        /* Live Feed — flex layout; sidebar is side panel on desktop, drawer on mobile/tablet */
        <div className={styles.liveOuter}>

          {/* Main row: feed + sidebar — centered + capped on large screens */}
          <div className={`${styles.liveMainRow} ${isLarge ? styles.liveMainRowLarge : styles.liveMainRowFull}`}>

            {/* Feed column */}
            <div className={`${styles.feedCol} ${(sidebarOpen && !sidebarIsDrawer) ? styles.feedColExpanded : styles.feedColFull}`}>
              <div className={`${styles.feedInner} ${(sidebarOpen && !sidebarIsDrawer) ? styles.feedInnerFull : styles.feedInnerConstrained} ${isMobile ? styles.feedInnerMobile : styles.feedInnerDesktop}`}>
                {/* Severity filter bar — wraps on small screens */}
                <div className={`${styles.filterBar} ${isMobile ? styles.filterBarMobile : styles.filterBarDesktop}`}>
                  {FILTER_BUTTONS.map(({ key, label }) => {
                    const active = filter === key;
                    const filterAccent = key === "all" ? "var(--accent)" : `var(--sev-${key})`;
                    const displayLabel = isMobile && key === "unassessable" ? "N/A" : label;
                    const btnClass = active
                      ? `${styles.filterBtnActive} ${isMobile ? styles.filterBtnActiveMobile : styles.filterBtnActiveDesktop}`
                      : `${styles.filterBtn} ${isMobile ? styles.filterBtnMobile : styles.filterBtnDesktop}`;
                    const badgeClass = active
                      ? styles.filterBadgeActive
                      : (sevCounts[key] > 0 ? styles.filterBadgeHasCount : styles.filterBadgeInactive);
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          setFilter(key);
                          setNoteTypeFilter(null);
                        }}
                        className={btnClass}
                        style={{ ["--filter-accent" as any]: filterAccent }}
                      >
                        {displayLabel}
                        <span
                          className={`${styles.filterBadge} ${badgeClass}`}
                          style={active ? { color: filterAccent } : undefined}
                        >
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
                    noteTypeFilter={noteTypeFilter}
                    isRunning={isRunning}
                    pipelineStatus={pipelineStatus}
                    apiError={apiError}
                    onSelectAircraft={setSelectedAircraft}
                    onOpenResultContext={openResultContext}
                  />
              </div>
            </div>

            {/* Side panel sidebar (desktop only) */}
            {sidebarOpen && !sidebarIsDrawer && (
              <div className={styles.sidePanel}>
                <AirportSidebar
                  airportCode={sidebarAirport!}
                  onClose={closeSidebar}
                  results={results}
                  selectedAircraft={selectedAircraft}
                />
              </div>
            )}
          </div>

          {/* Bottom drawer sidebar (mobile / tablet) */}
          {sidebarIsDrawer && (
            <div className={isTablet ? styles.drawerDesktop : styles.drawerMobile}>
              <AirportSidebar
                airportCode={sidebarAirport!}
                onClose={closeSidebar}
                results={results}
                selectedAircraft={selectedAircraft}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Advisory footer ── */}
      <footer className={`${styles.footer} ${isMobile ? styles.footerMobile : styles.footerDesktop}`}>
        <p className={styles.footerText}>
          Readback is an educational tool. Transcriptions may be imperfect and feeds are
          often one-sided — notes and events are advisory, not authoritative.
        </p>
      </footer>
    </div>
  );
}
