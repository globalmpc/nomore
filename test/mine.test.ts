import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Issue } from "../src/issues.js";
import { loadIssues } from "../src/issues.js";
import { mineGroups, renderTopGroups } from "../src/mine.js";

const issue = (id: number, title: string, reactions = 0): Issue => ({
  id: String(id),
  title,
  url: `https://github.com/anthropics/claude-code/issues/${id}`,
  reactions,
  ts: `2026-09-${String((id % 28) + 1).padStart(2, "0")}T00:00:00Z`,
  labels: ["area:model"],
  state: "open",
});

describe("mineGroups", () => {
  it("groups the two 'ignores CLAUDE.md' issues and weighs them by 1 + reactions", () => {
    const g = mineGroups(loadIssues(["test/fixtures/issues.json"])).find((g) => g.top.some((t) => t.id === "101"))!;
    expect(g.top.map((t) => t.id).sort()).toEqual(["101", "102"]);
    expect(g.issues).toBe(2);
    expect(g.reactions).toBe(15);
    expect(g.weight).toBe(1 + 12 + 1 + 3);
  });

  it("ranks by weight: one issue with 100 reactions beats three with none", () => {
    const gs = mineGroups([
      issue(1, "Deletes untracked files without asking", 100),
      issue(2, "Says tests pass without running them"),
      issue(3, "Says tests pass without running them"),
      issue(4, "Says tests pass without running them"),
    ]);
    expect(gs.map((g) => [g.weight, g.issues])).toEqual([[101, 1], [3, 3]]);
    expect(gs[0].representative).toEqual({ id: "1", title: "Deletes untracked files without asking", url: "https://github.com/anthropics/claude-code/issues/1" });
  });

  it("keeps the 5 most-reacted issues, ties by issue number", () => {
    const [g] = mineGroups([3, 9, 0, 9, 1, 7, 2].map((r, i) => issue(i + 1, "[BUG] Ignores CLAUDE.md rules", r)));
    expect(g.top.map((t) => [t.id, t.reactions])).toEqual([["2", 9], ["4", 9], ["6", 7], ["1", 3], ["7", 2]]);
    expect(g.top[0].state).toBe("open");
    expect(g.representative.title).toBe("Ignores CLAUDE.md rules");
  });

  it("gives byte-identical output for shuffled input", () => {
    const xs = loadIssues(["test/fixtures/issues.json"]);
    expect(JSON.stringify(mineGroups([...xs].reverse()))).toBe(JSON.stringify(mineGroups(xs)));
  });
});

describe("renderTopGroups", () => {
  it("links the representative title and the top issues, escaping pipes", () => {
    const md = renderTopGroups(mineGroups([issue(7, "Edits a|b without asking", 4)]), 40);
    const url = "https://github.com/anthropics/claude-code/issues/7";
    expect(md).toContain(`| 1 | 5 | 1 | 4 | [Edits a\\|b without asking](${url}) | [#7](${url}) |`);
  });

  it("escapes markdown and HTML in titles", () => {
    const md = renderTopGroups(mineGroups([issue(8, "Fix [here](https://evil.example) <details> `x` *y*")]), 40);
    expect(md).toContain("[Fix \\[here\\]\\(https://evil.example\\) \\<details\\> \\`x\\` \\*y\\*](");
  });

  it("labels links with the issue number even when the URL has a trailing slash", () => {
    const md = renderTopGroups(mineGroups([{ ...issue(9, "Ignores rules"), url: "https://github.com/anthropics/claude-code/issues/9/" }]), 40);
    expect(md).toContain("[#9](");
  });
});

describe("scripts/mine-issues.ts", () => {
  it("rejects a threshold that isn't a number in (0, 1] before writing anything", () => {
    for (const bad of ["0,4", "0", "1.5", "abc"]) {
      const cwd = mkdtempSync(join(tmpdir(), "nomore-"));
      const res = spawnSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), join(process.cwd(), "scripts/mine-issues.ts"), bad], { cwd, encoding: "utf8" });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("threshold");
      expect(existsSync(join(cwd, "results"))).toBe(false);
      rmSync(cwd, { recursive: true });
    }
  });
});
