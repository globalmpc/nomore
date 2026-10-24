// Label what nomore shows on your own sessions, to measure precision on fresh data. Your messages are shown only in
// your terminal; the output file holds group ids and labels, no text.
// Usage: pnpm tsx scripts/label-groups.ts <out.jsonl> [days, default 30]   (respects CLAUDE_CONFIG_DIR)
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { runPipeline } from "../src/pipeline.js";
import { resolveConfigDir } from "../src/sessions.js";

const USAGE = "usage: pnpm tsx scripts/label-groups.ts <out.jsonl> [days, default 30]";
const [out, days = "30", ...extra] = process.argv.slice(2);
if (!out || out.startsWith("-") || extra.length > 0 || !(Number(days) > 0)) {
  console.error(USAGE);
  process.exit(1);
}
const report = await runPipeline({ configDir: resolveConfigDir(process.env, homedir()), days: Number(days), nowMs: Date.now() });
const shown = report.suggestions.slice(0, 20);
if (shown.length === 0 && existsSync(out)) {
  console.log(`0 repeated groups; ${out} left unchanged.`);
  process.exit(0);
}
const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
console.log(`${shown.length} repeated groups. For each: would you want it as a permanent rule in CLAUDE.md? (y/n)\n`);
const labels: { id: string; label: "rule" | "not" }[] = [];
for (const [i, s] of shown.entries()) {
  console.log(`${i + 1}. ${s.text}  (${s.sessions} sessions)\n   e.g. ${s.examples.map((e) => JSON.stringify(e.slice(0, 60))).join(" | ")}`);
  process.stdout.write("   rule? [y/n] ");
  const answer = String((await lines.next()).value ?? "").trim().toLowerCase();
  labels.push({ id: s.id, label: answer.startsWith("y") ? "rule" : "not" });
  console.log();
}
writeFileSync(out, labels.map((l) => JSON.stringify(l)).join("\n") + "\n");
const yes = labels.filter((l) => l.label === "rule").length;
console.log(`precision ${(labels.length ? yes / labels.length : 0).toFixed(2)} (${yes} of ${labels.length}); labels saved to ${out} (ids only)`);
process.exit(0);
