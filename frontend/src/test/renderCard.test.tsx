import { describe, it, expect } from "vitest";
import { makeResult } from "./renderCard";

describe("makeResult", () => {
  it("builds a default assessable result", () => {
    const r = makeResult();
    expect(r.airport_code).toBe("KJFK");
    expect(r.assessable).toBe(true);
  });
});
