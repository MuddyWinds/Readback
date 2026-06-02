export interface ExcerptMark {
  n: number;
  label?: string;
  excerpt: string;
}

export interface TextBlock {
  blockId: string;
  text: string;
}

export interface MarkAllocation {
  n: number;
  label?: string;
  blockId: string;
  start: number;
  end: number;
}

export type BlockToken =
  | { type: "text"; text: string }
  | { type: "mark"; text: string; n: number; label?: string; start: number; end: number };

/** Lowercase + collapse runs of whitespace, keeping a map from each normalized
 *  char back to its index in the original text so matches slice verbatim. */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) {
      if (!prevSpace && chars.length > 0) {
        chars.push(" ");
        map.push(i);
      }
      prevSpace = true;
    } else {
      chars.push(c.toLowerCase());
      map.push(i);
      prevSpace = false;
    }
  }
  while (chars.length && chars[chars.length - 1] === " ") {
    chars.pop();
    map.pop();
  }
  return { norm: chars.join(""), map };
}

/**
 * Allocate excerpt marks globally across all blocks. Marks are processed in
 * display order; each takes the first non-overlapping match (scanning blocks in
 * order, then positions). A mark with no such match is omitted (not-found).
 */
export function resolveExcerptMarks(blocks: TextBlock[], marks: ExcerptMark[]): MarkAllocation[] {
  const normBlocks = blocks.map(b => ({ blockId: b.blockId, ...normalizeWithMap(b.text) }));
  const claimed = new Map<string, Array<[number, number]>>();
  const out: MarkAllocation[] = [];

  for (const mark of marks) {
    const needle = normalizeWithMap(mark.excerpt).norm;
    if (!needle) continue;

    let found: MarkAllocation | null = null;
    for (const nb of normBlocks) {
      let from = 0;
      while (from <= nb.norm.length) {
        const idx = nb.norm.indexOf(needle, from);
        if (idx === -1) break;
        const start = nb.map[idx];
        const end = nb.map[idx + needle.length - 1] + 1;
        const ranges = claimed.get(nb.blockId) ?? [];
        const overlaps = ranges.some(([s, e]) => start < e && end > s);
        if (!overlaps) {
          found = { n: mark.n, ...(mark.label ? { label: mark.label } : {}), blockId: nb.blockId, start, end };
          break;
        }
        from = idx + 1;
      }
      if (found) break;
    }

    if (found) {
      const ranges = claimed.get(found.blockId) ?? [];
      ranges.push([found.start, found.end]);
      claimed.set(found.blockId, ranges);
      out.push(found);
    }
  }
  return out;
}

/** Slice one block's text into ordered text/mark data tokens. */
export function tokenizeBlock(text: string, allocations: MarkAllocation[]): BlockToken[] {
  const sorted = [...allocations].sort((a, b) => a.start - b.start);
  const tokens: BlockToken[] = [];
  let cursor = 0;
  for (const a of sorted) {
    if (a.start > cursor) {
      tokens.push({ type: "text", text: text.slice(cursor, a.start) });
    }
    tokens.push({
      type: "mark",
      text: text.slice(a.start, a.end),
      n: a.n,
      ...(a.label ? { label: a.label } : {}),
      start: a.start,
      end: a.end,
    });
    cursor = a.end;
  }
  if (cursor < text.length) {
    tokens.push({ type: "text", text: text.slice(cursor) });
  }
  return tokens;
}
