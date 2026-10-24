// Writes evals/candidates.jsonl (git-ignored: contains message text) with a fixed sample of real user messages for
// labelling: 25 that detection flags and 15 it doesn't, shuffled so the labeller can't tell which is which.
// Usage: CLAUDE_CONFIG_DIR=... pnpm tsx scripts/sample-candidates.ts [days, default 30]
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { detectCorrections } from "../src/detect.js";
import { listSessionFiles, parseSession, resolveConfigDir } from "../src/sessions.js";

const days = Number(process.argv[2] ?? 30);
const files = await listSessionFiles(resolveConfigDir(process.env, homedir()), { sinceMs: Date.now() - days * 86_400_000 });
const flagged: { id: string; text: string }[] = [];
const other: { id: string; text: string }[] = [];
for (const f of files) {
  const { events } = await parseSession(f);
  const hits = new Set(detectCorrections(events).map((c) => c.uuid));
  for (const e of events) if (e.kind === "user_text") (hits.has(e.uuid) ? flagged : other).push({ id: e.uuid, text: e.text ?? "" });
}
const hash = (s: string) => createHash("sha1").update(s).digest("hex");
const pick = (xs: typeof flagged, n: number) => [...xs].sort((a, b) => (hash(a.id) < hash(b.id) ? -1 : 1)).slice(0, n);
const sample = [...pick(flagged, 25), ...pick(other, 15)].sort((a, b) => (hash("x" + a.id) < hash("x" + b.id) ? -1 : 1));
writeFileSync("evals/candidates.jsonl", sample.map((s) => JSON.stringify({ ...s, label: "" })).join("\n") + "\n");
console.log(`${flagged.length} flagged, ${other.length} other typed messages → ${sample.length} candidates in evals/candidates.jsonl`);
