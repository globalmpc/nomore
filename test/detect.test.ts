import { describe, expect, it } from "vitest";
import { clauseTokens, detectCorrections, extractInstructions } from "../src/detect.js";
import { parseSession } from "../src/sessions.js";
import type { Event } from "../src/types.js";

let n = 0;
const ev = (kind: Event["kind"], extra: Partial<Event> = {}): Event => ({ kind, uuid: `e${n++}`, sessionId: "s", cwd: "/c", ts: `2026-10-22T00:00:${String(n % 60).padStart(2, "0")}Z`, ...extra });
const say = (text: string) => ev("user_text", { text });
const asst = () => ev("assistant_text", { text: "ok" });
const edit = (old_string: string, new_string: string) => ev("assistant_tool_use", { tool: "Edit", input: { file_path: "a.ts", old_string, new_string } });

describe("detectCorrections", () => {
  it("merges a rejection and an interrupt into one correction with the typed reason", async () => {
    const { events } = await parseSession("test/fixtures/projects/-tmp-demo/s1.jsonl");
    const cs = detectCorrections(events);
    expect(cs).toHaveLength(1);
    expect(cs[0].text).toBe("use pnpm, not npm");
    expect(cs[0].signals.sort()).toEqual(["interrupt", "rejected"]);
  });

  it("flags short correction phrases right after the assistant", () => {
    expect(detectCorrections([asst(), say("no, keep the old name")])[0].signals).toEqual(["phrase"]);
    expect(detectCorrections([asst(), say("no " + "x".repeat(398))])).toEqual([]);
    expect(detectCorrections([say("first"), say("no, keep the old name")])).toEqual([]);
  });

  it("catches a Korean correction through a rejection", async () => {
    const { events } = await parseSession("test/fixtures/projects/-tmp-demo/s3.jsonl");
    const korean = detectCorrections(events).find((c) => c.text === "npm 말고 pnpm 써");
    expect(korean?.signals).toEqual(["rejected"]);
  });

  it("marks the message before an edit that undoes an earlier edit as a revert", () => {
    const c = detectCorrections([edit("A", "B"), say("no, put it back"), edit("B", "A")]);
    expect(c).toHaveLength(1);
    expect(c[0].signals.sort()).toEqual(["phrase", "revert"]);
  });

  it("ignores plain requests", () => {
    expect(detectCorrections([asst(), say("add a login page")])).toEqual([]);
  });
});

describe("extractInstructions", () => {
  const texts = (...msgs: string[]) => extractInstructions(msgs.flatMap((m) => [asst(), say(m)])).map((c) => c.text);

  it("splits a message into clauses and keeps those with at least 2 words", () => {
    expect(texts("target branch is feature/x, never rename exported functions, it is fine")).toEqual([
      "target branch is feature/x",
      "never rename exported functions",
    ]);
  });

  it("drops acknowledgements, markdown and code lines, link-only clauses and long clauses", () => {
    expect(texts("yes go ahead", "okay lets start", "proceed with 2", "ok continue to step 4", "see e.g", "- Express server on :3000\n`npm run dev`", "see https://x.io/a https://y.io/b", "word ".repeat(30))).toEqual([]);
  });

  it("removes pasted content and tags", () => {
    const t = texts('before starting: <pasted_content id="x">use pnpm always</pasted_content> keep it short pls');
    expect(t.join(" ")).not.toContain("pnpm");
    expect(t).toContain("keep it short pls");
  });

  it("gives each clause a unique id and its message's signals", () => {
    const cs = extractInstructions([asst(), say("no, use pnpm. keep commits small")]);
    expect(cs.map((c) => c.text)).toEqual(["use pnpm", "keep commits small"]);
    expect(new Set(cs.map((c) => c.uuid)).size).toBe(2);
    expect(cs.every((c) => c.signals.includes("phrase"))).toBe(true);
  });
});

describe("extractInstructions: one-off requests and questions", () => {
  const texts = (...msgs: string[]) => extractInstructions(msgs.flatMap((m) => [asst(), say(m)])).map((c) => c.text);

  it("drops questions", () => {
    expect(texts("what do you think about it", "is this approach fine?", "how does grouping work")).toEqual([]);
  });

  it("drops clauses with a link", () => {
    expect(texts("check this out https://example.com/x later")).toEqual([]);
  });

  it("drops clauses that open like a one-off task request", () => {
    expect(texts("review the diff carefully", "update the api docs", "let me run the tests", "then we can discuss it", "and provide a summary")).toEqual([]);
  });

  it("keeps lasting preferences", () => {
    expect(texts("way too verbose, i will open releases myself")).toEqual(["way too verbose", "i will open releases myself"]);
  });
});

describe("clauseTokens", () => {
  it("treats singular and plural as the same word", () => {
    expect(clauseTokens("use plain names")).toEqual(clauseTokens("use plain name"));
    expect(clauseTokens("keep class names")).toContain("class");
  });
});

