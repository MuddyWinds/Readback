import { useEffect, useRef } from "react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";

import { AnalysisResult } from "../components/LiveFeed";
import { WS_URL } from "../lib/api";
import { DateFilter } from "../lib/format";
import { applyAnalysis } from "../lib/results-reducer";

export type WsState = "connecting" | "connected" | "reconnecting" | "offline";

/**
 * Apply one raw WS message to the query cache. This is pure with respect to
 * React and unit-testable against a real QueryClient.
 */
export function handleSocketMessage(
  qc: QueryClient,
  raw: string,
  dateFilter: DateFilter,
  onAnalysis?: (data: AnalysisResult) => void,
): void {
  const msg = JSON.parse(raw);
  if (msg.type === "analysis") {
    qc.setQueryData<AnalysisResult[]>(
      ["results", dateFilter],
      (prev) => applyAnalysis(prev, msg, dateFilter),
    );
    onAnalysis?.(msg.data);
  } else if (msg.type === "pipeline") {
    qc.setQueryData(["pipelineStatus"], msg.data);
  }
}

export function useLiveSocket(
  dateFilter: DateFilter,
  onStateChange?: (s: WsState) => void,
  onAnalysis?: (data: AnalysisResult) => void,
): void {
  const qc = useQueryClient();

  const dateRef = useRef(dateFilter);
  useEffect(() => { dateRef.current = dateFilter; }, [dateFilter]);
  const stateRef = useRef(onStateChange);
  useEffect(() => { stateRef.current = onStateChange; }, [onStateChange]);
  const analysisRef = useRef(onAnalysis);
  useEffect(() => { analysisRef.current = onAnalysis; }, [onAnalysis]);

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (!alive) return;
      stateRef.current?.(wsRef.current ? "reconnecting" : "connecting");
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => stateRef.current?.("connected");
      ws.onmessage = (e) =>
        handleSocketMessage(qc, e.data, dateRef.current, analysisRef.current);
      ws.onclose = () => {
        if (alive) {
          stateRef.current?.("reconnecting");
          retryTimer = setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      alive = false;
      stateRef.current?.("offline");
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, [qc]);
}
