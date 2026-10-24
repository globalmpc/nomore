import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSessionFiles, parseSession, resolveConfigDir } from "../src/sessions.js";

const dir = "test/fixtures";
const s1 = `${dir}/projects/-tmp-demo/s1.jsonl`;

describe("resolveConfigDir", () => {
  it("respects CLAUDE_CONFIG_DIR, else ~/.claude", () => {
    expect(resolveConfigDir({ CLAUDE_CONFIG_DIR: "/x" }, "/h")).toBe("/x");
    expect(resolveConfigDir({}, "/h")).toBe(join("/h", ".claude"));
  });
});

describe("parseSession", () => {
  it("skips broken lines, injected messages, meta and sidechain records", async () => {
    const { events, skippedLines } = await parseSession(s1);
    expect(skippedLines).toBe(1);
    expect(events.filter((e) => e.text?.startsWith("<"))).toEqual([]);
    expect(events.map((e) => e.uuid)).not.toContain("s1-u6");
    expect(events.map((e) => e.uuid)).not.toContain("s1-u8"); // compaction summary written by Claude Code
    expect(events.map((e) => e.uuid)).not.toContain("s1-u7");
    expect(events.map((e) => e.uuid)).not.toContain("s1-a2");
    expect(events.filter((e) => e.kind === "tool_rejected")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "user_marker")).toHaveLength(1);
    expect(events.find((e) => e.kind === "assistant_tool_use")).toMatchObject({ tool: "Bash", input: { command: "npm install" } });
  });
});

describe("listSessionFiles", () => {
  it("finds sessions, filters by project and survives a missing folder", async () => {
    expect(await listSessionFiles(dir, { sinceMs: 0 })).toHaveLength(3);
    expect(await listSessionFiles(dir, { sinceMs: 0, project: "/tmp/demo" })).toHaveLength(3);
    expect(await listSessionFiles(dir, { sinceMs: 0, project: "/other" })).toHaveLength(0);
    expect(await listSessionFiles(dir, { sinceMs: Date.now() + 86_400_000 })).toHaveLength(0);
    expect(await listSessionFiles("/nonexistent", { sinceMs: 0 })).toEqual([]);
  });
});

describe("parseSession: scripted runs", () => {
  it("skips sessions run by a script or the SDK, keeps interactive ones", async () => {
    expect((await parseSession("test/fixtures/heavy/projects/-tmp-heavy/a1.jsonl")).events).toEqual([]);
    expect((await parseSession("test/fixtures/heavy/projects/-tmp-heavy/i1.jsonl")).events.length).toBeGreaterThan(0);
  });
});

describe("parseSession: IDE and multi-block messages", () => {
  const session = async (...records: Record<string, unknown>[]) => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    const f = join(dir, "s.jsonl");
    writeFileSync(f, records.map((r, i) => JSON.stringify({ type: "user", uuid: `u${i}`, sessionId: "s", cwd: "/c", timestamp: "t", entrypoint: "claude-vscode", ...r })).join("\n"));
    const { events } = await parseSession(f);
    rmSync(dir, { recursive: true });
    return events.filter((e) => e.kind === "user_text").map((e) => e.text);
  };

  it("reads a typed message that starts with IDE context", async () => {
    expect(await session({ message: { content: "<ide_opened_file>The user opened src/a.ts</ide_opened_file>\nnever push without asking" } })).toEqual([
      "never push without asking",
    ]);
  });

  it("reads typed text from a list of blocks, skipping tag blocks", async () => {
    expect(
      await session(
        { message: { content: [{ type: "text", text: "<ide_selection>const x = 1</ide_selection>" }, { type: "text", text: "keep answers short" }] } },
        { message: { content: [{ type: "image", source: {} }, { type: "text", text: "use this layout" }] } },
      ),
    ).toEqual(["keep answers short", "use this layout"]);
  });

  it("still skips injected messages", async () => {
    expect(
      await session(
        { message: { content: "<command-name>/clear</command-name>\n<command-message>clear</command-message>" } },
        { isMeta: true, message: { content: [{ type: "text", text: "Base directory for this skill: /x" }] } },
        { message: { content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }, { type: "text", text: "<system-reminder>x</system-reminder>" }] } },
      ),
    ).toEqual([]);
  });
});
