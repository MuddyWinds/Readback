import React from "react";
import { PipelineStatus } from "../../lib/types";
import { FeedChips } from "./FeedChips";
import styles from "./HeaderBar.module.css";

type StatusVar =
  | "var(--sev-critical)"
  | "var(--sev-medium)"
  | "var(--accent)"
  | "var(--sev-standard)";

interface Feed {
  label: string;
  url: string;
  code: string;
}

interface PipelineStatusStripProps {
  status: PipelineStatus | null;
  apiError: string | null;
  feeds: Feed[];
  activeFeeds: Set<string>;
  activeAudio: string | null;
  airportFilter: string;
  onAirportSelect: (code: string) => void;
  onAudioStop: () => void;
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
}: PipelineStatusStripProps) {
  const hardError = apiError;
  const softError = status?.last_gemini_error || status?.last_error || null;

  let statusLabel: string;
  let statusVar: StatusVar;
  let statusTooltip: string | undefined;

  if (hardError) {
    statusLabel = "API unreachable";
    statusVar = "var(--sev-critical)";
    statusTooltip = hardError;
  } else if (status?.last_gemini_error) {
    statusLabel = "Gemini Down";
    statusVar = "var(--sev-medium)";
    statusTooltip = status.last_gemini_error;
  } else if (softError) {
    statusLabel = "Pipeline error";
    statusVar = "var(--sev-medium)";
    statusTooltip = softError;
  } else if (status?.queued_transcripts) {
    statusLabel = "Batch Queued";
    statusVar = "var(--accent)";
  } else {
    statusLabel = "Listening";
    statusVar = "var(--sev-standard)";
  }

  return (
    <div className={styles.stripWrap}>
      {/* Status pill */}
      <div
        title={statusTooltip}
        className={`${styles.statusPill} ${statusTooltip ? styles.statusPillHelp : styles.statusPillDefault}`}
      >
        <span
          className={styles.statusDot}
          style={{ background: statusVar }}
        />
        <span
          className={styles.statusLabel}
          style={{ color: statusVar }}
        >{statusLabel}</span>
      </div>

      {/* Airport chip row */}
      <FeedChips
        feeds={feeds}
        activeFeeds={activeFeeds}
        activeAudio={activeAudio}
        airportFilter={airportFilter}
        status={status}
        onToggle={onAirportSelect}
        onAudioStop={onAudioStop}
      />
    </div>
  );
}

export interface HeaderBarProps {
  feeds: Feed[];
  activeFeeds: Set<string>;
  activeAudio: string | null;
  airportFilter: string;
  pipelineStatus: PipelineStatus | null;
  apiError: string | null;
  isRunning: boolean;
  starting: boolean;
  stopping: boolean;
  isMobile: boolean;
  feedCount: number;
  onStart: () => void;
  onStop: () => void;
  onAirportSelect: (code: string) => void;
  onAudioStop: () => void;
}

export function HeaderBar({
  feeds,
  activeFeeds,
  activeAudio,
  airportFilter,
  pipelineStatus,
  apiError,
  isRunning,
  starting,
  stopping,
  isMobile,
  feedCount,
  onStart,
  onStop,
  onAirportSelect,
  onAudioStop,
}: HeaderBarProps) {
  return (
    <header className={`${styles.header} ${isMobile ? styles.headerMobile : styles.headerDesktop}`}>
      <div className={`${styles.brandCol} ${isMobile ? styles.brandColMobile : styles.brandColDesktop}`}>
        <h1 className={`${styles.title} ${isMobile ? styles.titleMobile : styles.titleDesktop}`}>
          ✈ Readback
        </h1>
        {!isMobile && <p className={styles.subtitle}>ATC phraseology, read back to you</p>}
      </div>

      {isRunning && (
        <div className={isMobile ? styles.statusWrapMobile : styles.statusWrapDesktop}>
          <PipelineStatusStrip
            status={pipelineStatus}
            apiError={apiError}
            feeds={feeds}
            activeFeeds={activeFeeds}
            activeAudio={activeAudio}
            airportFilter={airportFilter}
            onAirportSelect={onAirportSelect}
            onAudioStop={onAudioStop}
          />
        </div>
      )}

      <div className={`${styles.headerActions} ${isMobile ? styles.headerActionsMobile : styles.headerActionsDesktop}`}>
        {/* Start / Stop */}
        {!isRunning ? (
          <button
            onClick={onStart}
            disabled={starting}
            aria-label="Start all monitored ATC feeds"
            className={`${starting ? styles.btnStartActive : styles.btnStart}${isMobile ? ` ${styles.btnMinHeightMobile}` : ""}`}
          >
            {starting ? "Starting..." : `▶ Start All (${feedCount})`}
          </button>
        ) : (
          <button
            onClick={onStop}
            disabled={stopping}
            aria-label="Stop all monitored ATC feeds"
            className={`${stopping ? styles.btnStopActive : styles.btnStop} ${isMobile ? styles.btnStopMobile : styles.btnStopDesktop}${isMobile ? ` ${styles.btnMinHeightMobile}` : ""}`}
          >
            {stopping ? "Stopping..." : isMobile ? "■ Stop" : "■ Stop All"}
          </button>
        )}

        {isRunning && (
          <div className={styles.liveBadge}>
            <span className={styles.liveDot} />
            {!isMobile && "LIVE"}
          </div>
        )}
      </div>
    </header>
  );
}
