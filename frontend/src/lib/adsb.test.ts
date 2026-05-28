import { expect, test } from "vitest";
import { angularDiff, bearingTo, calcDistNm, hpaToInhg, activeRunway } from "./adsb";

test("angularDiff is the smallest signed/magnitude difference on a circle", () => {
  expect(angularDiff(10, 350)).toBeCloseTo(20, 0); // 20°, not 340°
});

test("calcDistNm ~ 60nm per degree of latitude", () => {
  expect(calcDistNm(0, 0, 1, 0)).toBeGreaterThan(59);
  expect(calcDistNm(0, 0, 1, 0)).toBeLessThan(61);
});

test("bearingTo due north is ~0/360 and due east is ~90", () => {
  expect(bearingTo(0, 0, 1, 0)).toBeCloseTo(0, 0);
  expect(bearingTo(0, 0, 0, 1)).toBeCloseTo(90, 0);
});

test("hpaToInhg converts standard pressure", () => {
  expect(hpaToInhg(1013.25)).toBe("29.92");
});

test("activeRunway picks the runway whose heading best matches the wind", () => {
  const runways = [{ ident: "09", heading_deg: 90 }, { ident: "27", heading_deg: 270 }];
  expect(activeRunway(270, runways)).toBe("27");
});
