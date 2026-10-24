import { describe, expect, it } from "vitest";
import { normalize, tokens } from "../src/normalize.js";

describe("normalize", () => {
  it("replaces paths and numbers", () => {
    expect(normalize("Don't edit src/db/0012_users.ts at 3pm")).toBe("don't edit <file> at <n>pm");
  });
  it("replaces urls, file names and ids", () => {
    expect(normalize("see https://x.io/a")).toContain("<url>");
    expect(normalize("Fix  README.md\n now")).toBe("fix <file> now");
    expect(normalize("commit 3f2a9c1e and 123e4567-e89b-12d3-a456-426614174000")).toBe("commit <id> and <id>");
  });
});

describe("tokens", () => {
  it("keeps non-English letters and drops stopwords", () => {
    const t = tokens(normalize("npm 말고 pnpm 써"));
    expect(t).toContain("pnpm");
    expect(t).toContain("말고");
    expect(tokens(normalize("use the pnpm, not npm"))).toEqual(["use", "pnpm", "npm"]);
  });
});

describe("normalize regressions", () => {
  it("doesn't treat abbreviations or versions as file names", () => {
    expect(normalize("e.g. use node 24.x")).not.toContain("<file>");
  });
  it("keeps placeholders apart from real words", () => {
    expect(tokens(normalize("edit config.json"))).toEqual(["edit", "<file>"]);
    expect(tokens(normalize("don't touch that file"))).toEqual(["touch", "file"]);
  });
});
