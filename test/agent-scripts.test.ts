import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { IssueGroup } from "../src/mine.js";

const root = process.cwd();
const tsx = join(root, "node_modules/tsx/dist/cli.mjs");
const dirs: string[] = [];
const temp = () => dirs[dirs.push(mkdtempSync(join(tmpdir(), "nomore-agent-"))) - 1];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const mine = (cwd: string, ...args: string[]) =>
  spawnSync(process.execPath, [tsx, join(root, "scripts/mine-issues.ts"), ...args], { cwd, encoding: "utf8" });
const raw = (number: number, title: string, reactions = 0) =>
  ({ number, title, html_url: `https://github.com/openai/codex/issues/${number}`, created_at: "2026-01-01T00:00:00Z", labels: [{ name: "model-behavior" }], state: "open", reactions: { total_count: reactions } });

describe("--agent", () => {
  it("mine-issues.ts rejects an unknown agent and writes nothing", () => {
    const cwd = temp();
    const r = mine(cwd, "--agent", "nope");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage: mine-issues.ts [--agent claude|codex]");
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("fetch-issues.sh rejects an unknown or missing agent and writes nothing", () => {
    const cwd = temp();
    for (const args of [["--agent", "nope"], ["--agent"]]) {
      const r = spawnSync("bash", [join(root, "scripts/fetch-issues.sh"), ...args], { cwd, encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("usage: fetch-issues.sh [--agent claude|codex]");
    }
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("mine-issues.ts --agent codex reads data/codex and writes results/codex-*", () => {
    const cwd = temp();
    mkdirSync(join(cwd, "data/codex"), { recursive: true });
    writeFileSync(join(cwd, "data/codex/issues-model-behavior.json"), JSON.stringify([
      raw(1, "Model ignores AGENTS.md instructions", 3), raw(2, "Model ignores AGENTS.md instructions", 1), raw(3, "Spinner flickers in terminal"),
    ]));
    writeFileSync(join(cwd, "data/codex/fetched-at.txt"), "2026-10-31\n");
    for (const args of [["--agent", "codex", "0.6"], ["0.6", "--agent", "codex"]]) {
      const r = mine(cwd, ...args);
      expect(r.status, r.stderr).toBe(0);
      const groups = IssueGroup.array().parse(JSON.parse(readFileSync(join(cwd, "results/codex-groups.json"), "utf8")));
      expect(groups[0].issues).toBe(2);
      const md = readFileSync(join(cwd, "results/codex-top-groups.md"), "utf8");
      expect(md).toContain("openai/codex");
      expect(md).toContain("model-behavior");
      expect(md).not.toContain("anthropics");
      expect(md).toContain("similarity ≥ 0.6");
    }
    expect(existsSync(join(cwd, "results/groups.json"))).toBe(false);
  });

  it("mine-issues.ts --agent codex reads every fetched label file and counts an issue in two of them once", () => {
    const cwd = temp();
    mkdirSync(join(cwd, "data/codex"), { recursive: true });
    const inLabel = (label: string, issues: ReturnType<typeof raw>[]) =>
      writeFileSync(join(cwd, `data/codex/issues-${label}.json`), JSON.stringify(issues.map((i) => ({ ...i, labels: [{ name: label }] }))));
    inLabel("model-behavior", [raw(1, "Model ignores AGENTS.md instructions", 3), raw(2, "Spinner flickers in terminal")]);
    inLabel("tool-calls", [raw(1, "Model ignores AGENTS.md instructions", 3), raw(3, "Model ignores AGENTS.md instructions", 1)]);
    writeFileSync(join(cwd, "data/codex/fetched-at.txt"), "2026-10-31\n");
    const r = mine(cwd, "--agent", "codex", "0.6");
    expect(r.status, r.stderr).toBe(0);
    const groups = IssueGroup.array().parse(JSON.parse(readFileSync(join(cwd, "results/codex-groups.json"), "utf8")));
    expect(groups[0]).toMatchObject({ issues: 2, reactions: 4 }); // #1 once (not twice), plus #3
    expect(groups.reduce((n, g) => n + g.issues, 0)).toBe(3);
    const md = readFileSync(join(cwd, "results/codex-top-groups.md"), "utf8");
    expect(md).toContain("`model-behavior`");
    expect(md).toContain("`tool-calls`");
  });

  it("mine-issues.ts --agent codex with nothing fetched says how to fetch and writes nothing", () => {
    const cwd = temp();
    mkdirSync(join(cwd, "data/codex"), { recursive: true });
    const r = mine(cwd, "--agent", "codex");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("bash scripts/fetch-issues.sh --agent codex");
    expect(existsSync(join(cwd, "results"))).toBe(false);
  });
});
