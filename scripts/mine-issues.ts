// Mines data/issues-*.json (from scripts/fetch-issues.sh) into results/groups.json and results/top-groups.md.
// Usage: pnpm mine [threshold, default 0.5]
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { loadIssues } from "../src/issues.js";
import { mineGroups, renderTopGroups } from "../src/mine.js";

const files = ["data/issues-area:model.json", "data/issues-data-loss.json"];
const threshold = Number(process.argv[2] ?? 0.5);
if (!(threshold > 0 && threshold <= 1)) {
  console.error(`threshold must be a number in (0, 1], got ${JSON.stringify(process.argv[2])}`);
  process.exit(1);
}
const TOP = 100;

const writeAtomic = (path: string, text: string) => {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
};

const t0 = Date.now();
const issues = loadIssues(files);
const groups = mineGroups(issues, threshold);
const ms = Date.now() - t0;
const fetched = readFileSync("data/fetched-at.txt", "utf8").trim(); // written by scripts/fetch-issues.sh
const grouped = groups.reduce((s, g) => s + g.issues, 0);

mkdirSync("results", { recursive: true });
writeAtomic("results/groups.json", JSON.stringify(groups, null, 2) + "\n");
writeAtomic(
  "results/top-groups.md",
  `# Top ${TOP} groups\n\n` +
    `Issues in \`anthropics/claude-code\` labelled \`area:model\` or \`data-loss\`, fetched ${fetched}: ${issues.length} ` +
    `after dropping pull requests, \`duplicate\`/\`invalid\` and withdrawn issues; ${grouped} with words left after cleaning the title. ` +
    `Grouped by title similarity ≥ ${threshold}; weight = Σ(1 + reactions).\n\n` +
    renderTopGroups(groups, TOP),
);
console.log(`${issues.length} issues → ${groups.length} groups (threshold ${threshold}) in ${ms} ms`);
