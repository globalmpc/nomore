import { describe, expect, it } from "vitest";
import { Suggestion } from "../src/types.js";

const ok = { id: "abcd1234", text: "Use pnpm", status: "new", count: 3, sessions: 3, projects: 2, days: 3, score: 9, lastSeen: "2026-10-22T00:00:00Z", examples: ["use pnpm"], signals: ["phrase"] };

describe("Suggestion", () => {
  it("accepts a valid suggestion", () => expect(Suggestion.parse(ok)).toEqual(ok));
  it("rejects an unknown status", () => expect(() => Suggestion.parse({ ...ok, status: "maybe" })).toThrow());
  it("requires projects, days and score", () => expect(() => Suggestion.parse({ ...ok, projects: undefined })).toThrow());
  it("rejects more than 3 examples", () => expect(() => Suggestion.parse({ ...ok, examples: ["a", "b", "c", "d"] })).toThrow());
});
