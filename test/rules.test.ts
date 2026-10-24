import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalize } from "../src/normalize.js";
import { readRuleLines, toSuggestions } from "../src/rules.js";
import type { Correction, Group } from "../src/types.js";

const c = (uuid: string, text: string): Correction => ({ uuid, sessionId: uuid, cwd: "/c", ts: "2026-10-22T00:00:00Z", text, norm: normalize(text), signals: ["phrase"] });
const group = (id: string, ...texts: string[]): Group => {
  const members = texts.map((t, i) => c(`${id}${i}`, t));
  return { id, members, representative: members[0], count: members.length, sessions: members.length, projects: 1, days: 1, lastSeen: "2026-10-22T00:00:00Z", score: 1, signals: ["phrase"] };
};

describe("readRuleLines", () => {
  it("reads bullets and sentences, skipping headings, blanks and missing files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    writeFileSync(join(dir, "CLAUDE.md"), "# Rules\n\n- Always use pnpm, never npm\n* Ask before committing\n1. Run tests\nPlain sentence.\n");
    expect(await readRuleLines([join(dir, "CLAUDE.md"), "/missing.md"])).toEqual(["Always use pnpm, never npm", "Ask before committing", "Run tests", "Plain sentence."]);
    rmSync(dir, { recursive: true });
  });
});

describe("readRuleLines: imports", () => {
  it("follows @file imports (relative and ~/), skips missing ones and doesn't loop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    writeFileSync(join(dir, "CLAUDE.md"), "# Rules\n@nomore-rules.md\n@missing.md\n- Own rule\n");
    writeFileSync(join(dir, "nomore-rules.md"), "## nomore rules\n\n- Always use pnpm, never npm\n@CLAUDE.md\n");
    expect(await readRuleLines([join(dir, "CLAUDE.md")])).toEqual(["Always use pnpm, never npm", "Own rule"]);
    rmSync(dir, { recursive: true });
  });
});

describe("toSuggestions", () => {
  it("marks a group covered by an existing rule as ignored, others as new", () => {
    const [pnpm, commit] = toSuggestions(
      [group("p", "no, use pnpm not npm", "use pnpm, not npm", "i said use pnpm"), group("k", "don't commit yet")],
      ["Always use pnpm, never npm", "Write tests first"],
    );
    expect(pnpm).toMatchObject({ status: "ignored", matchedRule: "Always use pnpm, never npm", text: "Use pnpm not npm" });
    expect(pnpm.examples).toHaveLength(3);
    expect(commit.status).toBe("new");
    expect(commit.matchedRule).toBeUndefined();
  });
});

describe("toSuggestions: polarity", () => {
  it("doesn't treat an existing rule as covering its opposite", () => {
    const [s] = toSuggestions([group("n", "don't use npm", "don't use npm here")], ["Use npm"]);
    expect(s.status).toBe("new");
  });
});
