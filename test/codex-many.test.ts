import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runPipeline } from "../src/pipeline.js";

// The fixture is SYNTHETIC: 22 invented preferences repeated over 3 rollouts, so the labelling flow can be driven at
// its 20-group cap (the owner's real Codex history has only 7 groups). The y/n answers below are TEST DATA about the
// tool's mechanics (cap, file format, scoring), not a measured precision.
const FIXTURE = join(process.cwd(), "test/fixtures/codex-many");
const tsx = join(process.cwd(), "node_modules/tsx/dist/cli.mjs");
const env = { ...process.env, CODEX_HOME: FIXTURE, CLAUDE_CONFIG_DIR: "/nonexistent" };
const dir = mkdtempSync(join(tmpdir(), "nomore-many-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (script: string, args: string[], input?: string) =>
  spawnSync(process.execPath, [tsx, `scripts/${script}.ts`, ...args, "--agent", "codex"], { encoding: "utf8", input, env });
const answers = (y: number, n: number, extra = 3) => "y\n".repeat(y) + "n\n".repeat(n + extra);
const suggestions = async () => (await runPipeline({ agent: "codex", configDir: FIXTURE, days: 36500, nowMs: Date.now() })).suggestions;
const readLabels = (f: string) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, string>);

describe("codex-many fixture through the eval scripts", () => {
  it("yields 22+ distinct groups, each in 2+ sessions", async () => {
    const s = await suggestions();
    expect(s.length).toBeGreaterThanOrEqual(22);
    expect(s.every((x) => x.sessions >= 2)).toBe(true);
    expect(s.some((x) => x.text.startsWith("#") || x.text.startsWith("<"))).toBe(false);
    expect(new Set(s.map((x) => x.text)).size).toBe(s.length);
  });

  const out = join(dir, "labels.jsonl");
  it("label-groups caps at 20 and saves ids and labels only", () => {
    const r = run("label-groups", [out, "36500"], answers(15, 5));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("20 repeated groups");
    expect(r.stdout).toContain("precision 0.75 (15 of 20)");
    const labels = readLabels(out);
    expect(labels).toHaveLength(20);
    expect(labels.every((l) => Object.keys(l).join() === "id,label" && ["rule", "not"].includes(l.label))).toBe(true);
    expect(labels.filter((l) => l.label === "rule")).toHaveLength(15);
    expect(labels.filter((l) => l.label === "not")).toHaveLength(5);
    const file = readFileSync(out, "utf8").toLowerCase();
    for (const w of ["pnpm", "emoji", "lockfile", "indonesia", "semicolon", "docstring", "changelog", "utc"]) expect(file).not.toContain(w);
  });

  it("labels the first 20 suggestions in ranking order, the same on every run", async () => {
    const want = (await suggestions()).slice(0, 20).map((s) => s.id);
    expect(readLabels(out).map((l) => l.id)).toEqual(want);
    const again = join(dir, "again.jsonl");
    run("label-groups", [again, "36500"], answers(15, 5));
    expect(readLabels(again).map((l) => l.id)).toEqual(want);
  });

  it("score-labels reproduces the precision from the saved file", () => {
    const r = run("score-labels", [out, "36500"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/precision 0\.75 \(15 of 20 labelled shown\), unlabelled shown 0/);
  });

  it("label-groups with stdin ending early saves only the answered groups and says so", () => {
    const short = join(dir, "short.jsonl");
    const r = run("label-groups", [short, "36500"], "y\ny\nn\n");
    expect(r.status).toBe(0);
    const labels = readLabels(short);
    expect(labels).toHaveLength(3); // the 17 unanswered groups are not written as "not"
    expect(labels.map((l) => l.label)).toEqual(["rule", "rule", "not"]);
    expect(r.stdout).toContain("input ended after 3 of 20 groups; the rest are not labelled.");
    expect(r.stdout).toContain("precision 0.67 (2 of 3)");
  });

  it("label-groups with no answers at all exits 1 and writes nothing", () => {
    const none = join(dir, "none.jsonl");
    const r = run("label-groups", [none, "36500"], "");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no answers");
    expect(existsSync(none)).toBe(false);
  });
});
