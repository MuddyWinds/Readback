import { describe, it, expect } from "vitest";
import { resolveExcerptMarks, tokenizeBlock } from "./excerptHighlight";

describe("resolveExcerptMarks", () => {
  it("locates an exact excerpt and returns its verbatim range", () => {
    const blocks = [{ blockId: "raw", text: "Cathay 250 descend flight level 100" }];
    const marks = [{ n: 1, excerpt: "descend flight level 100" }];
    const out = resolveExcerptMarks(blocks, marks);
    expect(out).toEqual([{ n: 1, blockId: "raw", start: 11, end: 35 }]);
    expect(blocks[0].text.slice(11, 35)).toBe("descend flight level 100");
  });

  it("matches case- and whitespace-insensitively but slices verbatim", () => {
    const blocks = [{ blockId: "raw", text: "Turn  LEFT   heading 270" }];
    const marks = [{ n: 1, excerpt: "turn left heading" }];
    const out = resolveExcerptMarks(blocks, marks);
    expect(out).toHaveLength(1);
    const { start, end } = out[0];
    expect(blocks[0].text.slice(start, end)).toBe("Turn  LEFT   heading");
  });

  it("omits a mark whose excerpt is not found", () => {
    const blocks = [{ blockId: "raw", text: "Cleared to land" }];
    const marks = [{ n: 1, excerpt: "go around" }];
    expect(resolveExcerptMarks(blocks, marks)).toEqual([]);
  });

  it("allocates the same excerpt once even if it appears in two blocks", () => {
    const blocks = [
      { blockId: "seg-0", text: "cleared to land" },
      { blockId: "seg-1", text: "cleared to land" },
    ];
    const marks = [{ n: 1, excerpt: "cleared to land" }];
    const out = resolveExcerptMarks(blocks, marks);
    expect(out).toEqual([{ n: 1, blockId: "seg-0", start: 0, end: 15 }]);
  });

  it("skips a later mark that overlaps an already-claimed range", () => {
    const blocks = [{ blockId: "raw", text: "descend flight level 100 now" }];
    const marks = [
      { n: 1, excerpt: "descend flight level 100" },
      { n: 2, excerpt: "flight level 100" },
    ];
    const out = resolveExcerptMarks(blocks, marks);
    expect(out.map(a => a.n)).toEqual([1]);
  });

  it("ignores empty/whitespace excerpts", () => {
    const blocks = [{ blockId: "raw", text: "anything" }];
    expect(resolveExcerptMarks(blocks, [{ n: 1, excerpt: "   " }])).toEqual([]);
  });
});

describe("tokenizeBlock", () => {
  it("splits a block into ordered text and mark tokens", () => {
    const text = "Cathay 250 descend flight level 100";
    const allocations = [{ n: 1, blockId: "raw", start: 11, end: 35 }];
    expect(tokenizeBlock(text, allocations)).toEqual([
      { type: "text", text: "Cathay 250 " },
      { type: "mark", text: "descend flight level 100", n: 1, start: 11, end: 35 },
    ]);
  });

  it("returns a single text token when there are no allocations", () => {
    expect(tokenizeBlock("plain text", [])).toEqual([
      { type: "text", text: "plain text" },
    ]);
  });
});
