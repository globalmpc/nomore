import { describe, expect, it } from "vitest";
import { groupItems, idf, similarity } from "../src/group.js";
import { normalize, tokens } from "../src/normalize.js";

const items = [
  ["a", "use pnpm, not npm"],
  ["b", "no, use pnpm instead of npm"],
  ["c", "npm 말고 pnpm 써"],
  ["d", "npm 말고 pnpm 써 주세요"],
  ["e", "don't commit"],
].map(([id, text], i) => ({ id, ts: `2026-10-0${i + 1}T00:00:00Z`, norm: normalize(text) }));
const run = (xs: typeof items) => groupItems(xs, (c) => tokens(c.norm), 0.4);
const ids = (gs: ReturnType<typeof run>) => gs.map((g) => g.members.map((m) => m.id));

describe("similarity", () => {
  it("is 1 for equal sets and 0 for disjoint ones", () => {
    const w = idf([["a", "b"], ["c"]]);
    expect(similarity(["a", "b"], ["a", "b"], w)).toBe(1);
    expect(similarity(["a"], ["c"], w)).toBe(0);
  });
});

describe("groupItems", () => {
  it("joins similar items, including ones whose shared tokens are common", () => {
    expect(ids(run(items))).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });
  it("picks the earliest item as representative on a tie", () => {
    const g = run(items).find((g) => g.members.length === 2 && g.members[0].id === "a")!;
    expect(g.representative.id).toBe("a");
    expect(g.id).toMatch(/^[0-9a-f]{8}$/);
  });
  it("is deterministic under shuffling", () => {
    const shuffled = [items[3], items[0], items[4], items[2], items[1]];
    expect(JSON.stringify(run(shuffled))).toBe(JSON.stringify(run(items)));
  });
});

describe("groupItems regressions", () => {
  const mk = (texts: string[]) =>
    texts.map((text, i) => ({ id: String(i).padStart(6, "0"), ts: `2026-10-01T00:00:${String(i % 60).padStart(2, "0")}Z`, norm: normalize(text) }));

  it("leaves out items with no tokens, so group ids stay unique", () => {
    const gs = run(mk(["no", "not this", "use pnpm", "no!"]));
    expect(gs.map((g) => g.members.map((m) => m.norm))).toEqual([["use pnpm"]]);
  });

  it("similarity is exactly symmetric", () => {
    const a = ["b", "e", "f", "i"], b = ["a", "h", "i"];
    const w = idf([a, b, ["b", "c", "e", "h", "i", "j"], ["a"], ["b", "c"]]);
    expect(similarity(a, b, w)).toBe(similarity(b, a, w));
  });

  it("picks the representative from similarity to its own group only", () => {
    const xs = [
      { id: "1", ts: "2026-10-01", t: ["pnpm", "use", "npm"] },
      { id: "2", ts: "2026-10-02", t: ["pnpm", "use", "npm", "yarn"] },
      { id: "3", ts: "2026-10-03", t: ["yarn", "lockfile", "delete", "never", "again"] }, // other group, shares "yarn"
    ];
    const g = groupItems(xs, (x) => x.t, 0.4).find((g) => g.members.length === 2)!;
    expect(g.representative.id).toBe("1");
  });

  it("handles a long chain of joined items without overflowing the stack", () => {
    const xs = Array.from({ length: 20000 }, (_, i) => ({ id: String(i).padStart(6, "0"), ts: "2026-10-01T00:00:00Z", t: [`t${i}`, `t${i + 1}`] }));
    const gs = groupItems(xs, (x) => x.t, 0.3);
    expect(gs).toHaveLength(1);
  });
});

describe("groupItems at scale", () => {
  // Deterministic pseudo-random items over a small vocabulary: the worst case for candidate pairs.
  const make = (n: number, vocab: number, seed = 7) => {
    let s = seed;
    const rnd = (k: number) => (s = (s * 1103515245 + 12345) % 2147483648) % k;
    return Array.from({ length: n }, (_, i) => ({
      id: String(i).padStart(6, "0"),
      ts: `2026-10-${String(1 + rnd(28)).padStart(2, "0")}`,
      t: Array.from({ length: 2 + rnd(6) }, () => `w${rnd(vocab)}`),
    }));
  };

  // Reference: compare every pair, union at >= threshold, score by summed similarity to all other members.
  const brute = (xs: ReturnType<typeof make>, threshold: number) => {
    const items = [...xs].filter((x) => x.t.length > 0).sort((a, b) => (a.id < b.id ? -1 : 1));
    const toks = items.map((x) => [...new Set(x.t)].sort());
    const w = idf(toks);
    const parent = items.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) if (similarity(toks[i], toks[j], w) >= threshold) parent[find(i)] = find(j);
    const comps = new Map<number, number[]>();
    items.forEach((_, i) => comps.set(find(i), [...(comps.get(find(i)) ?? []), i]));
    return [...comps.values()]
      .map((idx) => {
        const score = (i: number) => Math.round(idx.reduce((sum, j) => (j === i ? sum : sum + similarity(toks[i], toks[j], w)), 0) * 1e9);
        const best = [...idx].sort((a, b) => score(b) - score(a) || (items[a].ts < items[b].ts ? -1 : items[a].ts > items[b].ts ? 1 : a - b))[0];
        return { members: idx.map((i) => items[i].id), representative: items[best].id };
      })
      .sort((a, b) => (a.representative < b.representative ? -1 : 1));
  };

  it("gives exactly the brute-force groups and representatives", () => {
    for (const [n, vocab, threshold] of [[300, 30, 0.6], [300, 12, 0.4], [200, 8, 0.3]] as const) {
      const xs = make(n, vocab);
      const got = groupItems(xs, (x) => x.t, threshold).map((g) => ({ members: g.members.map((m) => m.id), representative: g.representative.id }));
      expect(got).toEqual(brute(xs, threshold));
    }
  });

  it("groups 20,000 items over a 40-word vocabulary in seconds", () => {
    const t0 = Date.now();
    groupItems(make(20000, 40), (x) => x.t, 0.6);
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 120_000);
});
