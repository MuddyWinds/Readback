import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (orig) => {
  const actual = await (orig as any)();
  return { ...actual, fetchJson: vi.fn().mockResolvedValue({ ok: true }) };
});

import { StatusWorkflow } from "./StatusWorkflow";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("StatusWorkflow onChanged", () => {
  it("fires onChanged after a successful status change", async () => {
    const onChanged = vi.fn();
    render(wrap(<StatusWorkflow resultId={1} initial="new" onChanged={onChanged} />));

    fireEvent.click(screen.getByText(/confirmed/i));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("confirmed"));
  });
});
