import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const HEADING = "## nomore rules";

// Writes through a symlinked CLAUDE.md to its target. The temp file has a random name and is created exclusively,
// so nothing planted next to the target can redirect the write. An existing file keeps its exact permissions; a new
// one gets `newMode` narrowed by the umask; `forceMode` always applies (the adoption log is owner-only).
const writeAtomic = async (path: string, text: string, opts: { newMode?: number; forceMode?: number } = {}) => {
  const target = await realpath(path).catch(() => path);
  await mkdir(dirname(target), { recursive: true });
  const existing = await stat(target).then((st) => st.mode & 0o777, () => undefined);
  const mode = opts.forceMode ?? existing ?? opts.newMode ?? 0o666;
  const tmp = join(dirname(target), `.${basename(target)}.nomore-${randomUUID()}.tmp`);
  await writeFile(tmp, text, { mode, flag: "wx" });
  if (opts.forceMode !== undefined || existing !== undefined) await chmod(tmp, mode); // the umask may have narrowed it
  await rename(tmp, target);
};

const readOrEmpty = (path: string) =>
  readFile(path, "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });

// Spec › Machine-supported decision: chosen rules go at the end of the "## nomore rules" section; a rule already
// written as a bullet anywhere in the file is skipped; existing content and line endings are kept; atomic write.
export async function applyRules(target: string, rules: string[]): Promise<{ added: string[]; skipped: string[] }> {
  const old = await readOrEmpty(target);
  const eol = old.includes("\r\n") ? "\r\n" : "\n";
  const lines = old === "" ? [] : old.replace(/\r?\n$/, "").split(/\r?\n/);
  const present = new Set(lines.map((l) => l.trim()).filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim()));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const rule of rules.map((r) => r.trim()).filter(Boolean)) {
    if (present.has(rule)) skipped.push(rule);
    else present.add(rule), added.push(rule);
  }
  if (added.length === 0) return { added, skipped };

  const bullets = added.map((r) => `- ${r}`);
  const h = lines.findIndex((l) => l.trim() === HEADING);
  if (h < 0) {
    while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop();
    lines.push(...(lines.length > 0 ? [""] : []), HEADING, "", ...bullets);
  } else {
    const next = lines.findIndex((l, i) => i > h && /^#{1,6}\s/.test(l));
    let at = next < 0 ? lines.length : next;
    while (at > h + 1 && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, ...(at === h + 1 ? ["", ...bullets] : bullets));
  }
  await writeAtomic(target, lines.join(eol) + eol);
  return { added, skipped };
}

export async function recordAdoption(
  configDir: string,
  entry: { groupId: string; text: string; target: string },
  nowIso: string,
): Promise<void> {
  const file = join(configDir, "nomore", "adopted.json");
  const raw = await readOrEmpty(file);
  let log: unknown[] = [];
  if (raw !== "") {
    try {
      log = JSON.parse(raw);
      if (!Array.isArray(log)) throw new Error("not a JSON array");
    } catch (e) {
      throw new Error(`${file} can't be read (${(e as Error).message}); fix or remove it`);
    }
  }
  log.push({ ...entry, adoptedAt: nowIso });
  await writeAtomic(file, JSON.stringify(log, null, 2) + "\n", { forceMode: 0o600 });
}