describe("extractInstructions: pasted code, diffs and logs", () => {
  const texts = (...msgs: string[]) => extractInstructions(msgs.flatMap((m) => [asst(), say(m)])).map((c) => c.text);

  it("drops code, diff and log lines, and headings", () => {
    expect(
      texts(
        "+import json\n+  return out\nfrom pathlib import Path\nimport json\nconst db = openDb()\nx = load(cfg)",
        "platform: 'web'\nState IN ('QUEUE','PUBLISHED')\nFirst_seen_at\nnew Date(now - 12 * H).toISOString()\nhookCode",
        "Error: request failed with status 429\nTraceback (most recent call last)\nAPI rate limit reached, retry later",
        "here is the diff:\nat parseArgs (src/cli.ts:12:3)\njoin} from 'node:path'\nAcceptance_criteria]",
      ),
    ).toEqual([]);
  });

  it("keeps plain-language preferences that resemble code words", () => {
    expect(texts("never push without asking", "keep answers short (two lines max)", "from now on use pnpm", "import the csv before running tests")).toEqual([
      "never push without asking",
      "keep answers short (two lines max)",
      "from now on use pnpm",
      "import the csv before running tests",
    ]);
  });
});

describe("extractInstructions: polite one-off requests and acknowledgements", () => {
  const texts = (...msgs: string[]) => extractInstructions(msgs.flatMap((m) => [asst(), say(m)])).map((c) => c.text);

  it("drops requests and acknowledgements behind filler words", () => {
    expect(
      texts("plz push it", "please fix this one", "yeah go on", "ok continue with the remaining part", "what's remaining",
        "whats next", "now retry", "just add it", "give me a short summary", "create me a release note", "do it again"),
    ).toEqual([]);
  });

  it("keeps preferences, even when they start with a task verb", () => {
    expect(
      texts("never push without asking", "run tests before saying done", "add tests for every change",
        "commit after each step", "implement one by one", "do not touch the lockfile"),
    ).toEqual([
      "never push without asking",
      "run tests before saying done",
      "add tests for every change",
      "commit after each step",
      "implement one by one",
      "do not touch the lockfile",
    ]);
  });
});

describe("extractInstructions: typed shell commands", () => {
  const texts = (...msgs: string[]) => extractInstructions(msgs.flatMap((m) => [asst(), say(m)])).map((c) => c.text);

  it("drops shell commands", () => {
    expect(texts("git pull", "npm install", "pnpm tsx src/cli.ts --card", "docker compose up -d", "cd ../web && ls")).toEqual([]);
  });

  it("keeps sentences that start with a command name", () => {
    expect(texts("git push only after review", "npm 말고 pnpm 써", "make it simpler")).toEqual([
      "git push only after review",
      "npm 말고 pnpm 써",
      "make it simpler",
    ]);
  });
});

describe("extractInstructions: Korean questions and requests", () => {
  const texts = (...msgs: string[]) => extractInstructions(msgs.flatMap((m) => [asst(), say(m)])).map((c) => c.text);

  it("drops Korean questions and one-off requests", () => {
    expect(
      texts("얼마나 남았어", "진행 상황 어때", "뭐가 문제야", "이거 왜 안 돼", "테스트 돌려줘", "커밋해 주세요", "같이 확인해보자", "이거 괜찮을까", "오늘 진행 상황 어때？"),
    ).toEqual([]);
  });

  it("keeps Korean preferences, even with a request ending", () => {
    expect(texts("npm 말고 pnpm 써", "표 없이 보고해줘", "디자인 중에는 결정 묻지 마", "앞으로 커밋은 내가 직접 할게", "자세히 설명해줘")).toEqual([
      "npm 말고 pnpm 써",
      "표 없이 보고해줘",
      "디자인 중에는 결정 묻지 마",
      "앞으로 커밋은 내가 직접 할게",
      "자세히 설명해줘",
    ]);
  });
});

describe("extractInstructions: Indonesian questions and requests", () => {
  const texts = (...msgs: string[]) => extractInstructions(msgs.flatMap((m) => [asst(), say(m)])).map((c) => c.text);

  it("drops Indonesian questions, requests and acknowledgements", () => {
    expect(texts("lanjutkan saja", "tolong cek lagi", "oke lanjut", "berapa lama lagi", "kenapa gagal", "tolong perbaiki error ini", "buatkan ringkasan")).toEqual([]);
  });

  it("keeps Indonesian preferences", () => {
    expect(texts("jangan push tanpa izin", "selalu jalankan tes sebelum selesai", "jawab dalam bahasa indonesia", "coba selalu tulis tes dulu")).toEqual([
      "jangan push tanpa izin",
      "selalu jalankan tes sebelum selesai",
      "jawab dalam bahasa indonesia",
      "coba selalu tulis tes dulu",
    ]);
  });
});

describe("extractInstructions: more ways to say 'go on'", () => {
  const texts = (...msgs: string[]) => extractInstructions(msgs.flatMap((m) => [asst(), say(m)])).map((c) => c.text);

  it("drops 'continue' and acknowledgements in Indonesian and English", () => {
    expect(texts("silakan lanjutkan", "terus aja", "oke gas", "mantap lanjut", "ayo teruskan", "keep going", "go on then")).toEqual([]);
  });

  it("keeps preferences that share those words", () => {
    expect(texts("keep answers short", "terus pakai bahasa indonesia")).toEqual(["keep answers short", "terus pakai bahasa indonesia"]);
  });
});

describe("extractInstructions: contrast stays with its instruction", () => {
  it("keeps 'not …' and 'instead of …' attached", () => {
    const cs = extractInstructions([asst(), say("use pnpm, not npm"), asst(), say("write tests first, instead of after")]);
    expect(cs.map((c) => c.text)).toEqual(["use pnpm, not npm", "write tests first, instead of after"]);
  });
});
