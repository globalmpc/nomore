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

describe("published Codex rule pack", () => {
  const groups: IssueGroup[] = JSON.parse(readFileSync("results/codex-groups.json", "utf8"));
  const pack = readFileSync("rules/AGENTS.md", "utf8");
  const sentences = pack.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));

  it("rules/AGENTS.md is only a heading, 20 rules and their evidence (it is appended to users' AGENTS.md)", () => {
    const { rules, errors } = evidence(pack, groups);
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(20);
    expect(new Set(rules).size).toBe(20);
    const other = pack.split("\n").filter((l) => l !== "" && !l.startsWith("- ") && !EVIDENCE.test(l));
    expect(other).toEqual(["## nomore rules"]);
    expect(pack.match(/^## nomore rules$/gm)).toHaveLength(1);
  });

  it("no rule links an issue closed as completed or duplicate", () => {
    const ids = [...pack.matchAll(/\[#(\d+)\]/g)].map((m) => m[1]);
    const closed = ids.filter((id) => groups.some((g) => g.top.some((t) => t.id === id && (t.state === "completed" || t.state === "duplicate"))));
    expect(closed).toEqual([]);
  });

  it("each rule is short, general (no model names, no Claude) and none is inferred", () => {
    expect(sentences).toHaveLength(20);
    for (const s of sentences) {
      expect(s.length).toBeLessThanOrEqual(200);
      expect(s).not.toMatch(/claude|gpt|codex-?\d|sol\b|luna/i);
    }
    expect(pack).not.toMatch(/inferred/i);
  });

  it("the 20 rules are in reactions-descending order", () => {
    const r = [...pack.matchAll(/ · ([\d,]+) reactions ·/g)].map((m) => num(m[1]));
    expect(r).toHaveLength(20);
    expect(r).toEqual([...r].sort((a, b) => b - a));
  });

  // ponytail: labels are a snapshot from 2026-10-31 hand-copied from data/codex/issues-*.json (data/ is gitignored) and can drift upstream; upgrade: have mine-issues emit labels into `top`.
  const LABELS: Record<string, string[]> = {
    "8922": ["bug", "tool-calls"],
    "8648": ["bug", "context", "agent"],
    "13733": ["bug", "rate-limits", "tool-calls", "session"],
    "32503": ["bug", "model-behavior", "rate-limits", "tool-calls", "app"],
    "4843": ["bug", "tool-calls"],
    "25048": ["bug", "tool-calls", "app"],
    "29235": ["bug", "model-behavior", "sandbox", "app"],
    "2441": ["bug", "tool-calls"],
    "5946": ["bug", "tool-calls"],
    "16996": ["bug", "subagent"],
    "30712": ["bug", "windows-os", "sandbox", "tool-calls", "app"],
    "13491": ["bug", "subagent"],
    "15723": ["bug", "subagent"],
    "43803": ["bug", "tool-calls", "app"],
    "5957": ["bug", "context"],
    "50771": ["bug", "model-behavior", "context", "app"],
    "43329": ["bug", "model-behavior"],
    "13386": ["bug", "agent"],
    "41445": ["bug", "CLI", "context", "skills"],
    "6108": ["bug", "tool-calls"],
  };
  const PINNED_GROUPS = ["c2d84a8c", "235e0bbd", "9ecfc3fa", "9a507912", "66e46a83", "e1cf01b5", "2ac8ec46", "e9d49cbf", "bb25dec2", "4330ae4a", "c4aa0a18", "5adaf085", "ec7caf5f", "f4051deb", "037a0084", "27741cb5", "2e58afbb", "a2c590f7", "02b7e96f", "b9699a0b"];
  const firstIds = [...pack.matchAll(/^ {2}.*?\[#(\d+)\]/gm)].map((m) => m[1]);

  it("the 20 rules come from exactly the pinned groups, in order (an accidental swap fails)", () => {
    expect(firstIds.map((id) => groups.find((g) => g.top[0].id === id)?.id)).toEqual(PINNED_GROUPS);
  });

  // A word from each rule's sentence, in PINNED_GROUPS order: swapping two sentences while leaving their evidence lines fails.
  const KEYWORDS = ["$PATH", "most recent message", "poll", "parallel", "direnv", "line endings", "approval", "runtime", "timeout", "conflict", "sandbox", "subagent", "background", "plain text", "compacted", "same turn", "done", "AGENTS.md", "re-read", "sudo"];

  it("each rule's sentence belongs to its evidence line (swapping two sentences fails)", () => {
    expect(KEYWORDS).toHaveLength(PINNED_GROUPS.length);
    expect(sentences).toHaveLength(KEYWORDS.length);
    sentences.forEach((t, i) => expect(t, `rule ${i + 1}`).toContain(KEYWORDS[i]));
  });

  it("the file ends with exactly one newline", () => {
    expect(pack.endsWith("\n") && !pack.endsWith("\n\n")).toBe(true);
  });

  it("every rule's top issue is labelled bug or model-behavior, never enhancement/documentation/question/feature request", () => {
    expect(Object.keys(LABELS).sort()).toEqual([...firstIds].sort());
    for (const id of firstIds) {
      const l = LABELS[id].map((x) => x.toLowerCase());
      expect(l.some((x) => x === "bug" || x === "model-behavior")).toBe(true);
      expect(l.filter((x) => ["enhancement", "documentation", "question", "feature request"].includes(x))).toEqual([]);
    }
  });
});
