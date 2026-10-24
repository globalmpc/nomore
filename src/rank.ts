import type { Group } from "./types.js";

const DAY_MS = 86_400_000;
const HALF_LIFE_DAYS = 14;

// Tasks repeat more often than preferences; a preference word in any clause triples a group's score. Korean has no
// \b word boundaries, so its words are matched as plain substrings.
const PREFERENCE = /\b(never|don'?t|do not|without|instead|always|only|stop|avoid|prefer|myself|too|selalu|jangan|tanpa|hanya|terlalu)\b|지 ?마|말고|없이|항상|절대|금지|대신|너무/i;
const BOOST = 3;

// Spec › Ranking: score = count × sessions × 0.5^(days since last / 14) × boost; shown if sessions ≥ 2.
export function rankGroups(gs: Omit<Group, "score">[], nowMs: number): Group[] {
  return gs
    .filter((g) => g.sessions >= 2)
    .map((g) => ({
      ...g,
      signals: g.sessions >= 3 && !g.signals.includes("repeated") ? [...g.signals, "repeated" as const] : g.signals,
      score:
        g.count * g.sessions * 0.5 ** ((nowMs - Date.parse(g.lastSeen)) / DAY_MS / HALF_LIFE_DAYS) *
        (g.members.some((m) => PREFERENCE.test(m.text)) ? BOOST : 1),
    }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
