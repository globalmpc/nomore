#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { applyRules, recordAdoption } from "./apply.js";
import { runPipeline } from "./pipeline.js";
import { NOTHING_YET, renderCard, renderReport } from "./report.js";
import { resolveConfigDir } from "./sessions.js";
import type { Report } from "./types.js";

const USAGE = `Usage: nomore [--days <n>] [--project <path>] [--json | --card | --apply]

Finds what you keep telling Claude Code and suggests CLAUDE.md rules. Runs locally; writes only with --apply.
  --days <n>        sessions active in the last n days (default 30)
  --project <path>  only sessions from this project; also checks and writes its CLAUDE.md
  --json            machine-readable report
  --card            short summary to share: totals only, no suggestion text
  --apply           pick rules one by one and add them to CLAUDE.md`;

// Spec › Machine-supported decision: nothing is written unless the user picks a rule.
async function applyInteractively(report: Report, target: string, configDir: string): Promise<number> {
  if (report.suggestions.length === 0) return console.log(NOTHING_YET), 0;
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (q: string) => {
    process.stdout.write(q);
    const r = await lines.next();
    return r.done ? "q" : String(r.value).trim();
  };
  console.log(`Rules will be added to ${target}\n`);
  const chosen: { groupId: string; text: string }[] = [];
  for (const s of report.suggestions) {
    const seen = `${s.count}× in ${s.sessions} sessions`;
    const answer = (
      s.status === "ignored"
        ? await ask(`Your rule "${s.matchedRule}" isn't followed (${seen}). Add a reworded rule? [e/n/q] `)
        : await ask(`Add "${s.text}"? (${seen}) [y/n/e/q] `)
    ).toLowerCase();
    if (answer.startsWith("q")) break;
    if (answer.startsWith("y") && s.status === "new") chosen.push({ groupId: s.id, text: s.text });
    if (answer.startsWith("e")) {
      const text = await ask("Rule: ");
      if (text) chosen.push({ groupId: s.id, text });
    }
  }
  rl.close();
  if (chosen.length === 0) return console.log("No rules added."), 0;
  const { added, skipped } = await applyRules(target, chosen.map((c) => c.text));
  try {
    for (const c of chosen.filter((c) => added.includes(c.text.trim()))) await recordAdoption(configDir, { ...c, text: c.text.trim(), target }, new Date().toISOString());
  } catch (e) {
    console.error(`Rules were added, but the adoption log wasn't updated: ${(e as Error).message}`);
  }
  console.log(`✓ ${added.length} ${added.length === 1 ? "rule" : "rules"} added to ${target}` + (skipped.length ? ` (${skipped.length} already there)` : ""));
  return 0;
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        days: { type: "string", default: "30" },
        project: { type: "string" },
        json: { type: "boolean" },
        card: { type: "boolean" },
        apply: { type: "boolean" },
        help: { type: "boolean" },
      },
    }));
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${USAGE}`);
    return 1;
  }
  if (values.help) return console.log(USAGE), 0;
  const days = Number(values.days);
  if (!(days > 0)) return console.error(`--days must be a positive number\n\n${USAGE}`), 1;
  if (values.apply && (values.json || values.card)) return console.error(`--apply can't be combined with --json or --card\n\n${USAGE}`), 1;

  const configDir = resolveConfigDir(process.env, homedir());
  const empty: Report = { scannedSessions: 0, skippedLines: 0, corrections: 0, suggestions: [] };
  if (!existsSync(join(configDir, "projects")))
    return console.log(values.json ? JSON.stringify(empty, null, 2) : `No Claude Code sessions found in ${join(configDir, "projects")}`), 0;
  const project = values.project && resolve(values.project);
  const report = await runPipeline({ configDir, days, project, nowMs: Date.now() });
  if (report.scannedSessions === 0)
    return console.log(values.json ? JSON.stringify(report, null, 2) : `No Claude Code sessions found in ${join(configDir, "projects")} in the last ${days} days`), 0;
  if (values.apply) return applyInteractively(report, join(project ?? configDir, "CLAUDE.md"), configDir);
  process.stdout.write(values.json ? JSON.stringify(report, null, 2) + "\n" : values.card ? renderCard(report) : renderReport(report));
  return 0;
}

main().then((code) => (process.exitCode = code));
