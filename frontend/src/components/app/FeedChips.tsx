import React from "react";
import { PipelineStatus } from "../../lib/types";
import styles from "./FeedChips.module.css";

type StageDotVar =
  | "var(--text-faint)"
  | "var(--sev-standard)"
  | "var(--sev-medium)"
  | "var(--sev-critical)"
  | "var(--text-ghost)";

function stageDotColor(stage: string, active: boolean): StageDotVar {
  if (!active) return "var(--text-faint)";
  if (stage === "error") return "var(--sev-critical)";
  if (stage === "audio") return "var(--sev-standard)";
  if (stage === "transcribing" || stage.startsWith("queued")) return "var(--sev-medium)";
  if (stage === "silent" || stage === "too_short") return "var(--text-ghost)";
  return "var(--sev-standard)";
}

function stageLabel(stage: string, active: boolean): string {
  if (!active) return "off";
  if (stage === "queued_unassessable") return "queued (unassessable)";
  if (stage.startsWith("queued_")) return "queued (" + stage.slice("queued_".length) + ")";
  return stage;
}

export interface Feed {
  label: string;
  url: string;
  code: string;
}

export interface FeedChipsProps {
  feeds: Feed[];
  activeFeeds: Set<string>;
  activeAudio: string | null;
  airportFilter: string;
  status: PipelineStatus | null;
  onToggle: (code: string) => void;
  onAudioStop: () => void;
}

export function FeedChips({
  feeds,
  activeFeeds,
  activeAudio,
  airportFilter,
  status,
  onToggle,
  onAudioStop,
}: FeedChipsProps) {
  return (
    <div className={styles.pillRow}>
      {feeds.map(feed => {
        const active = activeFeeds.has(feed.url);
        const stage = status?.feed_status?.[feed.url]?.stage ?? (active ? "starting" : "off");
        const dot = stageDotColor(stage, active);
        const selected = airportFilter === feed.code;
        const playing = activeAudio === feed.url;
        const chipClass = playing
          ? styles.chipPlaying
          : selected
          ? styles.chipSelected
          : styles.chipDefault;
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
              onToggle(feed.code);
            }}
            title={`${feed.label} — ${stageLabel(stage, active)}`}
            className={`${styles.chip} ${chipClass}`}
          >
            <span
              className={styles.dot}
              style={{ background: dot }}
            />
            {playing && (
              <span className={styles.note}>♪</span>
            )}
            <span>{feed.code}</span>
            {playing && (
              <span
                data-audio-stop
                role="button"
                aria-label={`Stop ${feed.code} audio`}
                title={`Stop ${feed.code} audio`}
                className={styles.stopBtn}
              >
                ✕
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
