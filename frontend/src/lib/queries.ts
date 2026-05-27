import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { AnalysisResult } from "../components/LiveFeed";
import { API_BASE, fetchJson } from "./api";
import { DateFilter, getStartDate } from "./format";
import { PipelineStatus } from "./types";

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
