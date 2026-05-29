import { expect, test } from "vitest";
import { normalizeCallsign, callsignsMatch } from "./callsign";

test("normalizeCallsign uppercases and strips spaces / dashes", () => {
  expect(normalizeCallsign("cpa 123")).toBe("CPA123");
  expect(normalizeCallsign("AAL-456")).toBe("AAL456");
});

test("normalizeCallsign strips leading zeros from the numeric block", () => {
  expect(normalizeCallsign("AAL0123")).toBe("AAL123");
  expect(normalizeCallsign("DLH009")).toBe("DLH9");
});

test("normalizeCallsign preserves N-numbers verbatim (no leading-zero strip)", () => {
  expect(normalizeCallsign("N123AB")).toBe("N123AB");
});

test("normalizeCallsign returns null for non-strings / empty", () => {
  expect(normalizeCallsign(null)).toBeNull();
  expect(normalizeCallsign(undefined)).toBeNull();
  expect(normalizeCallsign(["AAL123"] as any)).toBeNull();
  expect(normalizeCallsign("   ")).toBeNull();
});

test("callsignsMatch handles zero-padding and casing", () => {
  // Real case: Gemini says AAL123, OpenSky reports AAL0123.
  expect(callsignsMatch("AAL123", "AAL0123")).toBe(true);
  expect(callsignsMatch("aal123", "AAL123")).toBe(true);
  expect(callsignsMatch("AAL123", "AAL124")).toBe(false);
});
