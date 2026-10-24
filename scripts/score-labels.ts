// Re-scores labels from scripts/label-groups.ts against what the tool shows now, so nobody has to label again.
// Prints numbers only. --variants compares candidate filters and rankings on the same labels.
// Usage: pnpm tsx scripts/score-labels.ts <labels.jsonl> [days, default 30] [--variants]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { runPipeline } from "../src/pipeline.js";
import { resolveConfigDir } from "../src/sessions.js";
import type { Suggestion } from "../src/types.js";

const USAGE = "usage: pnpm tsx scripts/score-labels.ts <labels.jsonl> [days, default 30] [--variants]";
const args = process.argv.slice(2);
const variants = args.includes("--variants");
const [file, days = "30", ...extra] = args.filter((a) => a !== "--variants");
if (!file || file.startsWith("-") || extra.length > 0 || !(Number(days) > 0)) {
  console.error(USAGE);
  process.exit(1);
}
const labels = new Map(
  readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => {
    const { id, label } = JSON.parse(l) as { id: string; label: string };
    return [id, label] as const;
  }),
);
const all = (await runPipeline({ configDir: resolveConfigDir(process.env, homedir()), days: Number(days), nowMs: Date.now() })).suggestions;

const score = (shown: Suggestion[]) => {
  const ids = shown.map((s) => s.id);
  const labelled = ids.filter((id) => labels.has(id));
  const rules = labelled.filter((id) => labels.get(id) === "rule").length;
  return { labelled: labelled.length, rules, unlabelled: ids.length - labelled.length };
};
const pct = (a: number, b: number) => (b ? a / b : 0).toFixed(2);

if (!variants) {
  const s = score(all.slice(0, 20));
  console.log(`precision ${pct(s.rules, s.labelled)} (${s.rules} of ${s.labelled} labelled shown), unlabelled shown ${s.unlabelled}`);
} else {
  // Each variant only hides or reorders groups, so group ids (and the labels) stay valid.
  const corrected = (s: Suggestion) => s.signals.includes("rejected") || s.signals.includes("interrupt");
  const runs: [string, Suggestion[]][] = [
    ["baseline", all.slice(0, 20)],
    ["2+ projects", all.filter((s) => s.projects >= 2).slice(0, 20)],
    ["2+ days", all.filter((s) => s.days >= 2).slice(0, 20)],
    ["signals boost", [...all].sort((a, b) => b.score * (corrected(b) ? 2 : 1) - a.score * (corrected(a) ? 2 : 1)).slice(0, 20)],
    ["top 5", all.slice(0, 5)],
  ];
  const base = score(runs[0][1]).rules;
  for (const [name, shown] of runs) {
    const s = score(shown);
    console.log(`${name.padEnd(14)} precision ${pct(s.rules, s.labelled)} (${s.rules} of ${s.labelled} labelled shown), rules kept ${s.rules} of ${base}, unlabelled ${s.unlabelled}`);
  }
}
