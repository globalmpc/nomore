import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyRules, recordAdoption } from "../src/apply.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "nomore-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const read = (f: string) => readFileSync(f, "utf8");

describe("applyRules", () => {
  it("creates the file and heading, and never adds a rule twice", async () => {
    const f = join(tmp(), "CLAUDE.md");
    expect(await applyRules(f, ["Use pnpm"])).toEqual({ added: ["Use pnpm"], skipped: [] });
    expect(await applyRules(f, ["Use pnpm"])).toEqual({ added: [], skipped: ["Use pnpm"] });
    expect(read(f)).toBe("## nomore rules\n\n- Use pnpm\n");
  });

  it("keeps existing content byte for byte, even without a final newline", async () => {
    const f = join(tmp(), "CLAUDE.md");
    writeFileSync(f, "# Mine\n- old");
    await applyRules(f, ["Use pnpm"]);
    expect(read(f)).toBe("# Mine\n- old\n\n## nomore rules\n\n- Use pnpm\n");
  });

  it("adds to the end of an existing nomore section, before the next section", async () => {
    const f = join(tmp(), "CLAUDE.md");
    writeFileSync(f, "## nomore rules\n\n- A\n\n## Other\n- x\n");
    await applyRules(f, ["B"]);
    expect(read(f)).toBe("## nomore rules\n\n- A\n- B\n\n## Other\n- x\n");
  });

  it("skips a rule already written anywhere in the file, and keeps Windows line endings", async () => {
    const f = join(tmp(), "CLAUDE.md");
    writeFileSync(f, "# Mine\r\n- Use pnpm\r\n");
    expect(await applyRules(f, ["Use pnpm", "Ask before pushing"])).toEqual({ added: ["Ask before pushing"], skipped: ["Use pnpm"] });
    expect(read(f)).toBe("# Mine\r\n- Use pnpm\r\n\r\n## nomore rules\r\n\r\n- Ask before pushing\r\n");
  });
});

describe("recordAdoption", () => {
  it("appends one entry per adopted rule", async () => {
    const dir = tmp();
    await recordAdoption(dir, { groupId: "g1", text: "Use pnpm", target: "/t/CLAUDE.md" }, "2026-10-23T00:00:00Z");
    await recordAdoption(dir, { groupId: "g2", text: "Ask first", target: "/t/CLAUDE.md" }, "2026-10-23T00:00:01Z");
    const log = JSON.parse(read(join(dir, "nomore", "adopted.json")));
    expect(log).toEqual([
      { groupId: "g1", text: "Use pnpm", target: "/t/CLAUDE.md", adoptedAt: "2026-10-23T00:00:00Z" },
      { groupId: "g2", text: "Ask first", target: "/t/CLAUDE.md", adoptedAt: "2026-10-23T00:00:01Z" },
    ]);
  });
});

describe("cli --apply", () => {
  // A temporary copy of the fixture config folder, so the test writes its CLAUDE.md, not the repo's.
  const run = (args: string[], input: string) => {
    const config = tmp();
    cpSync("test/fixtures/projects", join(config, "projects"), { recursive: true });
    const res = spawnSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "src/cli.ts", ...args], {
      encoding: "utf8",
      input,
      env: { ...process.env, CLAUDE_CONFIG_DIR: config },
    });
    return { res, config };
  };
  const first = () => {
    const { res } = run(["--json"], "");
    return JSON.parse(res.stdout).suggestions[0].text as string;
  };

  it("adds the rules you choose and records them", () => {
    const { res, config } = run(["--apply"], "y\nq\n");
    expect(res.status).toBe(0);
    expect(read(join(config, "CLAUDE.md"))).toBe(`## nomore rules\n\n- ${first()}\n`);
    expect(JSON.parse(read(join(config, "nomore", "adopted.json")))).toHaveLength(1);
    expect(res.stdout).toContain("1 rule added");
  });

  it("lets you type your own wording", () => {
    const { config } = run(["--apply"], "e\nAlways use pnpm, never npm\nq\n");
    expect(read(join(config, "CLAUDE.md"))).toBe("## nomore rules\n\n- Always use pnpm, never npm\n");
  });

  it("writes nothing when you quit or skip everything", () => {
    const { res, config } = run(["--apply"], "n\nq\n");
    expect(res.status).toBe(0);
    expect(existsSync(join(config, "CLAUDE.md"))).toBe(false);
    expect(res.stdout).toContain("No rules added");
  });

  it("can't be combined with --json or --card", () => {
    expect(run(["--apply", "--json"], "").res.status).not.toBe(0);
  });
});

describe.skipIf(process.platform === "win32")("file permissions", () => {
  it("keeps a private CLAUDE.md private and creates the adoption log owner-only", async () => {
    const { chmodSync, statSync } = await import("node:fs");
    const dir = tmp();
    const f = join(dir, "CLAUDE.md");
    writeFileSync(f, "# Mine\n");
    chmodSync(f, 0o600);
    await applyRules(f, ["Use pnpm"]);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    await recordAdoption(dir, { groupId: "g", text: "Use pnpm", target: f }, "2026-10-24T00:00:00Z");
    expect(statSync(join(dir, "nomore", "adopted.json")).mode & 0o777).toBe(0o600);
  });
});

describe.skipIf(process.platform === "win32")("review round 2: symlinks, log mode, sub-headings", () => {
  it("doesn't follow a symlink planted at a predictable temp path", async () => {
    const { symlinkSync } = await import("node:fs");
    const dir = tmp();
    const f = join(dir, "CLAUDE.md");
    const victim = join(dir, "victim.txt");
    writeFileSync(f, "# Mine\n");
    writeFileSync(victim, "keep me");
    symlinkSync(victim, `${f}.nomore-${process.pid}.tmp`);
    await applyRules(f, ["Use pnpm"]);
    expect(read(victim)).toBe("keep me");
    expect(read(f)).toContain("- Use pnpm");
  });

  it("updates the file a CLAUDE.md symlink points to and keeps the link", async () => {
    const { symlinkSync, lstatSync } = await import("node:fs");
    const dir = tmp();
    const shared = join(dir, "shared.md");
    const link = join(dir, "CLAUDE.md");
    writeFileSync(shared, "# Shared\n");
    symlinkSync(shared, link);
    await applyRules(link, ["Use pnpm"]);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(read(shared)).toContain("- Use pnpm");
  });

  it("makes an existing adoption log owner-only", async () => {
    const { chmodSync, mkdirSync, statSync } = await import("node:fs");
    const dir = tmp();
    mkdirSync(join(dir, "nomore"));
    writeFileSync(join(dir, "nomore", "adopted.json"), "[]\n");
    chmodSync(join(dir, "nomore", "adopted.json"), 0o644);
    await recordAdoption(dir, { groupId: "g", text: "Use pnpm", target: "/t" }, "2026-10-24T00:00:00Z");
    expect(statSync(join(dir, "nomore", "adopted.json")).mode & 0o777).toBe(0o600);
  });
});

describe("applyRules: any heading level ends the section", () => {
  it("inserts before a ### subsection", async () => {
    const f = join(tmp(), "CLAUDE.md");
    writeFileSync(f, "## nomore rules\n\n- A\n\n### Sub\n- x\n");
    await applyRules(f, ["B"]);
    expect(read(f)).toBe("## nomore rules\n\n- A\n- B\n\n### Sub\n- x\n");
  });
});
