import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Report } from "../src/types.js";

const run = (args: string[], configDir = "test/fixtures", input?: string) =>
  spawnSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "src/cli.ts", ...args], {
    encoding: "utf8",
    input,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
  });

describe("cli: --project with no sessions (issue #20)", () => {
  it("names the project, and says when its folder doesn't exist", () => {
    const missing = resolve("/nope/does-not-exist");
    const r = run(["--days", "36500", "--project", "/nope/does-not-exist"]);
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n").slice(0, 2)).toEqual([`No Claude Code sessions for ${missing} in the last 36500 days.`, "That folder doesn't exist; check the path."]);
    expect(r.stdout).toContain("20-rule pack");
  });

  it("an existing folder without sessions gets the project line only", () => {
    const empty = mkdtempSync(join(tmpdir(), "nomore-"));
    const r = run(["--days", "36500", "--project", empty]);
    expect(r.stdout.split("\n")[0]).toBe(`No Claude Code sessions for ${resolve(empty)} in the last 36500 days.`);
    expect(r.stdout).not.toContain("doesn't exist");
    rmSync(empty, { recursive: true });
  });
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

  it("explains a missing config folder, points to the rule pack and exits 0 (issue #9)", () => {
    const r = run([], "/nonexistent");
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines[0]).toBe(`No Claude Code sessions found in ${join("/nonexistent", "projects")}`);
    expect(r.stdout).toContain("CLAUDE_CONFIG_DIR");
    expect(r.stdout).toMatch(/Meanwhile, start with the 20-rule pack: https:\/\/github\.com\/\S+\/blob\/main\/rules\/CLAUDE\.md/);
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
    expect(r.scannedSessions).toBe(6); // Claude counts every file, even those with no events
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
      expect(r.stdout).toMatch(/Meanwhile, start with the 20-rule pack: https:\/\/github\.com\/\S+\/blob\/main\/rules\/CLAUDE\.md/);
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

  it("'no, use pnpm not npm' joins 'use pnpm, not npm' (issue #10)", async () => {
    const { runPipeline } = await import("../src/pipeline.js");
    const dir = await config([
      ["-p", "s1", rec("/p", "s1", "use pnpm, not npm")],
      ["-p", "s2", rec("/p", "s2", "use pnpm, not npm")],
      ["-p", "s3", rec("/p", "s3", "use pnpm, not npm")],
      ["-p", "s4", rec("/p", "s4", "no, use pnpm not npm")],
    ]);
    const r = await runPipeline({ configDir: dir, days: 30, nowMs: Date.now() });
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ count: 4, sessions: 4 });
  });

  it("'force pushes not ok' doesn't join 'force pushes ok'", async () => {
    const { runPipeline } = await import("../src/pipeline.js");
    const dir = await config([
      ["-p", "s1", rec("/p", "s1", "force pushes ok")],
      ["-p", "s2", rec("/p", "s2", "force pushes ok")],
      ["-p", "s3", rec("/p", "s3", "force pushes not ok")],
      ["-p", "s4", rec("/p", "s4", "force pushes not ok")],
    ]);
    const r = await runPipeline({ configDir: dir, days: 30, nowMs: Date.now() });
    expect(r.suggestions.map((s) => s.count)).toEqual([2, 2]);
  });

  it("'use tabs for indents not ok' doesn't join 'use tabs for indents'", async () => {
    const { runPipeline } = await import("../src/pipeline.js");
    const dir = await config([
      ["-p", "s1", rec("/p", "s1", "use tabs for indents")],
      ["-p", "s2", rec("/p", "s2", "use tabs for indents")],
      ["-p", "s3", rec("/p", "s3", "use tabs for indents not ok")],
      ["-p", "s4", rec("/p", "s4", "use tabs for indents not ok")],
    ]);
    const r = await runPipeline({ configDir: dir, days: 30, nowMs: Date.now() });
    expect(r.suggestions.map((s) => s.count)).toEqual([2, 2]);
  });

  it("--json prints a valid empty report when there are no sessions", () => {
    const r = run(["--json"], "/nonexistent");
    expect(r.status).toBe(0);
    expect(Report.parse(JSON.parse(r.stdout))).toMatchObject({ scannedSessions: 0, suggestions: [] });
  });

  it("an empty projects folder still points to the rule pack (issue #9)", async () => {
    const dir = await config([]);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(dir, "projects"));
    const r = run([], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("No Claude Code sessions found in");
    expect(r.stdout).toMatch(/Meanwhile, start with the 20-rule pack: https:\/\/github\.com\/\S+\/blob\/main\/rules\/CLAUDE\.md/);
    expect(r.stdout).not.toContain("CLAUDE_CONFIG_DIR");
  });

  it("a record without a timestamp is skipped, not a crash (issue #15)", async () => {
    const noTs = (sid: string) => JSON.stringify({ type: "user", uuid: `${sid}-u`, sessionId: sid, cwd: "/p", entrypoint: "cli", message: { content: "never use semicolons in my code" } });
    const dir = await config([
      ["-p", "s1", rec("/p", "s1", "keep answers short")],
      ["-p", "s2", rec("/p", "s2", "keep answers short")],
      ["-p", "s3", noTs("s3")],
      ["-p", "s4", noTs("s4")],
    ]);
    const r = run(["--json"], dir);
    expect(r.status).toBe(0);
    expect(Report.parse(JSON.parse(r.stdout)).suggestions.map((s) => s.text)).toEqual(["Keep answers short"]);
  });

  it("--apply: end of input at the Rule: prompt adds nothing (issue #13)", async () => {
    const { cpSync, existsSync, mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    cpSync("test/fixtures/projects", join(dir, "projects"), { recursive: true });
    const r = run(["--days", "36500", "--apply"], dir, "e\n");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("No rules added.");
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
    rmSync(dir, { recursive: true });
  });

  // A folder named like a transcript or like CLAUDE.md can't be read on every OS and as root, unlike chmod.
  it("an unreadable transcript is skipped and counted, not a crash (issue #22)", async () => {
    const { mkdirSync, rmSync } = await import("node:fs");
    const dir = await config([
      ["-p", "s1", rec("/p", "s1", "keep answers short")],
      ["-p", "s2", rec("/p", "s2", "keep answers short")],
    ]);
    mkdirSync(join(dir, "projects", "-p", "bad.jsonl"));
    const json = run(["--json"], dir);
    expect(json.status).toBe(0);
    expect(Report.parse(JSON.parse(json.stdout))).toMatchObject({ scannedSessions: 3, skippedFiles: 1, suggestions: [{ text: "Keep answers short" }] });
    expect(run([], dir).stdout).toContain("1 unreadable file skipped");
    rmSync(dir, { recursive: true });
  });

  it("--apply says how many transcripts it couldn't read (PR #26 review)", async () => {
    const { mkdirSync, rmSync } = await import("node:fs");
    const dir = await config([["-p", "s1", rec("/p", "s1", "keep answers short")]]);
    mkdirSync(join(dir, "projects", "-p", "bad.jsonl"));
    const r = run(["--apply"], dir, "");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 unreadable file skipped");
    expect(r.stdout).toContain("No instructions repeated across sessions yet.");
    rmSync(dir, { recursive: true });
  });

  // chmod has no effect on Windows or as root.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a transcript whose details can't be read is counted, not dropped (PR #26 review)", async () => {
    const { chmodSync, rmSync } = await import("node:fs");
    const dir = await config([
      ["-p", "s1", rec("/p", "s1", "keep answers short")],
      ["-p", "s2", rec("/p", "s2", "keep answers short")],
    ]);
    chmodSync(join(dir, "projects", "-p"), 0o444); // names can be listed, files can't be opened or stat'ed
    const r = run(["--json"], dir);
    chmodSync(join(dir, "projects", "-p"), 0o755);
    expect(r.status).toBe(0);
    expect(Report.parse(JSON.parse(r.stdout))).toMatchObject({ scannedSessions: 2, skippedFiles: 2 });
    rmSync(dir, { recursive: true });
  });

  it("--apply: a CLAUDE.md that can't be written gives one line and exit 1, no stack trace (issue #22)", async () => {
    const { mkdirSync, rmSync } = await import("node:fs");
    const dir = await config([
      ["-p", "s1", rec("/p", "s1", "keep answers short")],
      ["-p", "s2", rec("/p", "s2", "keep answers short")],
    ]);
    mkdirSync(join(dir, "CLAUDE.md"));
    const r = run(["--apply"], dir, "y\n");
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toMatch(/^Couldn't write \S*CLAUDE\.md: .+\. No rules were added\.$/);
    expect(r.stderr).not.toMatch(/\n\s+at /);
    rmSync(dir, { recursive: true });
  });
});

