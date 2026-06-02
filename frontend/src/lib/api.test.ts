import { expect, test } from "vitest";

import { exportUrl, resolveApiBase, resolveWsUrl } from "./api";

test("defaults the API base to the page origin when no env override is set", () => {
  expect(resolveApiBase({}, { origin: "https://readback.example.com" }))
    .toBe("https://readback.example.com");
});

test("an explicit VITE_API_BASE overrides the page origin (trailing slash trimmed)", () => {
  expect(resolveApiBase({ VITE_API_BASE: "http://localhost:8000/" }, { origin: "https://x" }))
    .toBe("http://localhost:8000");
});

test("derives a same-origin ws:// URL from an http page", () => {
  expect(resolveWsUrl({}, { protocol: "http:", host: "readback.example.com" }))
    .toBe("ws://readback.example.com/ws/live");
});

test("derives a same-origin wss:// URL from an https page", () => {
  expect(resolveWsUrl({}, { protocol: "https:", host: "readback.example.com" }))
    .toBe("wss://readback.example.com/ws/live");
});

test("an explicit VITE_WS_URL overrides the derived socket URL", () => {
  expect(resolveWsUrl({ VITE_WS_URL: "ws://localhost:8000/ws/live" }, { protocol: "https:", host: "x" }))
    .toBe("ws://localhost:8000/ws/live");
});

test("builds an export URL with format and filters", () => {
  const url = exportUrl({ format: "csv", startDate: "2026-05-01T00:00:00", airport: "KSFO" });

  expect(url).toContain("/api/export?");
  expect(url).toContain("format=csv");
  expect(url).toContain("start_date=2026-05-01");
  expect(url).toContain("airport=KSFO");
});
