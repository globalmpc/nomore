import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Report } from "../src/types.js";

const run = (args: string[], configDir = "test/fixtures") =>
  spawnSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "src/cli.ts", ...args], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
  });

describe("cli", () => {
  it("reports repeated corrections", () => {
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Repeated instructions");
    expect(r.stdout).toMatch(/pnpm/i);
    expect(r.stdout).toContain("3 sessions");
    expect(r.stdout).toMatch(/commit yet/i);
  });

  it("--json is a valid Report", () => {
    const r = run(["--json"]);
    expect(Report.parse(JSON.parse(r.stdout)).scannedSessions).toBe(3);
  });

  it("--card has totals only: no paths, no quotes", () => {
    const r = run(["--card"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/[/"'“”`]/);
  });

  it("explains a missing config folder and exits 0", () => {
    const r = run([], "/nonexistent");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`No Claude Code sessions found in ${join("/nonexistent", "projects")}`);
  });

  it("rejects unknown flags", () => {
    expect(run(["--nope"]).status).not.toBe(0);
  });
});

describe("scripts/predict-corrections.ts", () => {
  it("labels every typed user message as correction or not", () => {
    const r = spawnSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "scripts/predict-corrections.ts"], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: "test/fixtures" },
    });
    const preds = Object.fromEntries(r.stdout.trim().split("\n").map((l) => JSON.parse(l)).map((p) => [p.id, p.label]));
    expect(preds["s1-u4"]).toBe("correction");
    expect(preds["s1-u1"]).toBe("not");
    expect(preds["s3-u3"]).toBe("correction");
    expect(Object.keys(preds)).toHaveLength(8);
  });
});

describe("scripts/label-groups.ts", () => {
  it("asks y/n per shown group, saves ids only and prints precision", async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    const out = join(dir, "labels.jsonl");
    const r = spawnSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "scripts/label-groups.ts", out], {
      encoding: "utf8",
      input: "y\nn\n",
      env: { ...process.env, CLAUDE_CONFIG_DIR: "test/fixtures" },
    });
    expect(r.status).toBe(0);
    const labels = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(labels.map((l) => l.label)).toEqual(["rule", "not"]);
    expect(labels.every((l) => Object.keys(l).join() === "id,label")).toBe(true);
    expect(r.stdout).toContain("precision 0.50 (1 of 2)");
    rmSync(dir, { recursive: true });
  });
});

describe("heavy-user sessions", () => {
  it("shows only the real preference, not script templates, pasted code or logs", async () => {
    const { runPipeline } = await import("../src/pipeline.js");
    const r = await runPipeline({ configDir: "test/fixtures/heavy", days: 30, nowMs: Date.now() });
    expect(r.suggestions.map((s) => s.text)).toEqual(["Never push without asking"]);
  });
});

describe("scripts/score-labels.ts", () => {
  it("scores saved labels against what the tool shows now, without printing any text", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const shown = JSON.parse(run(["--json"]).stdout).suggestions.map((s: { id: string }) => s.id);
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    const labels = join(dir, "labels.jsonl");
    writeFileSync(labels, [{ id: shown[0], label: "rule" }, { id: "gone1234", label: "not" }].map((l) => JSON.stringify(l)).join("\n") + "\n");
    const r = spawnSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "scripts/score-labels.ts", labels], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: "test/fixtures" },
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`precision 1.00 (1 of 1 labelled shown), unlabelled shown ${shown.length - 1}`);
    rmSync(dir, { recursive: true });
  });
});

describe("projects, days and score in --json", () => {
  it("reports how widely each group is spread", () => {
    const pnpm = JSON.parse(run(["--json"]).stdout).suggestions.find((s: { text: string }) => /pnpm/i.test(s.text));
    expect(pnpm).toMatchObject({ projects: 1, days: 3 });
    expect(pnpm.score).toBeGreaterThan(0);
  });
});

