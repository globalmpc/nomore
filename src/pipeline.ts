import { join, sep } from "node:path";
import { clauseTokens, extractInstructions, isNegated } from "./detect.js";
import { groupItems } from "./group.js";
import { rankGroups } from "./rank.js";
import { readRuleLines, toSuggestions } from "./rules.js";
import { listSessionFiles, parseSession } from "./sessions.js";
import { Report, type Correction, type Signal } from "./types.js";

const GROUP_THRESHOLD = 0.6; // spec › Grouping (clauses)

export async function runPipeline(opts: { configDir: string; days: number; project?: string; nowMs: number }): Promise<Report> {
  const files = await listSessionFiles(opts.configDir, { sinceMs: opts.nowMs - opts.days * 86_400_000, project: opts.project });
  const corrections: Correction[] = [];
  let skippedLines = 0;
  for (const f of files) {
    const s = await parseSession(f);
    skippedLines += s.skippedLines;
    corrections.push(...extractInstructions(s.events));
  }
  // Two project paths can share one encoded folder (/tmp/a-b, /tmp/a_b): keep only instructions from inside the project.
  if (opts.project) {
    const root = opts.project;
    corrections.splice(0, corrections.length, ...corrections.filter((c) => c.cwd === root || c.cwd.startsWith(root + sep) || c.cwd.startsWith(root + "/")));
  }
  // Grouping runs per polarity, and negated clauses carry a "<not>" token, so ids never collide across the two.
  const byPolarity = [corrections.filter((c) => !isNegated(c.text)), corrections.filter((c) => isNegated(c.text))];
  const grouped = byPolarity.flatMap((cs, negated) =>
    groupItems(cs.map((c) => ({ id: c.uuid, ts: c.ts, c })), (x) => [...clauseTokens(x.c.text), ...(negated ? ["<not>"] : [])], GROUP_THRESHOLD),
  );
  const groups = grouped.map((g) => {
    const members = g.members.map((m) => m.c);
    return {
      id: g.id,
      members,
      representative: g.representative.c,
      count: members.length,
      sessions: new Set(members.map((m) => m.sessionId)).size,
      projects: new Set(members.map((m) => m.cwd)).size,
      days: new Set(members.map((m) => m.ts.slice(0, 10))).size,
      lastSeen: members.map((m) => m.ts).sort().at(-1)!,
      signals: [...new Set(members.flatMap((m) => m.signals))].sort() as Signal[],
    };
  });
  const rules = await readRuleLines([...(opts.project ? [join(opts.project, "CLAUDE.md")] : []), join(opts.configDir, "CLAUDE.md")]);
  return Report.parse({
    scannedSessions: files.length,
    skippedLines,
    corrections: corrections.length,
    suggestions: toSuggestions(rankGroups(groups, opts.nowMs), rules),
  });
}
