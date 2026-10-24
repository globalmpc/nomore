import { createHash } from "node:crypto";

export function idf(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  return new Map([...df].map(([t, n]) => [t, Math.log(1 + docs.length / n)]));
}

const sortedSet = (ts: string[]) => [...new Set(ts)].sort();

// Merge over sorted token sets: the sums run in token order, so the result is the same bit for bit both ways.
function simSorted(a: string[], b: string[], w: Map<string, number>): number {
  let inter = 0, union = 0, i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (a[i] === b[j]) {
      const x = w.get(a[i]) ?? 0;
      inter += x;
      union += x;
      i++, j++;
    } else if (j >= b.length || (i < a.length && a[i] < b[j])) union += w.get(a[i++]) ?? 0;
    else union += w.get(b[j++]) ?? 0;
  }
  return union === 0 ? 0 : inter / union;
}

export function similarity(a: string[], b: string[], w: Map<string, number>): number {
  return simSorted(sortedSet(a), sortedSet(b), w);
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Items with no tokens (e.g. a bare "no") can't be compared or turned into a rule, so they are left out.
export function groupItems<T extends { id: string; ts: string }>(
  items: T[],
  tokensOf: (t: T) => string[],
  threshold: number,
): { id: string; members: T[]; representative: T }[] {
  const xs = items.map((x) => ({ x, t: sortedSet(tokensOf(x)) })).filter((e) => e.t.length > 0);
  xs.sort((a, b) => byId(a.x, b.x));
  const toks = xs.map((e) => e.t);
  const w = idf(toks);

  const parent = xs.map((_, i) => i);
  const find = (i: number) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const push = <K>(m: Map<K, number[]>, k: K, v: number) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);

  // Identical token sets always join (similarity 1), so only one item per distinct set takes part in the join.
  const byKey = new Map<string, number[]>();
  toks.forEach((ts, i) => push(byKey, ts.join(" "), i));
  const uniq = [...byKey.values()].map((same) => {
    same.forEach((i) => (parent[find(i)] = find(same[0])));
    return same[0];
  });

  // Exact prefix filtering. With tokens in a global order (rarest first), any pair with weighted Jaccard ≥ t shares a
  // token within each one's prefix: the leading tokens while the remaining weight could still hold t × its total
  // weight. Common tokens end up in suffixes, so they no longer make every pair a candidate.
  const order = (a: string, b: string) => w.get(b)! - w.get(a)! || (a < b ? -1 : a > b ? 1 : 0);
  const index = new Map<string, number[]>();
  const prefixes = uniq.map((i) => {
    const total = toks[i].reduce((s, t) => s + w.get(t)!, 0);
    let rest = total;
    const prefix: string[] = [];
    for (const t of [...toks[i]].sort(order)) {
      if (rest < threshold * total - 1e-9) break;
      prefix.push(t);
      rest -= w.get(t)!;
    }
    return prefix;
  });
  prefixes.forEach((p, u) => p.forEach((t) => push(index, t, u)));
  prefixes.forEach((p, u) => {
    const cands = new Set<number>();
    for (const t of p) for (const v of index.get(t)!) if (v > u) cands.add(v);
    for (const v of cands) {
      const [i, j] = [uniq[u], uniq[v]];
      if (find(i) !== find(j) && simSorted(toks[i], toks[j], w) >= threshold) parent[find(i)] = find(j);
    }
  });

  const comps = new Map<number, number[]>();
  xs.forEach((_, i) => push(comps, find(i), i));

  return [...comps.values()]
    .map((idx) => {
      // Score = summed similarity to the other members (pairs without a shared token score 0). Members with the same
      // token set share a score, so it is computed once per distinct set: (copies − 1) × 1 + Σ copies × similarity.
      // Rounded so float noise in the sums can't beat the ts tie-break.
      const keys = new Map<string, number[]>();
      idx.forEach((i) => push(keys, toks[i].join(" "), i));
      const reps = [...keys.values()];
      const local = new Map<string, number[]>();
      reps.forEach((r, k) => toks[r[0]].forEach((t) => push(local, t, k)));
      const keyScore = reps.map((r, k) => {
        const others = new Set(toks[r[0]].flatMap((t) => local.get(t)!).filter((m) => m !== k));
        return Math.round(([...others].reduce((s, m) => s + reps[m].length * simSorted(toks[r[0]], toks[reps[m][0]], w), 0) + r.length - 1) * 1e9);
      });
      const scoreOf = new Map(reps.flatMap((r, k) => r.map((i) => [i, keyScore[k]] as const)));
      const score = (i: number) => scoreOf.get(i)!;
      const best = idx
        .map((i) => ({ i, s: score(i) }))
        .sort((a, b) => b.s - a.s || (xs[a.i].x.ts < xs[b.i].x.ts ? -1 : xs[a.i].x.ts > xs[b.i].x.ts ? 1 : a.i - b.i))[0].i;
      return {
        id: createHash("sha1").update(toks[best].join(" ")).digest("hex").slice(0, 8),
        members: idx.map((i) => xs[i].x),
        representative: xs[best].x,
      };
    })
    .sort((a, b) => byId(a.representative, b.representative));
}
