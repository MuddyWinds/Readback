import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AnalysisResult } from "./types";
import { API_BASE, fetchJson } from "./api";
import { DateFilter, getStartDate } from "./format";
import { PipelineStatus } from "./types";

const SHORT = 5 * 60 * 1000;
const ADSB = 60 * 1000;

export function useResults(dateFilter: DateFilter) {
  return useQuery({
    queryKey: ["results", dateFilter],
    queryFn: () => {
      const startDate = getStartDate(dateFilter);
      const url = startDate
        ? `${API_BASE}/api/results?start_date=${encodeURIComponent(startDate)}`
        : `${API_BASE}/api/results`;
      return fetchJson<AnalysisResult[]>(url);
    },
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}

export function useStats(dateFilter: DateFilter, airport?: string) {
  const startDate = getStartDate(dateFilter);
  return useQuery({
    queryKey: ["stats", dateFilter, airport ?? null],
    queryFn: () => {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (airport) params.set("airport", airport);
      const qs = params.toString();
      return fetchJson<any>(`${API_BASE}/api/stats${qs ? `?${qs}` : ""}`);
    },
  });
}

export function useReviewQueue(status: string) {
  const qs = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
  return useQuery<AnalysisResult[]>({
    queryKey: ["results", { status }],
    queryFn: () => fetchJson<AnalysisResult[]>(`${API_BASE}/api/results${qs}`),
  });
}

export function useCallsigns() {
  return useQuery({
    queryKey: ["callsigns"],
    queryFn: () => fetchJson<{ callsign: string; count: number }[]>(`${API_BASE}/api/callsigns`),
  });
}

export function useStudySheet(callsign: string | null) {
  return useQuery({
    queryKey: ["studySheet", callsign],
    enabled: !!callsign,
    queryFn: () =>
      fetchJson<{ callsign: string; transmission_count: number; study_sheet: string }>(
        `${API_BASE}/api/study-sheet/by-callsign/${encodeURIComponent(callsign || "")}`,
      ),
  });
}

export function usePipelineStatus() {
  return useQuery({
    queryKey: ["pipelineStatus"],
    queryFn: () => fetchJson<PipelineStatus>(`${API_BASE}/api/pipeline/status`),
    refetchInterval: 5000,
  });
}

export function useMonitorStatus() {
  return useQuery({
    queryKey: ["monitorStatus"],
    queryFn: () =>
      fetchJson<{ feeds?: Record<string, boolean> }>(`${API_BASE}/api/monitor/status`),
  });
}

export function useMetar(code: string) {
  return useQuery({
    queryKey: ["metar", code],
    enabled: !!code,
    queryFn: () => fetchJson<any>(`${API_BASE}/api/metar/${code}`),
  });
}

export function useNotam(code: string) {
  return useQuery({
    queryKey: ["notam", code],
    enabled: !!code,
    staleTime: SHORT,
    queryFn: () => fetchJson<{ notams?: any[] }>(`${API_BASE}/api/notam/${code}`),
  });
}

export function useHazards(code: string) {
  return useQuery({
    queryKey: ["hazards", code],
    enabled: !!code,
    staleTime: SHORT,
    queryFn: () => fetchJson<any>(`${API_BASE}/api/hazards/${code}`),
  });
}

export function useAdsb(code: string, refetchInterval?: number) {
  return useQuery({
    queryKey: ["adsb", code],
    enabled: !!code,
    staleTime: ADSB,
    refetchInterval,
    queryFn: () => fetchJson<{ aircraft?: any[] }>(`${API_BASE}/api/adsb/${code}`),
  });
}

export function useAdsbSnapshot(resultId: number | undefined) {
  return useQuery({
    queryKey: ["adsbSnapshot", resultId],
    enabled: resultId != null,
    queryFn: () => fetchJson<any>(`${API_BASE}/api/adsb-snapshot/${resultId}`),
  });
}

export function useUpdateResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; patch: { status?: string; reviewer_notes?: string } }) =>
      fetchJson(`${API_BASE}/api/results/${vars.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars.patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["results"] });
    },
  });
}
