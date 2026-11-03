// Mines data/issues-*.json (from scripts/fetch-issues.sh) into results/groups.json and results/top-groups.md.
// Usage: pnpm mine [--agent claude|codex] [threshold, default 0.5]; codex reads data/codex/ and writes results/codex-*.
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { loadIssues } from "../src/issues.js";
import { mineGroups, renderTopGroups } from "../src/mine.js";

const args = process.argv.slice(2);
const i = args.indexOf("--agent");
const agent = i < 0 ? "claude" : args.splice(i, 2)[1];
if (agent !== "claude" && agent !== "codex") {
  console.error("usage: mine-issues.ts [--agent claude|codex] [threshold]");
  process.exit(1);
}
const codex = agent === "codex";
const dir = codex ? "data/codex" : "data";
// Claude: the two files as before. Codex: every issues-<label>.json that scripts/fetch-issues.sh --agent codex wrote, so the label list lives only there.
const files = codex
  ? readdirSync(dir).filter((f) => /^issues-.+\.json$/.test(f)).sort().map((f) => `${dir}/${f}`)
  : [`${dir}/issues-area:model.json`, `${dir}/issues-data-loss.json`];
if (files.length === 0) {
  console.error(`no ${dir}/issues-*.json found; run: bash scripts/fetch-issues.sh --agent ${agent}`);
  process.exit(1);
}
const prefix = codex ? "codex-" : "";
const labelsUsed = files.map((f) => `\`${f.slice(`${dir}/issues-`.length, -".json".length)}\``);
const what = codex ? `\`openai/codex\` labelled ${labelsUsed.join(", ")}` : "`anthropics/claude-code` labelled `area:model` or `data-loss`";
const threshold = Number(args[0] ?? 0.5);
if (!(threshold > 0 && threshold <= 1)) {
  console.error(`threshold must be a number in (0, 1], got ${JSON.stringify(args[0])}`);
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
const fetched = readFileSync(`${dir}/fetched-at.txt`, "utf8").trim(); // written by scripts/fetch-issues.sh
const grouped = groups.reduce((s, g) => s + g.issues, 0);

mkdirSync("results", { recursive: true });
writeAtomic(`results/${prefix}groups.json`, JSON.stringify(groups, null, 2) + "\n");
writeAtomic(
  `results/${prefix}top-groups.md`,
  `# Top ${TOP} groups\n\n` +
    `Issues in ${what}, fetched ${fetched}: ${issues.length} ` +
    `after dropping pull requests, \`duplicate\`/\`invalid\` and withdrawn issues; ${grouped} with words left after cleaning the title. ` +
    `Grouped by title similarity ≥ ${threshold}; weight = Σ(1 + reactions).\n\n` +
    renderTopGroups(groups, TOP),
);
console.log(`${issues.length} issues → ${groups.length} groups (threshold ${threshold}) in ${ms} ms`);
