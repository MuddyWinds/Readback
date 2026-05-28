import { expect, test } from "vitest";
import { cssVar } from "./theme-colors";

test("cssVar reads a custom property from :root", () => {
  document.documentElement.style.setProperty("--probe-color", "#abcdef");
  expect(cssVar("--probe-color")).toBe("#abcdef");
});

test("cssVar trims whitespace and returns '' for an undefined token", () => {
  document.documentElement.style.setProperty("--probe-spaced", "  #123456  ");
  expect(cssVar("--probe-spaced")).toBe("#123456");
  expect(cssVar("--definitely-not-set")).toBe("");
});
