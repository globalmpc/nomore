import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isNegated } from "./detect.js";
import { idf, similarity } from "./group.js";
import { normalize, tokens } from "./normalize.js";
import { Suggestion, type Group } from "./types.js";

const RULE_MATCH = 0.3; // spec › Rule check

// Bullet or sentence lines of the rules files; headings, blanks and missing files are skipped. A line "@path"
// imports another file in its place (Claude Code's CLAUDE.md imports: relative to the file, or ~/), once each.
export async function readRuleLines(paths: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const read = async (path: string): Promise<string[]> => {
    if (seen.has(path)) return [];
    seen.add(path);
    const text = await readFile(path, "utf8").catch(() => "");
    const out: string[] = [];
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      const imp = line.match(/^@(\S+)$/);
      if (imp) out.push(...(await read(imp[1].startsWith("~/") ? join(homedir(), imp[1].slice(2)) : resolve(dirname(path), imp[1]))));
      else if (line !== "" && !line.startsWith("#")) out.push(line.replace(/^([-*]|\d+\.)\s+/, ""));
    }
    return out;
  };
  const lines: string[] = [];
  for (const p of paths) lines.push(...(await read(resolve(p))));
  return lines;
}

const template = (text: string) => {
  const t = text.trim().replace(/^(no|nope)[,.!]*\s+|^don'?t do that[,.!]*\s+/i, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function toSuggestions(groups: Group[], ruleLines: string[]): Suggestion[] {
  const ruleToks = ruleLines.map((l) => tokens(normalize(l)));
  const repToks = groups.map((g) => tokens(g.representative.norm));
  const w = idf([...ruleToks, ...repToks]);
  return groups.map((g, gi) => {
    let best = -1, bestSim = 0;
    const negated = isNegated(g.representative.text);
    ruleToks.forEach((rt, ri) => {
      if (isNegated(ruleLines[ri]) !== negated) return; // "Use npm" doesn't cover "don't use npm"
      const s = similarity(repToks[gi], rt, w);
      if (s > bestSim) [best, bestSim] = [ri, s];
    });
    const ignored = best >= 0 && bestSim >= RULE_MATCH;
    return Suggestion.parse({
      id: g.id,
      text: template(g.representative.text),
      status: ignored ? "ignored" : "new",
      ...(ignored ? { matchedRule: ruleLines[best] } : {}),
      count: g.count,
      sessions: g.sessions,
      projects: g.projects,
      days: g.days,
      score: g.score,
      lastSeen: g.lastSeen,
      examples: [...new Set(g.members.map((m) => m.text.trim()))].slice(0, 3),
      signals: g.signals,
    });
  });
}
