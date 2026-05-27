import { expect, test } from "@jest/globals";
import { truncateAtChapter, toDocName } from "./regs";
test("toDocName returns a non-empty label for a regulation id", () => {
  expect(toDocName("14 CFR 91.123").length).toBeGreaterThan(0);
});
test("truncateAtChapter returns a string no longer than its input", () => {
  const reg = "14 CFR 91.123(a)(1) - long trailing chapter text";
  expect(truncateAtChapter(reg).length).toBeLessThanOrEqual(reg.length);
});
