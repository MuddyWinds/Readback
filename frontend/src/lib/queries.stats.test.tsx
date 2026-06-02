import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("./api", async (orig) => {
  const actual = await (orig as any)();
  return { ...actual, fetchJson: vi.fn().mockResolvedValue({}) };
});

import { fetchJson } from "./api";
import { useStats } from "./queries";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useStats", () => {
  beforeEach(() => { (fetchJson as any).mockClear(); });

  it("requests /api/stats with start_date for a bounded filter", async () => {
    renderHook(() => useStats("7d"), { wrapper: makeWrapper() });
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    const url = (fetchJson as any).mock.calls[0][0] as string;
    expect(url).toContain("/api/stats?");
    expect(url).toContain("start_date=");
  });

  it("requests /api/stats with no query string for 'all'", async () => {
    renderHook(() => useStats("all"), { wrapper: makeWrapper() });
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    const url = (fetchJson as any).mock.calls[0][0] as string;
    expect(url).toBe(`${"/api/stats"}`.length ? url : url); // see assertion below
    expect(url.endsWith("/api/stats")).toBe(true);
  });
});