describe("scripts/score-labels.ts --variants", () => {
  it("prints one numbers-only line per variant", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const shown: { id: string; text: string }[] = JSON.parse(run(["--json"]).stdout).suggestions;
    const id = (re: RegExp) => shown.find((s) => re.test(s.text))!.id;
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    const labels = join(dir, "labels.jsonl");
    writeFileSync(labels, [{ id: id(/pnpm/i), label: "rule" }, { id: id(/commit/i), label: "not" }].map((l) => JSON.stringify(l)).join("\n") + "\n");
    const r = spawnSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "scripts/score-labels.ts", labels, "--variants"], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: "test/fixtures" },
    });
    expect(r.stdout.trim().split("\n")).toEqual([
      "baseline       precision 0.50 (1 of 2 labelled shown), rules kept 1 of 1, unlabelled 0",
      "2+ projects    precision 0.00 (0 of 0 labelled shown), rules kept 0 of 1, unlabelled 0",
      "2+ days        precision 0.50 (1 of 2 labelled shown), rules kept 1 of 1, unlabelled 0",
      "signals boost  precision 0.50 (1 of 2 labelled shown), rules kept 1 of 1, unlabelled 0",
      "top 5          precision 0.50 (1 of 2 labelled shown), rules kept 1 of 1, unlabelled 0",
    ]);
    rmSync(dir, { recursive: true });
  });
});

describe("labelling scripts reject bad arguments and never wipe labels", () => {
  const tsx = join(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  const setup = async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    const labels = join(dir, "labels.jsonl");
    writeFileSync(labels, '{"id":"abc12345","label":"rule"}\n');
    return { dir, labels };
  };

  it("label-groups: an unknown flag is an error and the labels file is untouched", async () => {
    const { readFileSync, rmSync } = await import("node:fs");
    const { dir, labels } = await setup();
    const r = spawnSync(process.execPath, [tsx, "scripts/label-groups.ts", labels, "--variants"], { encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: "test/fixtures" } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("usage");
    expect(readFileSync(labels, "utf8")).toBe('{"id":"abc12345","label":"rule"}\n');
    rmSync(dir, { recursive: true });
  });

  it("label-groups: nothing shown leaves an existing labels file alone", async () => {
    const { readFileSync, rmSync } = await import("node:fs");
    const { dir, labels } = await setup();
    const r = spawnSync(process.execPath, [tsx, "scripts/label-groups.ts", labels], { encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: "/nonexistent" } });
    expect(r.status).toBe(0);
    expect(readFileSync(labels, "utf8")).toBe('{"id":"abc12345","label":"rule"}\n');
    rmSync(dir, { recursive: true });
  });

  it("score-labels: bad days or an unknown flag is an error", async () => {
    const { rmSync } = await import("node:fs");
    const { dir, labels } = await setup();
    for (const args of [[labels, "abc"], [labels, "--nope"]]) {
      const r = spawnSync(process.execPath, [tsx, "scripts/score-labels.ts", ...args], { encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: "test/fixtures" } });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("usage");
    }
    rmSync(dir, { recursive: true });
  });
});

