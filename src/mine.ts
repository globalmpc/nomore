import { z } from "zod";
import { groupItems } from "./group.js";
import { cleanTitle, type Issue } from "./issues.js";
import { normalize, tokens } from "./normalize.js";

export const IssueGroup = z.object({
  id: z.string(),
  weight: z.number(),
  issues: z.number(),
  reactions: z.number(),
  representative: z.object({ id: z.string(), title: z.string(), url: z.string() }),
  top: z.array(z.object({ id: z.string(), title: z.string(), url: z.string(), reactions: z.number(), state: z.string() })).max(5),
});
export type IssueGroup = z.infer<typeof IssueGroup>;

// Spec › Part 0: titles join at ≥ 0.5; weight = Σ(1 + reactions); ranked by weight, ties by group id.
export function mineGroups(issues: Issue[], threshold = 0.5): IssueGroup[] {
  return groupItems(issues, (i) => tokens(normalize(cleanTitle(i.title))), threshold)
    .map((g) =>
      IssueGroup.parse({
        id: g.id,
        weight: g.members.reduce((s, i) => s + 1 + i.reactions, 0),
        issues: g.members.length,
        reactions: g.members.reduce((s, i) => s + i.reactions, 0),
        representative: { id: g.representative.id, title: cleanTitle(g.representative.title), url: g.representative.url },
        top: [...g.members]
          .sort((a, b) => b.reactions - a.reactions || Number(a.id) - Number(b.id))
          .slice(0, 5)
          .map((i) => ({ id: i.id, title: i.title, url: i.url, reactions: i.reactions, state: i.state })),
      }),
    )
    .sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Titles are untrusted: escape markdown and HTML punctuation so they render as plain link text.
const text = (s: string) => s.replace(/\s+/g, " ").replace(/[\\`*_[\]()<>#!|~]/g, "\\$&");

export function renderTopGroups(gs: IssueGroup[], n: number): string {
  const rows = gs.slice(0, n).map((g, i) => {
    const links = g.top.slice(0, 3).map((t) => `[#${t.id}](${t.url})`).join(" ");
    return `| ${i + 1} | ${g.weight} | ${g.issues} | ${g.reactions} | [${text(g.representative.title)}](${g.representative.url}) | ${links} |`;
  });
  return ["| # | Weight | Issues | Reactions | Representative title | Top issues |", "|---|---|---|---|---|---|", ...rows, ""].join("\n");
}
