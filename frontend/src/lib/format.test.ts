import { expect, test } from "@jest/globals";

import { getStartDate, parseTs } from "./format";

test("getStartDate returns null for the 'all' filter", () => {
  expect(getStartDate("all")).toBeNull();
});

test("getStartDate('7d') is ~7 days before now", () => {
  const start = new Date(getStartDate("7d") as string).getTime();
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  expect(Math.abs(start - sevenDaysAgo)).toBeLessThan(5000);
});

test("parseTs treats a naive timestamp as UTC", () => {
  expect(parseTs("2026-05-20T01:00:00").toISOString()).toBe("2026-05-20T01:00:00.000Z");
});

test("parseTs leaves an explicit-Z timestamp unchanged", () => {
  expect(parseTs("2026-05-20T01:00:00Z").toISOString()).toBe("2026-05-20T01:00:00.000Z");
});
