import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractInstructions } from "../src/detect.js";
import { listRollouts, parseRollout, resolveCodexHome } from "../src/codex.js";

const dir = "test/fixtures/codex";
const f = (day: string, name: string) => `${dir}/sessions/2026/10/${day}/rollout-2026-10-${day}T10-00-00-${name}.jsonl`;
const typed = f("01", "aaaa0001");

describe("resolveCodexHome", () => {
  it("respects CODEX_HOME, else ~/.codex", () => {
    expect(resolveCodexHome({ CODEX_HOME: "/x" }, "/h")).toBe("/x");
    expect(resolveCodexHome({}, "/h")).toBe(join("/h", ".codex"));
  });
});

describe("parseRollout", () => {
  it("lists rollouts and filters by project", async () => {
    const all = await listRollouts(dir, { sinceMs: 0 });
    expect(all).toHaveLength(16); // 14 + the two wrapped-message rollouts in 15/
    expect(all.every((p) => /rollout-[^/]*\.jsonl$/.test(p))).toBe(true);
    expect(all.some((p) => p.endsWith("notes.jsonl"))).toBe(false);
    const demo = await listRollouts(dir, { sinceMs: 0, project: "/tmp/demo" });
    expect(demo).toHaveLength(13); // 11 + the two wrapped-message rollouts in 15/
    expect(demo).not.toContain(f("03", "bbbb0001"));
    expect(demo.some((p) => p.includes("lookalike"))).toBe(false); // /tmp/demo-x is not inside /tmp/demo
    expect(await listRollouts(dir, { sinceMs: Date.now() + 86_400_000 })).toHaveLength(0);
    expect(await listRollouts("/nonexistent", { sinceMs: 0 })).toEqual([]);
  });

  it("uuid is sessionId:line", async () => {
    const { events } = await parseRollout(typed);
    expect(events.find((e) => e.text === "No, keep answers short")).toMatchObject({ uuid: "aaaa0001:4", sessionId: "aaaa0001", kind: "user_text" });
    expect(events.find((e) => e.kind === "assistant_tool_use")).toMatchObject({ tool: "exec_command" });
    expect(events.find((e) => e.kind === "assistant_text")).toBeDefined();
  });

  it("skips subagent rollouts", async () => {
    expect((await parseRollout(f("04", "cccc0001"))).events).toEqual([]);
  });

  it("decides on the first session_meta", async () => {
    expect((await parseRollout(f("05", "dddd0001"))).events).toEqual([]);
  });

  it("skips guardian review", async () => {
    expect((await parseRollout(f("06", "eeee0001"))).events).toEqual([]);
  });

  it("skips codex_exec and source exec", async () => {
    expect((await parseRollout(f("07", "ffff0001"))).events).toEqual([]);
    expect((await parseRollout(f("08", "ffff0002"))).events).toEqual([]);
  });

  it("skips injected AGENTS.md and tag blocks", async () => {
    const { events } = await parseRollout(f("09", "1111aaaa"));
    expect(events.filter((e) => e.kind === "user_text").map((e) => e.text)).toEqual(["Typed message about naming"]);
  });

  it("keeps only the typed text of an extension-wrapped message", async () => {
    const { events } = await parseRollout(f("15", "wrap0001"));
    const users = events.filter((e) => e.kind === "user_text");
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ text: "Please rename the helper", uuid: "wrap0001:2" });
    expect(events.map((e) => e.text ?? "").join("|")).not.toMatch(/Distinguish|Files mentioned|notes\.md/);
  });

  it("a wrapper without a request marker yields no event", async () => {
    expect((await parseRollout(f("15", "wrap0002"))).events).toEqual([]);
  });

  it("unwraps only a marker on its own line, and from the first marker", async () => {
    const root = mkdtempSync(join(tmpdir(), "nomore-codex-"));
    const rollout = (name: string, text: string) => {
      const file = join(root, `rollout-${name}.jsonl`);
      const rec = (type: string, payload: object) => JSON.stringify({ timestamp: "2026-10-20T10:00:00.000Z", type, payload });
      writeFileSync(file, `${rec("session_meta", { id: name, cwd: "/tmp/demo", originator: "codex-tui", source: "cli" })}\n${rec("response_item", { type: "message", role: "user", content: [{ type: "input_text", text }] })}\n`);
      return file;
    };
    const head = "# Files mentioned by the user:\n\n## a.md: /tmp/a.md\n\n";
    expect((await parseRollout(rollout("inline", `${head}see ## My request: inline\nnot typed`))).events).toEqual([]);
    const two = (await parseRollout(rollout("two", `${head}## My request:\nfirst\n## My request:\nsecond`))).events;
    expect(two.map((e) => e.text).join("|")).toContain("first");
    rmSync(root, { recursive: true });
  });

  it("listRollouts --project keeps a rollout that starts elsewhere and later enters the project", async () => {
    const root = mkdtempSync(join(tmpdir(), "nomore-codex-"));
    const day = join(root, "sessions", "2026", "10", "01");
    mkdirSync(day, { recursive: true });
    const rec = (type: string, cwd: string) => JSON.stringify({ timestamp: "2026-10-01T10:00:00Z", type, payload: { id: "x", cwd } });
    writeFileSync(join(day, "rollout-moved.jsonl"), [rec("session_meta", "/tmp/other"), rec("turn_context", "/tmp/demo")].join("\n") + "\n");
    writeFileSync(join(day, "rollout-never.jsonl"), [rec("session_meta", "/tmp/other"), rec("turn_context", "/tmp/demo-x")].join("\n") + "\n");
    const got = await listRollouts(root, { sinceMs: 0, project: "/tmp/demo" });
    expect(got.map((p) => p.split("/").at(-1))).toEqual(["rollout-moved.jsonl"]);
    rmSync(root, { recursive: true });
  });

  it("listRollouts drops a file that vanished between readdir and stat, and keeps one it cannot stat", async () => {
    const root = mkdtempSync(join(tmpdir(), "nomore-codex-"));
    const day = join(root, "sessions", "2026", "10", "01");
    mkdirSync(day, { recursive: true });
    symlinkSync(join(root, "gone"), join(day, "rollout-dangling.jsonl")); // stat -> ENOENT
    writeFileSync(join(day, "rollout-ok.jsonl"), "");
    const recent = { sinceMs: Date.now() - 86_400_000 }; // a negative sinceMs would let the -1 of ENOENT pass the filter
    expect((await listRollouts(root, recent)).map((p) => p.split("/").at(-1))).toEqual(["rollout-ok.jsonl"]);
    rmSync(root, { recursive: true });
  });

  it.skipIf(process.getuid?.() === 0)("listRollouts keeps a rollout it cannot stat (EACCES) so it is counted unreadable", async () => {
    const root = mkdtempSync(join(tmpdir(), "nomore-codex-"));
    const day = join(root, "sessions", "2026", "10", "01");
    const locked = join(root, "locked");
    mkdirSync(day, { recursive: true });
    mkdirSync(locked);
    writeFileSync(join(locked, "x.jsonl"), "");
    symlinkSync(join(locked, "x.jsonl"), join(day, "rollout-locked.jsonl"));
    chmodSync(locked, 0o000); // stat through the symlink now fails with EACCES; root ignores modes, hence the skipIf
    try {
      expect((await listRollouts(root, { sinceMs: Date.now() - 86_400_000 })).map((p) => p.split("/").at(-1))).toEqual(["rollout-locked.jsonl"]);
    } finally {
      chmodSync(locked, 0o700);
      rmSync(root, { recursive: true });
    }
  });

  it("an unreadable rollout is reported, not thrown, in the listing and the parser", async () => {
    // The walk descends into real folders, so use a symlink to a folder: listed like a file, but reading it fails (also as root, unlike chmod).
    const root = mkdtempSync(join(tmpdir(), "nomore-codex-"));
    const day = join(root, "sessions", "2026", "10", "01");
    mkdirSync(day, { recursive: true });
    symlinkSync(root, join(day, "rollout-bad.jsonl"));
    const [bad] = await listRollouts(root, { sinceMs: 0 });
    expect(bad).toMatch(/rollout-bad\.jsonl$/);
    expect(await parseRollout(bad)).toEqual({ events: [], skippedLines: 0, unreadable: true });
    expect(await listRollouts(root, { sinceMs: 0, project: "/tmp/demo" })).toEqual([bad]); // kept so it is counted
    rmSync(root, { recursive: true });
  });

  it("turn_aborted interrupted becomes user_marker and signals the next message", async () => {
    const { events } = await parseRollout(f("10", "2222aaaa"));
    expect(events.filter((e) => e.kind === "user_marker")).toHaveLength(1);
    expect(extractInstructions(events).find((c) => c.text === "Always use pnpm")?.signals).toContain("interrupt");
  });

  it("skips compacted replacement_history", async () => {
    const { events } = await parseRollout(f("11", "3333aaaa"));
    expect(events.map((e) => e.text).join("|")).not.toContain("Zebra");
    expect(events.filter((e) => e.kind === "user_text")).toHaveLength(2);
  });

  it("counts a partial last line as skipped", async () => {
    const { events, skippedLines } = await parseRollout(f("12", "4444aaaa"));
    expect(skippedLines).toBe(1);
    expect(events.filter((e) => e.kind === "user_text").map((e) => e.text)).toEqual(["Keep going"]);
  });

  it("skips pre-envelope rollouts as skipped lines", async () => {
    expect(await parseRollout(f("13", "5555aaaa"))).toEqual({ events: [], skippedLines: 3, unreadable: false });
  });

  it("takes cwd from turn_context", async () => {
    const { events } = await parseRollout(typed);
    expect(events.find((e) => e.text === "No, keep answers short")?.cwd).toBe("/tmp/demo");
    expect(events.find((e) => e.text === "Use tabs not spaces")?.cwd).toBe("/tmp/demo/sub");
  });

  it("ignores event_msg user_message", async () => {
    const { events } = await parseRollout(typed);
    expect(events.filter((e) => e.text === "No, keep answers short")).toHaveLength(1);
  });

  it("drops records without a timestamp", async () => {
    const { events, skippedLines } = await parseRollout(typed);
    expect(events.map((e) => e.text ?? "").join("|")).not.toContain("dropped");
    expect(skippedLines).toBe(0);
  });
});

