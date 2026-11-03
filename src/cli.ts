#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { applyRules, recordAdoption } from "./apply.js";
import { codexRuleFile, resolveCodexHome } from "./codex.js";
import { runPipeline } from "./pipeline.js";
import { NOTHING_YET, NOTHING_YET_CODEX, RULE_PACK, RULE_PACK_CODEX, renderCard, renderReport, skippedFilesNote } from "./report.js";
import { resolveConfigDir } from "./sessions.js";
import type { Report } from "./types.js";

const USAGE = `Usage: nomore [--days <n>] [--agent claude|codex] [--project <path>] [--json | --card | --apply]

Finds what you keep telling Claude Code (or Codex) and suggests CLAUDE.md (or AGENTS.md) rules. Runs locally; writes only with --apply.
  --days <n>        sessions active in the last n days (default 30)
  --agent <name>    claude (default) or codex; codex reads $CODEX_HOME/sessions (default ~/.codex)
  --project <path>  only sessions from this project; also checks and writes its CLAUDE.md (AGENTS.md with --agent codex)
  --json            machine-readable report
  --card            short summary to share: totals only, no suggestion text
  --apply           pick rules one by one and add them to CLAUDE.md (AGENTS.md with --agent codex)`;

// One readable reason for a file error, instead of a stack trace with temp-file paths.
const reason = (e: unknown) => {
  const code = (e as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EPERM" ? "permission denied" : code === "EROFS" ? "read-only file system" : code === "EISDIR" ? "it is a folder" : (e as Error).message;
};

// With --project, name the project (a typo shouldn't read as "you have no sessions at all"), and say if it doesn't exist.
const noSessions = (name: string, sessionsDir: string, days: number, pack: string, project?: string) =>
  project
    ? `No ${name} sessions for ${project} in the last ${days} days.\n${existsSync(project) ? "" : "That folder doesn't exist; check the path.\n"}${pack}`
    : `No ${name} sessions found in ${sessionsDir} in the last ${days} days\n${pack}`;

// Spec › Machine-supported decision: nothing is written unless the user picks a rule.
async function applyInteractively(report: Report, target: string, configDir: string, nothingYet: string): Promise<number> {
  if (report.skippedFiles) console.log(skippedFilesNote(report));
  if (report.suggestions.length === 0) return console.log(nothingYet), 0;
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  // undefined means input ended: every caller treats it as quit, so it is never taken as an answer or rule text.
  let answered = false;
  const ask = async (q: string): Promise<string | undefined> => {
    process.stdout.write(q);
    const r = await lines.next();
    const a = r.done ? undefined : String(r.value).trim();
    // A terminal echoes the answer itself; piped input doesn't, so echo it and end the line (also on EOF).
    if (!process.stdin.isTTY) process.stdout.write(`${a ?? ""}\n`);
    if (a !== undefined) answered = true;
    return a;
  };
  console.log(`Rules will be added to ${target}\n`);
  const chosen: { groupId: string; text: string }[] = [];
  for (const s of report.suggestions) {
    const seen = `${s.count}× in ${s.sessions} sessions`;
    const answer = (
      s.status === "ignored"
        ? await ask(`Your rule "${s.matchedRule}" isn't followed (${seen}). Add a reworded rule? [e/n/q] `)
        : await ask(`Add "${s.text}"? (${seen}) [y/n/e/q] `)
    )?.toLowerCase();
    if (answer === undefined || answer.startsWith("q")) break;
    if (answer.startsWith("y") && s.status === "new") chosen.push({ groupId: s.id, text: s.text });
    if (answer.startsWith("e")) {
      const text = await ask("Rule: ");
      if (text === undefined) break;
      if (text) chosen.push({ groupId: s.id, text });
    }
  }
  rl.close();
  if (!answered && !process.stdin.isTTY) console.log("--apply asks you one rule at a time; run it in a terminal, or use --json to read the suggestions.");
  if (chosen.length === 0) return console.log("No rules added."), 0;
  let result;
  try {
    result = await applyRules(target, chosen.map((c) => c.text));
  } catch (e) {
    // The write goes through a temp file and a rename, so nothing is half-written.
    return console.error(`Couldn't write ${target}: ${reason(e)}. No rules were added.`), 1;
  }
  const { added, skipped } = result;
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
        agent: { type: "string", default: "claude" },
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
  if (values.agent !== "claude" && values.agent !== "codex") return console.error(`--agent must be claude or codex\n\n${USAGE}`), 1;
  const agent = values.agent;
  if (values.apply && (values.json || values.card)) return console.error(`--apply can't be combined with --json or --card\n\n${USAGE}`), 1;

  const codex = agent === "codex";
  const configDir = codex ? resolveCodexHome(process.env, homedir()) : resolveConfigDir(process.env, homedir());
  const sessionsDir = join(configDir, codex ? "sessions" : "projects");
  const name = codex ? "Codex" : "Claude Code";
  const pack = codex ? RULE_PACK_CODEX : RULE_PACK;
  const empty: Report = { scannedSessions: 0, skippedLines: 0, skippedFiles: 0, corrections: 0, suggestions: [] };
  if (!existsSync(sessionsDir)) {
    if (values.json) return console.log(JSON.stringify(empty, null, 2)), 0;
    const elsewhere = codex ? "If Codex keeps its data elsewhere, set CODEX_HOME to that folder." : "If Claude Code keeps its data elsewhere, set CLAUDE_CONFIG_DIR to that folder.";
    // ponytail: the hint only covers a missing projects folder, not an empty one; widen if Codex-only users still get lost.
    const codexDir = join(resolveCodexHome(process.env, homedir()), "sessions");
    const hint = !codex && existsSync(codexDir) ? `\nFound Codex sessions in ${codexDir}; run nomore --agent codex` : "";
    return console.log(`No ${name} sessions found in ${sessionsDir}\n${elsewhere}\n${pack}${hint}`), 0;
  }
  const project = values.project && resolve(values.project);
  const report = await runPipeline({ configDir, days, project, nowMs: Date.now(), agent });
  if (report.scannedSessions === 0)
    return console.log(values.json ? JSON.stringify(report, null, 2) : noSessions(name, sessionsDir, days, pack, project)), 0;
  if (values.apply) return applyInteractively(report, codex ? await codexRuleFile(project ?? configDir) : join(project ?? configDir, "CLAUDE.md"), configDir, codex ? NOTHING_YET_CODEX : NOTHING_YET);
  process.stdout.write(values.json ? JSON.stringify(report, null, 2) + "\n" : values.card ? renderCard(report) : renderReport(report, codex ? NOTHING_YET_CODEX : NOTHING_YET));
  return 0;
}

main().then(
  (code) => (process.exitCode = code),
  (e) => {
    console.error(`nomore: ${reason(e)}`); // last resort: a message, not a stack trace
    process.exitCode = 1;
  },
);
