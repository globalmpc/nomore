// Plan Task 4 acceptance: every published rule's counts and links equal results/groups.json.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { IssueGroup } from "../src/mine.js";

const EVIDENCE = /^\s+(\d[\d,]*) issues? · (\d[\d,]*) reactions · ((?:\[#\d+\]\(\S+?\) ?)+)$/;
const num = (s: string) => Number(s.replace(/,/g, ""));

// Every indented line that starts with a number is an evidence line and must parse and match its group.
function evidence(text: string, groups: Pick<IssueGroup, "issues" | "reactions" | "top">[]) {
  const lines = text.split("\n");
  const rules: string[] = [];
  const errors: string[] = [];
  lines.forEach((line, i) => {
    if (!/^\s+\d/.test(line)) return;
    const m = line.match(EVIDENCE);
    if (!m) return errors.push(`malformed: ${line}`);
    const ids = [...m[3].matchAll(/\[#(\d+)\]\((\S+?)\)/g)].map(([, id, url]) => ({ id, url }));
    const g = groups.find((g) => g.top.some((t) => t.id === ids[0].id));
    if (!g) return errors.push(`no group: ${line}`);
    const want = { issues: g.issues, reactions: g.reactions, ids: g.top.slice(0, 3).map((t) => ({ id: t.id, url: t.url })) };
    if (JSON.stringify({ issues: num(m[1]), reactions: num(m[2]), ids }) !== JSON.stringify(want)) errors.push(`mismatch: ${line}`);
    rules.push(lines[i - 1]);
  });
  return { rules, errors };
}

describe("evidence checker (synthetic)", () => {
  const groups = [{ issues: 2, reactions: 5, top: [{ id: "1", title: "t", url: "u/1", reactions: 5, state: "open" }, { id: "2", title: "t", url: "u/2", reactions: 0, state: "open" }] }];
  it("accepts matching evidence", () => {
    expect(evidence("- Rule\n  2 issues · 5 reactions · [#1](u/1) [#2](u/2)\n", groups)).toEqual({ rules: ["- Rule"], errors: [] });
  });
  it("flags wrong counts, malformed lines and unknown issues", () => {
    const text = "- A\n  3 issues · 5 reactions · [#1](u/1) [#2](u/2)\n- B\n  2 issues - 5 reactions · [#1](u/1)\n- C\n  1 issue · 0 reactions · [#9](u/9)\n";
    expect(evidence(text, groups).errors.map((e) => e.split(":")[0])).toEqual(["mismatch", "malformed", "no group"]);
  });
});

describe("published rule pack", () => {
  const groups: IssueGroup[] = JSON.parse(readFileSync("results/groups.json", "utf8"));
  const pack = readFileSync("rules/CLAUDE.md", "utf8");
  const readme = readFileSync("README.md", "utf8");

  it("rules/CLAUDE.md is only a heading, 20 rules and their evidence (it gets imported into users' CLAUDE.md)", () => {
    const { rules, errors } = evidence(pack, groups);
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(20);
    expect(new Set(rules).size).toBe(20);
    const other = pack.split("\n").filter((l) => l !== "" && !l.startsWith("- ") && !EVIDENCE.test(l));
    expect(other).toEqual(["## nomore rules"]);
  });

  it("no rule links an issue that was closed as completed (it may already be fixed)", () => {
    const ids = [...pack.matchAll(/\[#(\d+)\]/g)].map((m) => m[1]);
    const closed = ids.filter((id) => groups.some((g) => g.top.some((t) => t.id === id && t.state === "completed")));
    expect(closed).toEqual([]);
  });

  it("README shows the pack's first 5 rules word for word, with matching evidence", () => {
    const { rules, errors } = evidence(readme, groups);
    expect(errors).toEqual([]);
    expect(rules).toEqual(evidence(pack, groups).rules.slice(0, 5));
  });

  it("README doesn't call single-issue rules 'most-reported'", () => {
    expect(readme).not.toMatch(/most-reported/i);
  });
});