describe("--agent codex", () => {
  const runCodex = (args: string[], codexHome: string, env: Record<string, string> = {}, input?: string) =>
    spawnSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "src/cli.ts", ...args], {
      encoding: "utf8",
      input,
      env: { ...process.env, CLAUDE_CONFIG_DIR: "/nonexistent", CODEX_HOME: codexHome, ...env },
    });
  const rollouts = async () => {
    const { readdirSync } = await import("node:fs");
    return readdirSync("test/fixtures/codex/sessions", { recursive: true, encoding: "utf8" }).filter((f) => /(^|\/)rollout-.*\.jsonl$/.test(f)).length;
  };

  it("reports repeated instructions from Codex rollouts", () => {
    const r = runCodex(["--agent", "codex", "--days", "36500"], "test/fixtures/codex");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Repeated instructions");
    expect(r.stdout).toMatch(/keep answers short/i);
  });

  it("--json counts the rollouts that yield events; --project leaves the other project out", async () => {
    const all = Report.parse(JSON.parse(runCodex(["--agent", "codex", "--days", "36500", "--json"], "test/fixtures/codex").stdout));
    // Subagent, exec and unreadable rollouts parse to no events and are not sessions.
    const { listRollouts, parseRollout } = await import("../src/codex.js");
    const withEvents = (await Promise.all((await listRollouts("test/fixtures/codex", { sinceMs: 0 })).map(parseRollout))).filter((r) => r.events.length > 0).length;
    expect(withEvents).toBeLessThan(await rollouts());
    expect(all.scannedSessions).toBe(withEvents);
    const demo = Report.parse(JSON.parse(runCodex(["--agent", "codex", "--days", "36500", "--project", "/tmp/demo", "--json"], "test/fixtures/codex").stdout));
    const inDemo = (await Promise.all((await listRollouts("test/fixtures/codex", { sinceMs: 0, project: "/tmp/demo" })).map(parseRollout))).filter((r) => r.events.length > 0).length;
    expect(demo.scannedSessions).toBe(inDemo);
    expect(inDemo).toBeLessThan(withEvents); // /tmp/other and the /tmp/demo-x lookalike are left out
  });

  it("explains a missing CODEX_HOME and prints an empty report with --json", () => {
    const r = runCodex(["--agent", "codex"], "/nonexistent");
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")[0]).toBe(`No Codex sessions found in ${join("/nonexistent", "sessions")}`);
    expect(r.stdout).toContain("CODEX_HOME");
    expect(r.stdout).toMatch(/Meanwhile, start with the 20-rule pack/);
    expect(Report.parse(JSON.parse(runCodex(["--agent", "codex", "--json"], "/nonexistent").stdout)).suggestions).toEqual([]);
  });

  it("rejects an unknown agent and lists --agent in --help", () => {
    const bad = runCodex(["--agent", "foo"], "test/fixtures/codex");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("--agent");
    expect(bad.stderr).toContain("Usage:");
    expect(runCodex(["--help"], "test/fixtures/codex").stdout).toContain("--agent");
  });

  it("--project with no Codex sessions names Codex and the project, and a missing folder (issue #20)", () => {
    const nothing = runCodex(["--agent", "codex", "--days", "36500", "--project", "/tmp/nm-no-such-project"], "test/fixtures/codex");
    expect(nothing.status).toBe(0);
    expect(nothing.stdout).toContain("No Codex sessions for /tmp/nm-no-such-project in the last 36500 days.");
    expect(nothing.stdout).toContain("That folder doesn't exist; check the path.");
    expect(nothing.stdout).not.toContain("Claude Code");
    const some = runCodex(["--agent", "codex", "--days", "0.0001"], "test/fixtures/codex");
    expect(some.stdout).toContain(`No Codex sessions found in ${join("test/fixtures/codex", "sessions")} in the last 0.0001 days`);
  });

  it("when every rollout is unreadable, Codex says so instead of 'no sessions', like Claude", async () => {
    const { mkdirSync, mkdtempSync, rmSync, symlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const home = mkdtempSync(join(tmpdir(), "nomore-"));
    const day = join(home, "sessions", "2026", "10", "01");
    mkdirSync(day, { recursive: true });
    for (const n of ["a", "b"]) symlinkSync(home, join(day, `rollout-${n}.jsonl`)); // listed like files, unreadable even as root
    const json = runCodex(["--agent", "codex", "--days", "36500", "--json"], home);
    expect(json.status).toBe(0);
    expect(Report.parse(JSON.parse(json.stdout))).toMatchObject({ scannedSessions: 2, skippedFiles: 2 }); // the same as Claude's #26 count
    const text = runCodex(["--agent", "codex", "--days", "36500"], home);
    expect(text.stdout).toContain("2 unreadable files skipped");
    expect(text.stdout).not.toContain("No Codex sessions");
    rmSync(home, { recursive: true });
  });

  it("--apply prints the unreadable-file note before the prompts", async () => {
    const { cpSync, mkdtempSync, rmSync, symlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const home = join(mkdtempSync(join(tmpdir(), "nomore-")), "c");
    cpSync("test/fixtures/codex", home, { recursive: true });
    symlinkSync(home, join(home, "sessions", "2026", "10", "01", "rollout-bad.jsonl"));
    const r = runCodex(["--agent", "codex", "--days", "36500", "--apply"], home, {}, "q\n");
    expect(r.status).toBe(0);
    expect(r.stdout.indexOf("1 unreadable file skipped")).toBeGreaterThanOrEqual(0);
    expect(r.stdout.indexOf("1 unreadable file skipped")).toBeLessThan(r.stdout.indexOf("Rules will be added"));
    rmSync(join(home, ".."), { recursive: true });
  });

  it("an unreadable rollout is skipped and counted, with and without --project (issue #22)", async () => {
    const { cpSync, mkdtempSync, rmSync, symlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const home = join(mkdtempSync(join(tmpdir(), "nomore-")), "c");
    cpSync("test/fixtures/codex", home, { recursive: true });
    symlinkSync(home, join(home, "sessions", "2026", "10", "01", "rollout-bad.jsonl")); // listed like a file, unreadable even as root
    for (const extra of [[], ["--project", "/tmp/demo"]]) {
      const r = runCodex(["--agent", "codex", "--days", "36500", "--json", ...extra], home);
      expect(r.status).toBe(0);
      expect(Report.parse(JSON.parse(r.stdout))).toMatchObject({ skippedFiles: 1 });
    }
    expect(runCodex(["--agent", "codex", "--days", "36500"], home).stdout).toContain("1 unreadable file skipped");
    rmSync(join(home, ".."), { recursive: true });
  });

  it("hints at --agent codex when only Codex sessions exist, never with --json", () => {
    const r = runCodex([], "test/fixtures/codex");
    const lines = r.stdout.trim().split("\n");
    expect(r.status).toBe(0);
    expect(lines[0]).toBe(`No Claude Code sessions found in ${join("/nonexistent", "projects")}`);
    expect(lines.filter((l) => l.includes("--agent codex"))).toHaveLength(1);
    expect(r.stdout).not.toMatch(/CLAUDE_CONFIG_DIR.*--agent codex|--agent codex.*CLAUDE_CONFIG_DIR/);
    expect(runCodex([], "/nonexistent").stdout).not.toContain("--agent codex");
    expect(runCodex(["--json"], "test/fixtures/codex").stdout).not.toContain("--agent codex");
  });

  it("codex rule check reads AGENTS.md only, no imports", async () => {
    const { cpSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { runPipeline } = await import("../src/pipeline.js");
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    const keep = (r: Report) => r.suggestions.find((s) => /keep answers short/i.test(s.text))!;
    // Rule only in CLAUDE.md, or only behind an @import: not used.
    writeFileSync(join(dir, "CLAUDE.md"), "- Keep answers short\n");
    writeFileSync(join(dir, "imported.md"), "- Keep answers short\n");
    writeFileSync(join(dir, "AGENTS.md"), "@imported.md\n");
    cpSync("test/fixtures/codex/sessions", join(dir, "sessions"), { recursive: true });
    expect(keep(await runPipeline({ configDir: dir, days: 36500, nowMs: Date.now(), agent: "codex" })).status).toBe("new");
    writeFileSync(join(dir, "AGENTS.md"), "- Keep answers short\n");
    expect(keep(await runPipeline({ configDir: dir, days: 36500, nowMs: Date.now(), agent: "codex" }))).toMatchObject({ status: "ignored", matchedRule: "Keep answers short" });
    rmSync(dir, { recursive: true });
  });
});

describe("--agent codex --apply", () => {
  const fs = () => import("node:fs");
  // Temp copy of the codex fixtures; never the repo tree or the real ~/.codex.
  const setup = async () => {
    const { cpSync, mkdtempSync } = await fs();
    const { tmpdir } = await import("node:os");
    const root = mkdtempSync(join(tmpdir(), "nomore-"));
    const home = join(root, "c");
    cpSync("test/fixtures/codex", home, { recursive: true });
    return { root, home };
  };
  const apply = (home: string, extra: string[] = [], input = "y\nq\n") =>
    spawnSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "src/cli.ts", "--agent", "codex", "--days", "36500", "--apply", ...extra], {
      encoding: "utf8",
      input,
      env: { ...process.env, CLAUDE_CONFIG_DIR: "/nonexistent", CODEX_HOME: home },
    });
  const bullets = (text: string) => text.split("\n").filter((l) => l.startsWith("- "));

  it("adds a rule to $CODEX_HOME/AGENTS.md and logs the adoption there", async () => {
    const { existsSync, readFileSync, readdirSync, statSync } = await fs();
    const { root, home } = await setup();
    const r = apply(home);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`Rules will be added to ${join(home, "AGENTS.md")}`);
    const md = readFileSync(join(home, "AGENTS.md"), "utf8");
    expect(md).toContain("## nomore rules");
    expect(bullets(md)).toHaveLength(1);
    const log = join(home, "nomore", "adopted.json");
    expect(statSync(log).mode & 0o777).toBe(0o600);
    expect(Object.values(JSON.parse(readFileSync(log, "utf8"))).flat()).toHaveLength(1);
    expect(readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith("CLAUDE.md"))).toEqual([]);
    expect(existsSync(join(home, "CLAUDE.md"))).toBe(false);
  });

  it("--project writes <project>/AGENTS.md and leaves $CODEX_HOME alone", async () => {
    const { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = await fs();
    const { home, root } = await setup();
    const proj = join(root, "proj");
    mkdirSync(proj);
    // Point the temp rollouts at the temp project, so nothing outside the temp tree is touched.
    for (const f of readdirSync(join(home, "sessions"), { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".jsonl"))) {
      const p = join(home, "sessions", f);
      writeFileSync(p, readFileSync(p, "utf8").replaceAll("/tmp/demo", proj));
    }
    const r = apply(home, ["--project", proj]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`Rules will be added to ${join(proj, "AGENTS.md")}`);
    expect(readFileSync(join(proj, "AGENTS.md"), "utf8")).toContain("## nomore rules");
    expect(existsSync(join(home, "AGENTS.md"))).toBe(false);
  });

  it("writes where Codex reads: override first", async () => {
    const { readFileSync, writeFileSync } = await fs();
    const { home } = await setup();
    writeFileSync(join(home, "AGENTS.override.md"), "# Override\n- Be brief\n");
    writeFileSync(join(home, "AGENTS.md"), "# Base\n");
    const r = apply(home);
    expect(r.stdout).toContain(`Rules will be added to ${join(home, "AGENTS.override.md")}`);
    const o = readFileSync(join(home, "AGENTS.override.md"), "utf8");
    expect(o.startsWith("# Override\n- Be brief\n")).toBe(true);
    expect(o).toContain("## nomore rules");
    expect(readFileSync(join(home, "AGENTS.md"), "utf8")).toBe("# Base\n");
  });

  it("an empty override is skipped", async () => {
    const { readFileSync, writeFileSync } = await fs();
    const { home } = await setup();
    writeFileSync(join(home, "AGENTS.override.md"), " \n\n");
    const r = apply(home);
    expect(r.stdout).toContain(`Rules will be added to ${join(home, "AGENTS.md")}`);
    expect(readFileSync(join(home, "AGENTS.override.md"), "utf8")).toBe(" \n\n");
    expect(readFileSync(join(home, "AGENTS.md"), "utf8")).toContain("## nomore rules");
  });

  it("appends to an existing AGENTS.md and a second run does not repeat the rule", async () => {
    const { readFileSync, writeFileSync } = await fs();
    const { home } = await setup();
    writeFileSync(join(home, "AGENTS.md"), "# Mine\n- Existing rule\n");
    expect(apply(home).status).toBe(0);
    const once = readFileSync(join(home, "AGENTS.md"), "utf8");
    expect(once.startsWith("# Mine\n- Existing rule\n")).toBe(true);
    expect(once.trimEnd().split("\n").at(-1)).toMatch(/^- /);
    expect(once.indexOf("## nomore rules")).toBeGreaterThan(once.indexOf("Existing rule"));
    apply(home);
    expect(bullets(readFileSync(join(home, "AGENTS.md"), "utf8"))).toEqual(bullets(once));
  });

  // A folder named like AGENTS.md can't be written on any OS and as root, unlike chmod (same idiom as the Claude test, issue #22).
  it("an AGENTS.md that can't be written gives one line and exit 1, no stack trace, nothing left behind (gate 4.3)", async () => {
    const { existsSync, mkdirSync, readdirSync, rmSync } = await fs();
    const { home, root } = await setup();
    mkdirSync(join(home, "AGENTS.md"));
    const r = apply(home);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toMatch(/^Couldn't write \S*AGENTS\.md: .+\. No rules were added\.$/);
    expect(r.stderr).not.toMatch(/\n\s+at /);
    expect(readdirSync(home).filter((f) => f.includes(".nomore-"))).toEqual([]); // no temp file
    expect(existsSync(join(home, "nomore", "adopted.json"))).toBe(false); // nothing adopted
    rmSync(root, { recursive: true });
  });

  it("--json works with stdin ignored and writes nothing (gate 4.2)", async () => {
    const { readdirSync, rmSync } = await fs();
    const { home, root } = await setup();
    const before = readdirSync(home, { recursive: true });
    const r = spawnSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "src/cli.ts", "--agent", "codex", "--days", "36500", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CONFIG_DIR: "/nonexistent", CODEX_HOME: home },
    });
    expect(r.status).toBe(0);
    expect(Report.parse(JSON.parse(r.stdout)).scannedSessions).toBeGreaterThan(0);
    expect(r.stderr).toBe("");
    expect(readdirSync(home, { recursive: true })).toEqual(before);
    rmSync(root, { recursive: true });
  });

  it("rule check: a rule in the override is ignored, one only in the shadowed AGENTS.md is new", async () => {
    const { writeFileSync } = await fs();
    const { runPipeline } = await import("../src/pipeline.js");
    const { home } = await setup();
    const keep = (r: Report) => r.suggestions.find((s) => /keep answers short/i.test(s.text))!;
    const go = async () => keep(await runPipeline({ configDir: home, days: 36500, nowMs: Date.now(), agent: "codex" }));
    writeFileSync(join(home, "AGENTS.override.md"), "- Keep answers short\n");
    expect(await go()).toMatchObject({ status: "ignored", matchedRule: "Keep answers short" });
    writeFileSync(join(home, "AGENTS.override.md"), "- Something else entirely\n");
    writeFileSync(join(home, "AGENTS.md"), "- Keep answers short\n");
    expect((await go()).status).toBe("new");
  });

  it("--apply after appending the pack adds to the same ## nomore rules section (no second heading)", async () => {
    const { readFileSync, writeFileSync } = await fs();
    const { home } = await setup();
    writeFileSync(join(home, "AGENTS.md"), "# Mine\n" + readFileSync("rules/AGENTS.md", "utf8"));
    expect(apply(home).status).toBe(0);
    const md = readFileSync(join(home, "AGENTS.md"), "utf8");
    expect(md.match(/^## nomore rules$/gm)).toHaveLength(1);
    expect(bullets(md)).toHaveLength(21);
    expect(bullets(md).at(-1)).toMatch(/keep answers short/i);
    expect(md.indexOf("keep answers short")).toBeGreaterThan(md.indexOf("## nomore rules"));
  });

  it("a repeated instruction that the appended pack already covers is reported as ignored", async () => {
    const { readFileSync, readdirSync, writeFileSync } = await fs();
    const { runPipeline } = await import("../src/pipeline.js");
    const { home } = await setup();
    for (const f of readdirSync(join(home, "sessions"), { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".jsonl"))) {
      const p = join(home, "sessions", f);
      writeFileSync(p, readFileSync(p, "utf8").replace(/keep answers short/g, "never run sudo or commands that wait for a password"));
    }
    const find = async () => (await runPipeline({ configDir: home, days: 36500, nowMs: Date.now(), agent: "codex" })).suggestions.find((s) => /sudo/i.test(s.text))!;
    expect((await find()).status).toBe("new");
    writeFileSync(join(home, "AGENTS.md"), readFileSync("rules/AGENTS.md", "utf8"));
    expect(await find()).toMatchObject({ status: "ignored", matchedRule: expect.stringMatching(/sudo/) });
  });

  it("appending the pack to a file that already has the section creates a second heading, and --apply writes into the first (documented)", async () => {
    const { readFileSync, writeFileSync } = await fs();
    const { home } = await setup();
    writeFileSync(join(home, "AGENTS.md"), "## nomore rules\n\n- Old rule\n" + "\n" + readFileSync("rules/AGENTS.md", "utf8"));
    expect(apply(home).status).toBe(0);
    const md = readFileSync(join(home, "AGENTS.md"), "utf8");
    expect(md.match(/^## nomore rules$/gm)).toHaveLength(2);
    const added = md.search(/^- Please keep answers short/m);
    expect(added).toBeGreaterThan(md.indexOf("- Old rule"));
    expect(added).toBeLessThan(md.lastIndexOf("## nomore rules"));
  });

  it("appending the pack twice duplicates its bullets and makes two headings (documented)", async () => {
    const { readFileSync, writeFileSync } = await fs();
    const { home } = await setup();
    const pack = readFileSync("rules/AGENTS.md", "utf8");
    writeFileSync(join(home, "AGENTS.md"), pack + "\n" + pack);
    expect(apply(home).status).toBe(0);
    const md = readFileSync(join(home, "AGENTS.md"), "utf8");
    expect(md.match(/^## nomore rules$/gm)).toHaveLength(2);
    expect(bullets(md)).toHaveLength(41);
    expect(new Set(bullets(md)).size).toBe(21);
    expect(md.search(/^- Please keep answers short/m)).toBeLessThan(md.lastIndexOf("## nomore rules"));
  });

  it("with nothing repeated yet, --apply still points at rules/AGENTS.md, not CLAUDE.md", async () => {
    const { cpSync, mkdirSync, mkdtempSync, rmSync } = await fs();
    const { tmpdir } = await import("node:os");
    const home = mkdtempSync(join(tmpdir(), "nomore-"));
    mkdirSync(join(home, "sessions/2026/10"), { recursive: true });
    cpSync("test/fixtures/codex/sessions/2026/10/01", join(home, "sessions/2026/10/01"), { recursive: true });
    const r = apply(home, [], "");
    rmSync(home, { recursive: true });
    expect(r.stdout).toContain("Meanwhile, start with the 20-rule pack");
    expect(r.stdout).toMatch(/rules\/AGENTS\.md/);
    expect(r.stdout).not.toMatch(/CLAUDE\.md/);
  });

  it("rule check with --project also reads the project's rule file", async () => {
    const { mkdirSync, readFileSync, readdirSync, writeFileSync } = await fs();
    const { runPipeline } = await import("../src/pipeline.js");
    const { home, root } = await setup();
    const proj = join(root, "proj");
    mkdirSync(proj);
    for (const f of readdirSync(join(home, "sessions"), { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".jsonl"))) {
      const p = join(home, "sessions", f);
      writeFileSync(p, readFileSync(p, "utf8").replaceAll("/tmp/demo", proj));
    }
    const go = async () => (await runPipeline({ configDir: home, project: proj, days: 36500, nowMs: Date.now(), agent: "codex" })).suggestions.find((s) => /keep answers short/i.test(s.text))!;
    expect((await go()).status).toBe("new");
    writeFileSync(join(proj, "AGENTS.md"), "- Keep answers short\n"); // only the project file has it; $CODEX_HOME has none
    expect((await go()).status).toBe("ignored");
  });
});

describe("eval scripts --agent", () => {
  const tsx = join(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  it("label-groups --agent codex reads CODEX_HOME, asks about AGENTS.md and saves ids only", async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    const out = join(dir, "labels.jsonl");
    const r = spawnSync(process.execPath, [tsx, "scripts/label-groups.ts", out, "--agent", "codex"], {
      encoding: "utf8",
      input: "y\ny\ny\ny\ny\n",
      env: { ...process.env, CODEX_HOME: "test/fixtures/codex", CLAUDE_CONFIG_DIR: "/nonexistent" },
    });
    expect(r.status).toBe(0);
    const labels = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => Object.keys(l).join() === "id,label")).toBe(true);
    expect(r.stdout).toContain("AGENTS.md");
    expect(r.stdout).toContain("precision ");
    rmSync(dir, { recursive: true });
  });
  it("score-labels --agent codex scores labels made by label-groups --agent codex", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    const out = join(dir, "labels.jsonl");
    const env = { ...process.env, CODEX_HOME: "test/fixtures/codex", CLAUDE_CONFIG_DIR: "/nonexistent" };
    spawnSync(process.execPath, [tsx, "scripts/label-groups.ts", out, "--agent", "codex"], { encoding: "utf8", input: "y\ny\ny\n", env });
    const r = spawnSync(process.execPath, [tsx, "scripts/score-labels.ts", out, "--agent", "codex"], { encoding: "utf8", env });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 of 1 labelled shown");
    rmSync(dir, { recursive: true });
  });
  it("score-labels --agent nope exits 1 with usage", () => {
    const r = spawnSync(process.execPath, [tsx, "scripts/score-labels.ts", "x.jsonl", "--agent", "nope"], { encoding: "utf8", env: { ...process.env, CODEX_HOME: "/nonexistent" } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage");
  });
});

describe("--apply with piped or missing stdin (issue #23)", () => {
  const SENTENCE = "--apply asks you one rule at a time; run it in a terminal, or use --json to read the suggestions.";
  const tsx = join(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  // Temp copy of the fixtures; returns the run function for the agent plus the folder to check for written files.
  const setup = async (agent: "claude" | "codex") => {
    const { cpSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    if (agent === "claude") cpSync("test/fixtures/projects", join(dir, "projects"), { recursive: true });
    else cpSync("test/fixtures/codex", dir, { recursive: true });
    const env = agent === "claude" ? { CLAUDE_CONFIG_DIR: dir } : { CLAUDE_CONFIG_DIR: "/nonexistent", CODEX_HOME: dir };
    const go = (input?: string, stdio?: ["ignore", "pipe", "pipe"]) =>
      spawnSync(process.execPath, [tsx, "src/cli.ts", ...(agent === "codex" ? ["--agent", "codex"] : []), "--days", "36500", "--apply"], {
        encoding: "utf8",
        input,
        stdio,
        env: { ...process.env, ...env },
      });
    return { dir, go };
  };
  const files = async (dir: string) => {
    const { readdirSync } = await import("node:fs");
    return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => /(CLAUDE|AGENTS)\.md$/.test(f) && !f.includes("fixtures"));
  };

  for (const agent of ["claude", "codex"] as const) {
    const md = agent === "claude" ? "CLAUDE.md" : "AGENTS.md";
    const hasMd = async (dir: string) => (await files(dir)).some((f) => f.endsWith(md) && !f.includes("projects/"));

    it(`${agent}: each prompt ends on its own line when answers are piped`, async () => {
      const { dir, go } = await setup(agent);
      const r = go("n\nq\n");
      expect(r.status).toBe(0);
      const lines = r.stdout.split("\n");
      expect(lines.filter((l) => (l.match(/\[(y\/n\/e|e\/n)\/?q?\]/g) ?? []).length > 1)).toEqual([]);
      const i = lines.findIndex((l) => /\[y\/n\/e\/q\] n$/.test(l));
      expect(i).toBeGreaterThan(-1);
      expect(r.stdout).toMatch(/\] [nq]\nNo rules added\./);
      rmSync(dir, { recursive: true });
    });

    it(`${agent}: empty input explains why, exit 0, nothing written`, async () => {
      const { dir, go } = await setup(agent);
      const r = go("");
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`\n${SENTENCE}\n`);
      expect(r.stdout).toMatch(/\] \n/);
      expect(r.stdout).toContain("No rules added.");
      expect(await hasMd(dir)).toBe(false);
      rmSync(dir, { recursive: true });
    });

    it(`${agent}: stdin ignored behaves the same`, async () => {
      const { dir, go } = await setup(agent);
      const r = go(undefined, ["ignore", "pipe", "pipe"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(SENTENCE);
      expect(await hasMd(dir)).toBe(false);
      rmSync(dir, { recursive: true });
    });
  }

  // A real terminal must behave as before: the pty echoes the answer, so nomore adds nothing (no second echo, no sentence).
  // vitest can't fake a TTY, so run the CLI under util-linux `script` with the keys sent after the prompt appears.
  const hasScript = spawnSync("script", ["--version"]).status === 0;
  const inPty = (dir: string, keys: string[]) => {
    const cmd = `${process.execPath} ${tsx} src/cli.ts --days 36500 --apply`;
    const feed = `sleep 3; ${keys.map((k) => `printf '${k}'; sleep 1.5`).join("; ")}`;
    return spawnSync("sh", ["-c", `(${feed}) | script -qec '${cmd}' /dev/null`], { encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: dir, CODEX_HOME: "/nonexistent" } }).stdout;
  };
  it.skipIf(!hasScript)("in a terminal each answer appears once and Ctrl-D adds no sentence", async () => {
    const { cpSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    cpSync("test/fixtures/projects", join(dir, "projects"), { recursive: true });
    const answered = inPty(dir, ["n\\n", "n\\n"]);
    expect(answered).toMatch(/\[y\/n\/e\/q\] n\r\nAdd /); // echoed once by the pty; a second echo would read "n\r\nn"
    expect(answered).not.toMatch(/\[y\/n\/e\/q\] n\r\nn/);
    const eof = inPty(dir, ["\\004"]);
    expect(eof).not.toContain(SENTENCE);
    expect(eof).toMatch(/\[y\/n\/e\/q\] No rules added\./);
    rmSync(dir, { recursive: true });
  }, 20_000);

  it("end of input after an answered prompt does not print the sentence", async () => {
    const { dir, go } = await setup("claude");
    const r = go("n\n");
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain(SENTENCE);
    expect(r.stdout).toContain("No rules added.");
    rmSync(dir, { recursive: true });
  });
});

describe("rule pack message names the agent's file", () => {
  // One run per agent, in a temp home: [no sessions folder, no sessions in the window, --project without sessions, nothing repeated yet].
  const out = (agent: "claude" | "codex", args: string[], seed?: (home: string) => void) => {
    const home = mkdtempSync(join(tmpdir(), "nomore-"));
    seed?.(home);
    const env = agent === "codex" ? { CODEX_HOME: home, CLAUDE_CONFIG_DIR: "/nonexistent" } : { CLAUDE_CONFIG_DIR: home, CODEX_HOME: "/nonexistent" };
    const r = spawnSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "src/cli.ts", "--agent", agent, ...args], { encoding: "utf8", env: { ...process.env, ...env }, input: "" });
    rmSync(home, { recursive: true });
    return r.stdout;
  };
  const dir = (agent: string) => (home: string) => mkdirSync(join(home, agent === "codex" ? "sessions" : "projects"), { recursive: true });
  const one = (agent: string) => (home: string) =>
    agent === "codex"
      ? cpSync("test/fixtures/codex/sessions/2026/10/01", join(home, "sessions/2026/10/01"), { recursive: true })
      : (mkdirSync(join(home, "projects/-tmp-demo"), { recursive: true }), copyFileSync("test/fixtures/projects/-tmp-demo/s1.jsonl", join(home, "projects/-tmp-demo/s1.jsonl")));

  for (const [agent, want, not] of [["codex", /rules\/AGENTS\.md/, /rules\/CLAUDE\.md/], ["claude", /rules\/CLAUDE\.md/, /rules\/AGENTS\.md/]] as const) {
    it(`${agent}: every empty-result message links its own pack`, () => {
      const outs = [
        out(agent, [], undefined),
        out(agent, ["--days", "0.0001"], dir(agent)),
        out(agent, ["--project", "/tmp/nope"], dir(agent)),
        out(agent, ["--days", "36500"], one(agent)),
      ];
      for (const o of outs) {
        expect(o).toContain("Meanwhile, start with the 20-rule pack");
        expect(o).toMatch(want);
        expect(o).not.toMatch(not);
      }
    });
  }
});
