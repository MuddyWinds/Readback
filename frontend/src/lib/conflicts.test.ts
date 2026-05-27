import { expect, test } from "@jest/globals";
import { isActiveAt, detectConflicts } from "./conflicts";
test("isActiveAt is true when ts falls within [from, to]", () => {
  expect(isActiveAt("2026-05-20T00:00:00Z", "2026-05-20T02:00:00Z", "2026-05-20T01:00:00Z")).toBe(true);
});
test("isActiveAt is false when ts is outside the window", () => {
  expect(isActiveAt("2026-05-20T00:00:00Z", "2026-05-20T02:00:00Z", "2026-05-20T03:00:00Z")).toBe(false);
});
test("detectConflicts returns an array (empty for no aircraft)", () => {
  expect(detectConflicts([])).toEqual([]);
});
