import { describe, expect, it } from "vitest";
import { pickVictims, type EvictionCandidate } from "../store";

function row(id: number, patch: Partial<EvictionCandidate> = {}): EvictionCandidate {
  return { id, pinned: false, hits: 0, updatedAt: new Date(2026, 0, id), ...patch };
}

describe("pickVictims", () => {
  it("drops nothing while the subject is under its cap", () => {
    expect(pickVictims([row(1), row(2)], 5)).toEqual([]);
  });

  it("drops exactly the overflow, coldest first", () => {
    const rows = [row(1), row(2), row(3), row(4)];
    expect(pickVictims(rows, 2)).toEqual([1, 2]);
  });

  it("never drops a pinned row", () => {
    const rows = [row(1, { pinned: true }), row(2), row(3)];
    expect(pickVictims(rows, 1)).toEqual([2, 3]);
  });

  it("stays over the cap rather than dropping pinned rows", () => {
    const rows = [row(1, { pinned: true }), row(2, { pinned: true })];
    expect(pickVictims(rows, 1)).toEqual([]);
  });

  it("lets frequent use save an older row", () => {
    const rows = [
      row(1, { updatedAt: new Date(2026, 0, 1), hits: 60 }),
      row(2, { updatedAt: new Date(2026, 0, 20), hits: 0 }),
      row(3, { updatedAt: new Date(2026, 0, 25), hits: 0 }),
    ];
    expect(pickVictims(rows, 2)).toEqual([2]);
  });
});
