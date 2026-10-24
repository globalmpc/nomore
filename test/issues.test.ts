import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTitle, loadIssues } from "../src/issues.js";
import { normalize, tokens } from "../src/normalize.js";

const fixture = "test/fixtures/issues.json";

describe("loadIssues", () => {
  it("drops pull requests, duplicate and invalid issues", () => {
    const ids = loadIssues([fixture]).map((i) => i.id);
    expect(ids).toEqual(["101", "102", "103", "104", "105", "106"]);
  });

  it("drops issues withdrawn by their author, and only those", () => {
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    const f = join(dir, "w.json");
    const raw = (number: number, title: string) => ({ number, title, html_url: `u/${number}`, created_at: "t", labels: [], state: "open" });
    const dropped = ["Withdrawn by the author", "[withdrawn]", "(withdrawn)", "[Bug] (withdrawn)", "[Model] (withdrawn)",
      "[Withdrawn — filed in error]", "[withdrawn] filed in error — deletion requested", "[withdrawn by author]", "Withdrawn"];
    const kept = ["Possible: resume may apply the default; withdrawn later", "Withdrawn API key still used by Claude",
      "모델 withdrawn 상태 무시", "Model ignores rules"];
    writeFileSync(f, JSON.stringify([...dropped, ...kept].map((t, i) => raw(i + 1, t))));
    expect(loadIssues([f]).map((i) => i.title)).toEqual(kept);
    rmSync(dir, { recursive: true });
  });

  it("checks exclusions against the labels from every copy of an issue", () => {
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    const raw = (labels: string[]) => [{ number: 1, title: "Ignores rules", html_url: "u/1", created_at: "t", state: "open", labels: labels.map((name) => ({ name })) }];
    writeFileSync(join(dir, "a.json"), JSON.stringify(raw(["area:model"])));
    writeFileSync(join(dir, "b.json"), JSON.stringify(raw(["data-loss", "duplicate"])));
    expect(loadIssues([join(dir, "a.json"), join(dir, "b.json")])).toEqual([]);
    rmSync(dir, { recursive: true });
  });

  it("counts an issue fetched under two labels once", () => {
    expect(loadIssues([fixture, fixture])).toHaveLength(6);
  });

  it("maps the fields it needs", () => {
    expect(loadIssues([fixture])[0]).toEqual({
      id: "101",
      title: "[BUG] Claude ignores CLAUDE.md instructions",
      url: "https://github.com/anthropics/claude-code/issues/101",
      reactions: 12,
      ts: "2026-09-01T10:00:00Z",
      labels: ["bug", "area:model"],
      state: "open",
    });
    expect(loadIssues([fixture]).find((i) => i.id === "103")!.state).toBe("completed");
  });

  it("loads a Korean title with words left after cleaning", () => {
    const korean = loadIssues([fixture]).find((i) => i.id === "105")!;
    expect(tokens(normalize(cleanTitle(korean.title)))).not.toHaveLength(0);
  });

  it("names the file it can't read", () => {
    expect(() => loadIssues(["/missing.json"])).toThrow("/missing.json");
    const dir = mkdtempSync(join(tmpdir(), "nomore-"));
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "[{");
    expect(() => loadIssues([bad])).toThrow(bad);
    rmSync(dir, { recursive: true });
  });
});

describe("cleanTitle", () => {
  it("removes leading bracket tags", () => {
    expect(cleanTitle("[BUG] [MODEL] Claude ignores CLAUDE.md")).toBe("Claude ignores CLAUDE.md");
    expect(cleanTitle("[BUG][MODEL]Claude ignores CLAUDE.md ")).toBe("Claude ignores CLAUDE.md");
    expect(cleanTitle("Uses [x] in the middle")).toBe("Uses [x] in the middle");
    expect(cleanTitle("")).toBe("");
  });

  it("keeps a title written entirely inside brackets", () => {
    const t = "[Bug Report: Model performance degradation impacting usability]";
    expect(cleanTitle(t)).toBe(t);
    expect(cleanTitle("[Feature Request] Remember my corrections")).toBe("Remember my corrections");
  });
});

// The fetch script is a bash dev tool (data mining), not part of `npx nomore`; its fake `gh` needs a Unix PATH.
describe.skipIf(process.platform === "win32")("scripts/fetch-issues.sh", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "nomore-"));
    dirs.push(d);
    return d;
  };
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  // A fake `gh` on PATH: serves <dir>/page-N.json, logs each URL, and fails like a rate limit when the page is missing.
  const run = (pages: Record<number, unknown>, opts: { cwd?: string; out?: string } = {}) => {
    const dir = tmp();
    for (const [n, body] of Object.entries(pages)) writeFileSync(join(dir, `page-${n}.json`), JSON.stringify(body));
    writeFileSync(join(dir, "gh"), `#!/usr/bin/env bash
url="\${@: -1}"; echo "$url" >> "${dir}/urls"
f="${dir}/page-\${url##*&page=}.json"
if [ -f "$f" ]; then cat "$f"; else echo "HTTP 403: API rate limit exceeded" >&2; exit 1; fi
`);
    chmodSync(join(dir, "gh"), 0o755);
    const out = opts.out ?? join(dir, "data");
    const res = spawnSync("bash", [join(process.cwd(), "scripts/fetch-issues.sh"), out], {
      cwd: opts.cwd ?? process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    const urls = existsSync(join(dir, "urls")) ? readFileSync(join(dir, "urls"), "utf8").trim().split("\n") : [];
    return { res, out, urls };
  };
  const full = Array.from({ length: 100 }, (_, i) => ({ number: i }));
  const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));

  it("joins pages in order and stops at a short page, oldest issues first", () => {
    const pages: Record<number, unknown> = { 1: full };
    for (let n = 2; n <= 10; n++) pages[n] = full.map((x) => ({ number: x.number + 100 * (n - 1) }));
    pages[11] = [{ number: 1000 }];
    const { res, out, urls } = run(pages);
    expect(res.status).toBe(0);
    const issues = read(join(out, "issues-area:model.json"));
    expect(issues.map((x: { number: number }) => x.number)).toEqual(Array.from({ length: 1001 }, (_, i) => i));
    expect(urls).toHaveLength(22); // 11 pages per label, no extra empty page
    expect(urls[0]).toContain("sort=created&direction=asc");
    expect(readFileSync(join(out, "fetched-at.txt"), "utf8")).toMatch(/^\d{4}-\d{2}-\d{2}\n$/);
  });

  it("fails loudly with the label and page, keeps the old file and leaves nothing behind", () => {
    const out = join(tmp(), "data");
    mkdirSync(out);
    writeFileSync(join(out, "issues-area:model.json"), "old");
    const { res } = run({ 1: full }, { out });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("area:model");
    expect(res.stderr).toContain("page 2");
    expect(readFileSync(join(out, "issues-area:model.json"), "utf8")).toBe("old");
    expect(readdirSync(out)).toEqual(["issues-area:model.json"]);
  });

  it("fails loudly on a page that isn't a JSON array instead of looping", () => {
    const { res } = run({ 1: { message: "Bad credentials" } });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("not a JSON array");
  });

  it("resolves a relative output folder from where it was run", () => {
    const cwd = tmp();
    const { res } = run({ 1: [{ number: 1 }] }, { cwd, out: "rel" });
    expect(res.status).toBe(0);
    expect(existsSync(join(cwd, "rel", "issues-data-loss.json"))).toBe(true);
  });
});
