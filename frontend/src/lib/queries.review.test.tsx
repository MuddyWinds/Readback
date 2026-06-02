import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api", async (orig) => {
  const actual = await (orig as any)();
  return { ...actual, fetchJson: vi.fn().mockResolvedValue([]) };
});

import { fetchJson } from "./api";
import { useReviewQueue } from "./queries";

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useReviewQueue", () => {
  beforeEach(() => {
    (fetchJson as any).mockClear();
  });

  it("requests results filtered by status", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useReviewQueue("new"), { wrapper: makeWrapper(qc) });

    await waitFor(() => expect(fetchJson).toHaveBeenCalled());

    const url = (fetchJson as any).mock.calls[0][0] as string;
    expect(url).toContain("/api/results?status=new");
    expect(qc.getQueryCache().getAll()[0].queryKey[0]).toBe("results");
  });

  it("omits status for the all chip", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useReviewQueue("all"), { wrapper: makeWrapper(qc) });

    await waitFor(() => expect(fetchJson).toHaveBeenCalled());

    const url = (fetchJson as any).mock.calls[0][0] as string;
    expect(url.endsWith("/api/results")).toBe(true);
    expect(url).not.toContain("status=all");
  });
});
