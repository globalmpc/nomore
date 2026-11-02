import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { createInterface } from "node:readline";
import type { Event } from "./types.js";

export const resolveCodexHome = (env: NodeJS.ProcessEnv, home: string) => env.CODEX_HOME ?? join(home, ".codex");

// The file Codex reads in a directory: a non-blank AGENTS.override.md replaces AGENTS.md. Used for both the rule check and --apply.
// ponytail: JS trim() also strips a BOM, Rust's may not, so a BOM-only override could differ from Codex; unverified, very unlikely.
// ponytail: this directory only; the repo-root-to-cwd walk, project_doc_max_bytes and fallback filenames are not modelled (#21).
export async function codexRuleFile(dir: string): Promise<string> {
  const override = join(dir, "AGENTS.override.md");
  return (await readFile(override, "utf8").catch(() => "")).trim() ? override : join(dir, "AGENTS.md");
}

type Rec = { timestamp?: unknown; type?: string; payload: Record<string, any> };
const isRec = (r: unknown): r is Rec => !!r && typeof r === "object" && typeof (r as Rec).type === "string" && !!(r as Rec).payload && typeof (r as Rec).payload === "object";

// Lines of a file; the stream is closed when the caller stops early (300k-char prompts are not read for nothing).
async function* lines(file: string) {
  const input = createReadStream(file);
  try {
    yield* createInterface({ input, crlfDelay: Infinity });
  } finally {
    input.destroy();
  }
}

// Subagent threads (guardian review included) and codex exec runs are not typed by the user.
const isScripted = (p: Rec["payload"]) => p.originator === "codex_exec" || p.source === "exec" || (!!p.source && typeof p.source === "object" && "subagent" in p.source);

// Accepts both the platform separator and "/", like the pipeline's own project filter.
const inside = (cwd: string, project: string) => {
  const root = project.replace(/[\\/]$/, "");
  return cwd === project || cwd.startsWith(root + sep) || cwd.startsWith(root + "/");
};

// True if any cwd the session reports (session_meta, or a later turn_context after a directory change) is inside the project. Throws on an unreadable file.
async function touchesProject(file: string, project: string): Promise<boolean> {
  for await (const line of lines(file)) {
    if (!line.includes('"cwd"')) continue;
    try {
      const r = JSON.parse(line);
      if (isRec(r) && (r.type === "session_meta" || r.type === "turn_context") && typeof r.payload.cwd === "string" && inside(r.payload.cwd, project)) return true;
    } catch {}
  }
  return false;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) out.push(...(await walk(join(dir, e.name))));
    else if (e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) out.push(join(dir, e.name));
  }
  return out;
}

export async function listRollouts(codexHome: string, opts: { sinceMs: number; project?: string }): Promise<string[]> {
  const files: string[] = [];
  for (const path of await walk(join(codexHome, "sessions"))) {
    // Deleted since readdir: skip it. Any other stat error (EACCES) keeps the file, so parseRollout counts it unreadable.
    const mtime = await stat(path).then((st) => st.mtimeMs, (e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? -1 : Infinity));
    if (mtime < opts.sinceMs) continue;
    // Codex has no folder per project: the cwds are in the file. Lookalikes and turns outside the project are removed later by the cwd check in runPipeline.
    // ponytail: a file with no cwd record (pre-envelope, cut-off) never matches, so --project drops it and it is not counted in skippedLines; add a count if that proves confusing.
    if (opts.project !== undefined) {
      const hit = await touchesProject(path, opts.project).catch(() => null); // null: unreadable, keep it so it is counted
      if (hit === false) continue;
    }
    files.push(path);
  }
  return files;
}

const parts = (content: unknown, type: string): string[] =>
  Array.isArray(content) ? content.filter((c) => c?.type === type && typeof c.text === "string").map((c) => c.text as string) : [];

// The VS Code extension wraps typed text as "<wrapper heading>...\n## My request:\n<typed>"; only the typed part is the user's.
// ponytail: only the one wrapper seen on real history; another shape (e.g. an IDE-context heading, or a `[N] ...` line before the heading, seen only in subagent files that are skipped whole) leaks until added to WRAPPERS/MARKER.
const WRAPPERS = ["# Files mentioned by the user:"];
const REQUEST_MARKER = /^## My request:.*$/m;
const unwrap = (t: string): string => {
  if (!WRAPPERS.some((w) => t.trimStart().startsWith(w))) return t;
  const m = REQUEST_MARKER.exec(t);
  return m ? t.slice(m.index + m[0].length) : "";
};

// A file that can't be read (permissions, a folder named rollout-*.jsonl) is reported as unreadable instead of ending the run.
export async function parseRollout(file: string): Promise<{ events: Event[]; skippedLines: number; unreadable: boolean }> {
  try {
    return { ...(await readRollout(file)), unreadable: false };
  } catch {
    return { events: [], skippedLines: 0, unreadable: true };
  }
}

async function readRollout(file: string): Promise<{ events: Event[]; skippedLines: number }> {
  const events: Event[] = [];
  let skippedLines = 0;
  let sessionId: string | undefined; // set by the first session_meta, which decides whether the file counts
  let cwd = "";
  let n = 0;
  for await (const line of lines(file)) {
    n++;
    if (line.trim() === "") continue;
    let r: unknown;
    try {
      r = JSON.parse(line);
    } catch {
      skippedLines++; // a rollout still being written ends in a partial line
      continue;
    }
    // ponytail: rollouts from before the {timestamp,type,payload} envelope are only counted, not read; add a second parser if someone needs them.
    if (!isRec(r)) {
      skippedLines++;
      continue;
    }
    const p = r.payload;
    if (r.type === "session_meta") {
      if (sessionId !== undefined) continue; // later ones belong to a parent thread
      if (isScripted(p)) return { events: [], skippedLines };
      sessionId = String(p.id ?? "");
      if (typeof p.cwd === "string") cwd = p.cwd;
      continue;
    }
    if (r.type === "turn_context") {
      if (typeof p.cwd === "string") cwd = p.cwd;
      continue;
    }
    // Ranking needs a time; without one the record can't be placed, so it is dropped.
    if (typeof r.timestamp !== "string" || Number.isNaN(Date.parse(r.timestamp))) continue;
    const base = { uuid: `${sessionId ?? ""}:${n}`, sessionId: sessionId ?? "", cwd, ts: r.timestamp };
    if (r.type === "event_msg") {
      if (p.type === "turn_aborted" && p.reason === "interrupted") events.push({ ...base, kind: "user_marker", text: "interrupted" });
    } else if (r.type === "response_item") {
      if (p.type === "message" && p.role === "user") {
        // Injected context arrives as user messages too: AGENTS.md text and tag blocks.
        const text = parts(p.content, "input_text").map(unwrap).filter((t) => !t.startsWith("# AGENTS.md instructions") && !t.trimStart().startsWith("<")).join("\n").trim();
        if (text !== "") events.push({ ...base, kind: "user_text", text });
      } else if (p.type === "message" && p.role === "assistant") {
        events.push({ ...base, kind: "assistant_text", text: parts(p.content, "output_text").join("\n") });
      } else if ((p.type === "function_call" || p.type === "custom_tool_call") && typeof p.name === "string") {
        events.push({ ...base, kind: "assistant_tool_use", tool: p.name, input: {} });
      }
    }
  }
  return { events, skippedLines };
}
