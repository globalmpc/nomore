// Label what nomore shows on your own sessions, to measure precision on fresh data. Your messages are shown only in
// your terminal; the output file holds group ids and labels, no text.
// Usage: pnpm tsx scripts/label-groups.ts <out.jsonl> [days, default 30] [--agent claude|codex]   (respects CLAUDE_CONFIG_DIR / CODEX_HOME)
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { runPipeline } from "../src/pipeline.js";
import { resolveCodexHome } from "../src/codex.js";
import { resolveConfigDir } from "../src/sessions.js";

const USAGE = "usage: pnpm tsx scripts/label-groups.ts <out.jsonl> [days, default 30] [--agent claude|codex]";
const args = process.argv.slice(2);
const at = args.indexOf("--agent");
const agent = at < 0 ? "claude" : args.splice(at, 2)[1]; // ponytail: no --agent=codex form
const [out, days = "30", ...extra] = args;
if ((agent !== "claude" && agent !== "codex") || !out || out.startsWith("-") || extra.length > 0 || !(Number(days) > 0)) {
  console.error(USAGE);
  process.exit(1);
}
const report = await runPipeline({ configDir: agent === "codex" ? resolveCodexHome(process.env, homedir()) : resolveConfigDir(process.env, homedir()), days: Number(days), nowMs: Date.now(), agent });
const shown = report.suggestions.slice(0, 20);
if (shown.length === 0 && existsSync(out)) {
  console.log(`0 repeated groups; ${out} left unchanged.`);
  process.exit(0);
}
const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
console.log(`${shown.length} repeated groups. For each: would you want it as a permanent rule in ${agent === "codex" ? "AGENTS.md" : "CLAUDE.md"}? (y/n)\n`);
const labels: { id: string; label: "rule" | "not" }[] = [];
for (const [i, s] of shown.entries()) {
  console.log(`${i + 1}. ${s.text}  (${s.sessions} sessions)\n   e.g. ${s.examples.map((e) => JSON.stringify(e.slice(0, 60))).join(" | ")}`);
  process.stdout.write("   rule? [y/n] ");
  const next = await lines.next();
  if (next.done) break; // input ended: the groups left are not labelled, never silently counted as "not"
  labels.push({ id: s.id, label: String(next.value).trim().toLowerCase().startsWith("y") ? "rule" : "not" });
  console.log();
}
if (labels.length < shown.length) console.log(`\ninput ended after ${labels.length} of ${shown.length} groups; the rest are not labelled.`);
if (labels.length === 0) {
  console.error(`no answers; ${out} not written.`);
  process.exit(1);
}
writeFileSync(out, labels.map((l) => JSON.stringify(l)).join("\n") + "\n");
const yes = labels.filter((l) => l.label === "rule").length;
console.log(`precision ${(yes / labels.length).toFixed(2)} (${yes} of ${labels.length}); labels saved to ${out} (ids only)`);
process.exit(0);
