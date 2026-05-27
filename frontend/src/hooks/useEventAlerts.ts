import { useCallback, useEffect, useRef } from "react";
import { useNotifications } from "../components/notifications/NotificationProvider";
import { useSettings } from "../SettingsContext";
import { getCardSeverity } from "../lib/severity";
import { shouldAlert, AlertFloor } from "../lib/alerts";
import type { AnalysisResult } from "../lib/types";

/**
 * Returns an onAnalysis(data) callback for useLiveSocket. When `data` meets the
 * settings alert floor, enqueues a toast whose click invokes `onNavigate(data)`.
 * Stable identity; reads the floor/nav handler via refs to avoid stale closures.
 */
export function useEventAlerts(onNavigate: (r: AnalysisResult) => void): (data: AnalysisResult) => void {
  const { enqueue } = useNotifications();
  const { settings } = useSettings();

  const floor = (settings?.runtime?.alert_min_severity ?? "high") as AlertFloor;
  const floorRef = useRef(floor);
  useEffect(() => { floorRef.current = floor; }, [floor]);
  const navRef = useRef(onNavigate);
  useEffect(() => { navRef.current = onNavigate; }, [onNavigate]);

  return useCallback((data: AnalysisResult) => {
    try {
      if (!data) return;
      const sev = getCardSeverity(data);
      if (!shouldAlert(sev, floorRef.current)) return;
      enqueue({
        code: data.airport_code,
        severity: sev,
        summary: data.summary,
        onClick: () => navRef.current(data),
      });
    } catch {
      // Best-effort UI: a malformed message must never break the socket path.
    }
  }, [enqueue]);
}