describe("empty result", () => {
  it("points to the rule pack when nothing repeats", async () => {
    const { mkdtempSync, mkdirSync, copyFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const config = mkdtempSync(join(tmpdir(), "nomore-"));
    mkdirSync(join(config, "projects", "-tmp-demo"), { recursive: true });
    copyFileSync("test/fixtures/projects/-tmp-demo/s1.jsonl", join(config, "projects", "-tmp-demo", "s1.jsonl"));
    for (const args of [[], ["--apply"]]) {
      const r = run(args, config);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("No instructions repeated across sessions yet.");
      expect(r.stdout).toMatch(/Meanwhile, start with the 20-rule pack: https:\/\/github\.com\/\S+\/blob\/master\/rules\/CLAUDE\.md/);
    }
    rmSync(config, { recursive: true });
  });
});

describe("review fixes", () => {
  const session = (cwd: string, sid: string, text: string) =>
    [
      { type: "assistant", uuid: `${sid}-a`, sessionId: sid, cwd, timestamp: "2026-10-23T09:00:00Z", entrypoint: "cli", message: { content: [{ type: "text", text: "Done." }] } },
      { type: "user", uuid: `${sid}-u`, sessionId: sid, cwd, timestamp: "2026-10-23T09:00:05Z", entrypoint: "cli", message: { content: text } },
    ].map((r) => JSON.stringify(r)).join("\n");
  const config = async (sessions: [string, string, string][]) => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    for (const [folder, sid, line] of sessions) {
      mkdirSync(join(dir, "projects", folder), { recursive: true });
      writeFileSync(join(dir, "projects", folder, `${sid}.jsonl`), line);
    }
    return dir;
  };

  it("--card shows totals only, never suggestion text", () => {
    const r = run(["--card"]);
    expect(r.stdout.trim()).toMatch(/^nomore: \d+ sessions, \d+ instructions, \d+ repeated\.$/);
  });

  it("never merges an instruction with its negation", async () => {
    const { runPipeline } = await import("../src/pipeline.js");
    const dir = await config([
      ["-p", "s1", session("/p", "s1", "use npm for installs")],
      ["-p", "s2", session("/p", "s2", "use npm for installs")],
      ["-p", "s3", session("/p", "s3", "do not use npm for installs")],
      ["-p", "s4", session("/p", "s4", "do not use npm for installs")],
    ]);
    const r = await runPipeline({ configDir: dir, days: 30, nowMs: Date.now() });
    expect(r.suggestions.map((s) => s.examples)).toEqual(expect.arrayContaining([["use npm for installs"], ["do not use npm for installs"]]));
    expect(new Set(r.suggestions.map((s) => s.id)).size).toBe(r.suggestions.length);
  });

  it("--project keeps only instructions from inside that project", async () => {
    const { runPipeline } = await import("../src/pipeline.js");
    const dir = await config([
      ["-tmp-a-b", "x1", session("/tmp/a-b", "x1", "never push without asking")],
      ["-tmp-a-b", "x2", session("/tmp/a-b/web", "x2", "never push without asking")],
      ["-tmp-a-b", "y1", session("/tmp/a_b", "y1", "keep answers short")],
      ["-tmp-a-b", "y2", session("/tmp/a_b", "y2", "keep answers short")],
    ]);
    const r = await runPipeline({ configDir: dir, days: 30, project: "/tmp/a-b", nowMs: Date.now() });
    expect(r.suggestions.map((s) => s.text)).toEqual(["Never push without asking"]);
  });
});

describe("review round 2", () => {
  const rec = (cwd: string, sid: string, text: string) =>
    [
      { type: "assistant", uuid: `${sid}-a`, sessionId: sid, cwd, timestamp: "2026-10-23T09:00:00Z", entrypoint: "cli", message: { content: [{ type: "text", text: "Done." }] } },
      { type: "user", uuid: `${sid}-u`, sessionId: sid, cwd, timestamp: "2026-10-23T09:00:05Z", entrypoint: "cli", message: { content: text } },
    ].map((r) => JSON.stringify(r)).join("\n");
  const config = async (sessions: [string, string, string][]) => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    for (const [folder, sid, line] of sessions) {
      mkdirSync(join(dir, "projects", folder), { recursive: true });
      writeFileSync(join(dir, "projects", folder, `${sid}.jsonl`), line);
    }
    return dir;
  };

  it("--project includes sessions started in a subfolder, but not lookalike folders", async () => {
    const { runPipeline } = await import("../src/pipeline.js");
    const dir = await config([
      ["-repo", "x1", rec("/repo", "x1", "never push without asking")],
      ["-repo-web", "x2", rec("/repo/web", "x2", "never push without asking")],
      ["-repo-other", "y1", rec("/repo-other", "y1", "keep answers short")],
      ["-repo-other", "y2", rec("/repo-other", "y2", "keep answers short")],
    ]);
    const r = await runPipeline({ configDir: dir, days: 30, project: "/repo", nowMs: Date.now() });
    expect(r.suggestions.map((s) => s.text)).toEqual(["Never push without asking"]);
  });

  it("a leading 'no,' doesn't make an instruction negative", async () => {
    const { runPipeline } = await import("../src/pipeline.js");
    const dir = await config([
      ["-p", "s1", rec("/p", "s1", "no, use pnpm for installs")],
      ["-p", "s2", rec("/p", "s2", "use pnpm for installs")],
    ]);
    const r = await runPipeline({ configDir: dir, days: 30, nowMs: Date.now() });
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].sessions).toBe(2);
  });

  it("--json prints a valid empty report when there are no sessions", () => {
    const r = run(["--json"], "/nonexistent");
    expect(r.status).toBe(0);
    expect(Report.parse(JSON.parse(r.stdout))).toMatchObject({ scannedSessions: 0, suggestions: [] });
  });
});
