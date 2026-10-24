import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Event } from "./types.js";

export const resolveConfigDir = (env: NodeJS.ProcessEnv, home: string) => env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");

// Claude Code names a project's folder after its path with every non-alphanumeric character replaced by "-".
const encodeProject = (path: string) => path.replace(/[^a-zA-Z0-9]/g, "-");

export async function listSessionFiles(configDir: string, opts: { sinceMs: number; project?: string }): Promise<string[]> {
  const root = join(configDir, "projects");
  const dirs = await readdir(root).catch(() => [] as string[]);
  const files: string[] = [];
  for (const d of dirs.sort()) {
    // Sessions started in a subfolder live in their own encoded folder ("-repo-web"); lookalikes ("-repo-other") are
    // removed later by the cwd check in runPipeline.
    if (opts.project !== undefined && d !== encodeProject(opts.project) && !d.startsWith(encodeProject(opts.project) + "-")) continue;
    const names = await readdir(join(root, d)).catch(() => [] as string[]);
    for (const f of names.filter((n) => n.endsWith(".jsonl")).sort()) {
      const path = join(root, d, f);
      if ((await stat(path)).mtimeMs >= opts.sinceMs) files.push(path);
    }
  }
  return files;
}

type Item = { type?: string; text?: string; name?: string; input?: Record<string, unknown>; is_error?: boolean; content?: unknown };
const REJECTED = "The user doesn't want to proceed";
const INTERRUPT = "[Request interrupted by user";

// IDE context (<ide_opened_file>…), command tags and command output arrive as complete tag blocks before the text.
const stripLeadingTags = (s: string) => s.replace(/^\s*(<([\w-]+)[^>]*>[\s\S]*?<\/\2>\s*)+/, "");

const resultText = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((i: Item) => (typeof i?.text === "string" ? i.text : "")).join("") : "";

// One record → zero or more events (spec › Inputs, › Not a user message). Unknown shapes yield nothing.
function toEvents(r: Record<string, unknown>): Event[] {
  if (r.isSidechain === true || typeof r.uuid !== "string") return [];
  // sdk-cli, sdk-ts, sdk-py: Claude Code run by a script, whose "user" messages are program-written templates.
  if (typeof r.entrypoint === "string" && r.entrypoint.startsWith("sdk")) return [];
  const base = { uuid: r.uuid, sessionId: String(r.sessionId ?? ""), cwd: String(r.cwd ?? ""), ts: String(r.timestamp ?? "") };
  const content = (r.message as { content?: unknown } | undefined)?.content;
  if (r.type === "user") {
    const injected = r.isMeta === true || r.isCompactSummary === true; // compaction summaries are written by Claude Code
    const typed = (raw: string): Event[] => {
      const text = stripLeadingTags(raw).trim();
      return injected || text === "" || text.startsWith("<") ? [] : [{ ...base, kind: "user_text", text }];
    };
    if (typeof content === "string") return typed(content);
    if (!Array.isArray(content)) return [];
    const signals = content.flatMap((i: Item): Event[] => {
      if (i?.type === "text" && typeof i.text === "string" && i.text.startsWith(INTERRUPT)) return [{ ...base, kind: "user_marker", text: i.text }];
      if (i?.type === "tool_result" && i.is_error === true && resultText(i.content).startsWith(REJECTED)) return [{ ...base, kind: "tool_rejected" }];
      return [];
    });
    // IDE extensions and pasted images store a typed message as blocks: join its plain text blocks.
    if (content.some((i: Item) => i?.type === "tool_result")) return signals;
    const text = content
      .filter((i: Item) => i?.type === "text" && typeof i.text === "string" && !i.text.startsWith(INTERRUPT) && !i.text.trimStart().startsWith("<"))
      .map((i: Item) => i.text)
      .join("\n");
    return [...signals, ...typed(text)];
  }
  if (r.type === "assistant" && Array.isArray(content)) {
    return content.flatMap((i: Item): Event[] => {
      if (i?.type === "tool_use" && typeof i.name === "string") return [{ ...base, kind: "assistant_tool_use", tool: i.name, input: i.input ?? {} }];
      if (i?.type === "text" && typeof i.text === "string") return [{ ...base, kind: "assistant_text", text: i.text }];
      return [];
    });
  }
  return [];
}

export async function parseSession(file: string): Promise<{ events: Event[]; skippedLines: number }> {
  const events: Event[] = [];
  let skippedLines = 0;
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    if (line.trim() === "") continue;
    let r: unknown;
    try {
      r = JSON.parse(line);
    } catch {
      skippedLines++; // a session still being written ends in a partial line
      continue;
    }
    if (r && typeof r === "object") events.push(...toEvents(r as Record<string, unknown>));
  }
  return { events, skippedLines };
}
