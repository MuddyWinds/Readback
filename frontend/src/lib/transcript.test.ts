import { expect, test } from "@jest/globals";
import { phoneticExpand, extractCallsign, normalizeNumeric, isAsrAmbiguous, parseBullets, extractActions } from "./transcript";

test("phoneticExpand maps airline name + number words to a collapsed callsign", () => {
  expect(phoneticExpand("delta one two three")).toBe("DAL123");
});
test("extractCallsign falls back to phonetic expansion with low confidence", () => {
  expect(extractCallsign("Delta 123 cleared to land")).toEqual({ callsign: "DAL123", confidence: "low" });
});
test("extractCallsign reads a direct callsign with high confidence", () => {
  expect(extractCallsign("DAL123 contact ground")).toEqual({ callsign: "DAL123", confidence: "high" });
});
test("normalizeNumeric strips phonetics/spaces to bare alphanumerics, upper-cased", () => {
  expect(normalizeNumeric("niner")).toBe("9");
  expect(normalizeNumeric("two three")).toBe("2THREE");
});
test("isAsrAmbiguous: null inputs false; identical normalized true", () => {
  expect(isAsrAmbiguous(null, null)).toBe(false);
  expect(isAsrAmbiguous("maintain 5000", "maintain 5000")).toBe(true);
});
test("parseBullets splits on sentence boundaries and drops fragments of length <= 8", () => {
  expect(parseBullets("First sentence here. Short. This is the second sentence."))
    .toEqual(["First sentence here", "This is the second sentence"]);
});
test("extractActions matches instruction keywords", () => {
  expect(extractActions("climb and maintain 5000, contact tower")).toEqual(["CLIMB", "FREQ CHANGE"]);
});
