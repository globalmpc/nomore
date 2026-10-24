import type { Report, Suggestion } from "./types.js";

// The public repo; change to the org's repo at handover (README's install link too).
export const REPO_URL = "https://github.com/globalmpc/nomore";
export const NOTHING_YET = `No instructions repeated across sessions yet.\nMeanwhile, start with the 20-rule pack: ${REPO_URL}/blob/master/rules/CLAUDE.md`;

const line = (s: Suggestion) =>
  `● ${s.text}\n  ${s.count}× in ${s.sessions} sessions, last ${s.lastSeen.slice(0, 10)}\n` +
  s.examples.map((e) => `  “${e.length > 80 ? e.slice(0, 79) + "…" : e}”`).join("\n");

export function renderReport(r: Report): string {
  const head = `nomore · ${r.scannedSessions} sessions · ${r.corrections} instructions` + (r.skippedLines ? ` · ${r.skippedLines} unreadable lines skipped` : "");
  const fresh = r.suggestions.filter((s) => s.status === "new");
  const ignored = r.suggestions.filter((s) => s.status === "ignored");
  if (r.suggestions.length === 0) return `${head}\n\n${NOTHING_YET}\n`;
  return [
    head,
    ...(fresh.length ? ["", "Repeated instructions", "", ...fresh.map(line)] : []),
    ...(ignored.length ? ["", "Rules you have, but the agent ignores", "", ...ignored.map((s) => `${line(s)}\n  rule: ${s.matchedRule}`)] : []),
    "",
  ].join("\n");
}

// Safe to share: totals only. Suggestion text can hold private words, so it never appears here.
export function renderCard(r: Report): string {
  return `nomore: ${r.scannedSessions} sessions, ${r.corrections} instructions, ${r.suggestions.length} repeated.\n`;
}
