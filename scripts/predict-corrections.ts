// Prints {"id": <message uuid>, "label": "correction" | "not"} for every typed user message, for evals/score.py.
// Usage: CLAUDE_CONFIG_DIR=... pnpm tsx scripts/predict-corrections.ts [days, default 30] > out/predictions.jsonl
import { homedir } from "node:os";
import { detectCorrections } from "../src/detect.js";
import { listSessionFiles, parseSession, resolveConfigDir } from "../src/sessions.js";

const days = Number(process.argv[2] ?? 30);
for (const f of await listSessionFiles(resolveConfigDir(process.env, homedir()), { sinceMs: Date.now() - days * 86_400_000 })) {
  const { events } = await parseSession(f);
  const hits = new Set(detectCorrections(events).map((c) => c.uuid));
  for (const e of events) if (e.kind === "user_text") console.log(JSON.stringify({ id: e.uuid, label: hits.has(e.uuid) ? "correction" : "not" }));
}
