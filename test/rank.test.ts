import { describe, expect, it } from "vitest";
import { rankGroups } from "../src/rank.js";

const DAY = 86_400_000;
const now = Date.parse("2026-10-22T00:00:00Z");
const g = (id: string, count: number, sessions: number, daysAgo = 0) => ({
  id, members: [], representative: { uuid: "u", sessionId: "s", cwd: "/c", ts: "t", text: "x", norm: "x", signals: [] as never[] },
  count, sessions, projects: 1, days: 1, lastSeen: new Date(now - daysAgo * DAY).toISOString(), signals: ["phrase" as const],
});

describe("rankGroups", () => {
  it("ranks by count × sessions with a 14-day half-life", () => {
    const [a, b] = rankGroups([g("two", 9, 2), g("many", 9, 9)], now);
    expect([a.id, b.id]).toEqual(["many", "two"]);
    const [today] = rankGroups([g("x", 4, 2)], now);
    const [old] = rankGroups([g("x", 4, 2, 14)], now);
    expect(old.score).toBeCloseTo(today.score / 2);
  });

  it("shows only groups from 2+ sessions, and marks 3+ sessions as repeated", () => {
    expect(rankGroups([g("a", 5, 1)], now)).toEqual([]);
    expect(rankGroups([g("b", 2, 2)], now)).toHaveLength(1);
    expect(rankGroups([g("c", 3, 3)], now)[0].signals).toContain("repeated");
  });
});

describe("rankGroups: preferences before tasks", () => {
  const withText = (id: string, count: number, sessions: number, ...texts: string[]) => ({
    ...g(id, count, sessions),
    members: texts.map((text, i) => ({ uuid: `${id}${i}`, sessionId: `s${i}`, cwd: "/c", ts: "t", text, norm: text, signals: [] as never[] })),
  });

  it("boosts groups that contain a preference word, in English or Korean", () => {
    const ranked = rankGroups(
      [
        withText("task", 5, 2, "run the build", "run the build again"),
        withText("pref", 2, 2, "never push without asking", "dont push"),
        withText("ko", 2, 2, "npm 말고 pnpm 써", "pnpm 써"),
      ],
      now,
    );
    expect(ranked.map((r) => r.id)).toEqual(["ko", "pref", "task"]);
    expect(ranked[1].score).toBeCloseTo(2 * 2 * 3);
  });

  it("lets a much more frequent task still outrank a preference", () => {
    const ranked = rankGroups([withText("task", 10, 2, "run the build"), withText("pref", 2, 2, "keep it short, too verbose")], now);
    expect(ranked.map((r) => r.id)).toEqual(["task", "pref"]);
  });
});

describe("rankGroups: Korean negation", () => {
  it("treats any '~지 마' (don't …) as a preference word", () => {
    const mk = (id: string, text: string) => ({ ...g(id, 2, 2), members: [{ uuid: id, sessionId: "s", cwd: "/c", ts: "t", text, norm: text, signals: [] as never[] }] });
    const [first] = rankGroups([mk("a", "결정 묻지 마"), mk("b", "보고서 정리")], now);
    expect(first.id).toBe("a");
    expect(first.score).toBeCloseTo(2 * 2 * 3);
  });
});

describe("rankGroups: Indonesian preference words", () => {
  it("boosts 'jangan' (don't)", () => {
    const mk = (id: string, count: number, text: string) => ({ ...g(id, count, 2), members: [{ uuid: id, sessionId: "s", cwd: "/c", ts: "t", text, norm: text, signals: [] as never[] }] });
    expect(rankGroups([mk("a", 4, "rapikan laporan"), mk("b", 2, "jangan push tanpa izin")], now)[0].id).toBe("b");
  });
});