describe("parseRollout: scale", () => {
  const tmp = () => mkdtempSync(join(tmpdir(), "nomore-codex-"));
  const meta = (extra: object = {}) => JSON.stringify({ timestamp: "2026-10-20T10:00:00Z", type: "session_meta", payload: { id: "s", cwd: "/c", originator: "codex-tui", source: "cli", ...extra } });

  it("stops reading after a skip decision", async () => {
    const d = tmp();
    const file = join(d, "rollout-x.jsonl");
    writeFileSync(file, `${meta({ source: { subagent: {} } })}\n{broken\n`);
    expect(await parseRollout(file)).toEqual({ events: [], skippedLines: 0, unreadable: false });
    rmSync(d, { recursive: true });
  });

  it("lists and parses 200 rollouts with 300k-char lines in time", async () => {
    const d = tmp();
    const day = join(d, "sessions", "2026", "10", "01");
    mkdirSync(day, { recursive: true });
    const big = JSON.stringify({ timestamp: "2026-10-20T10:00:01Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "x".repeat(300_000) }] } });
    for (let i = 0; i < 200; i++) writeFileSync(join(day, `rollout-${i}.jsonl`), `${meta(i % 2 ? { originator: "codex_exec" } : {})}\n${big}\n`);
    const files = await listRollouts(d, { sinceMs: 0, project: "/c" });
    expect(files).toHaveLength(200);
    const results = await Promise.all(files.map(parseRollout));
    expect(results.filter((r) => r.events.length === 1)).toHaveLength(100);
    rmSync(d, { recursive: true });
  });
});
