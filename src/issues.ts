import { readFileSync } from "node:fs";
import { z } from "zod";

export const Issue = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  reactions: z.number(),
  ts: z.string(),
  labels: z.array(z.string()),
  state: z.string(), // "open", or the close reason: "completed", "not_planned", …
});
export type Issue = z.infer<typeof Issue>;

// Only the fields we use; the body is never read.
const RawIssue = z.object({
  number: z.number(),
  title: z.string().nullable(),
  html_url: z.string(),
  created_at: z.string(),
  labels: z.array(z.object({ name: z.string() })),
  reactions: z.object({ total_count: z.number() }).optional(),
  pull_request: z.unknown().optional(),
  state: z.string(),
  state_reason: z.string().nullable().optional(),
});

const EXCLUDED = new Set(["duplicate", "invalid"]);
// The whole title is a retraction: "Withdrawn by the author", "[withdrawn]", "[Bug] (withdrawn)",
// "[withdrawn] filed in error". A title that merely starts with the word ("Withdrawn API key …") is kept.
const WITHDRAWN =
  /^\s*(?:\[[^\]]{0,30}\]\s*)?[\s\p{P}]*withdrawn(?:[\s\p{P}]+(?:by (?:the )?author|filed in error)\b.*)?[\s\p{P}]*$/iu;

export function loadIssues(files: string[]): Issue[] {
  // First copy of each issue, with the labels of every copy, so an exclusion label in any file counts.
  const byNumber = new Map<number, { r: z.infer<typeof RawIssue>; labels: Set<string> }>();
  for (const file of files) {
    let raw: z.infer<typeof RawIssue>[];
    try {
      raw = z.array(RawIssue).parse(JSON.parse(readFileSync(file, "utf8")));
    } catch (e) {
      throw new Error(`can't load issues from ${file}: ${(e as Error).message}`);
    }
    for (const r of raw) {
      const seen = byNumber.get(r.number) ?? byNumber.set(r.number, { r, labels: new Set() }).get(r.number)!;
      r.labels.forEach((l) => seen.labels.add(l.name));
    }
  }
  return [...byNumber.keys()]
    .sort((a, b) => a - b)
    .map((n) => byNumber.get(n)!)
    .filter(({ r, labels }) => r.pull_request === undefined && ![...labels].some((l) => EXCLUDED.has(l)) && !WITHDRAWN.test(r.title ?? ""))
    .map(({ r, labels }) =>
      Issue.parse({
        id: String(r.number),
        title: r.title ?? "",
        url: r.html_url,
        reactions: r.reactions?.total_count ?? 0,
        ts: r.created_at,
        labels: [...labels],
        state: r.state === "open" ? "open" : (r.state_reason ?? r.state),
      }),
    );
}

// Strips short leading tags ("[BUG]", "[Feature Request]"); a title written entirely in brackets is kept.
export const cleanTitle = (title: string) => title.replace(/^(\s*\[[^\]]{0,30}\])+/, "").trim();
