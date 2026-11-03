import { normalize, tokens } from "./normalize.js";
import type { Correction, Event, Signal } from "./types.js";

// Spec › Correction signals.
const LOOKAHEAD = 3;
const MAX_PHRASE = 400;
const STARTS = /^(no|nope|don'?t|do not|stop|wrong|not that|instead|undo|revert|i said|i told you)\b/i;
const CONTAINS = /\b(instead of|i said|i told you|don'?t|do not|never)\b/i;

const isCorrectionPhrase = (text: string) => {
  const t = text.trim();
  return t.length <= MAX_PHRASE && (STARTS.test(t) || CONTAINS.test(t.slice(0, 80)));
};

export function detectCorrections(events: Event[]): Correction[] {
  const signals = new Map<number, Set<Signal>>(); // index of a user_text event → its signals
  const add = (i: number, s: Signal) => (signals.get(i) ?? signals.set(i, new Set()).get(i)!).add(s);
  const nextTyped = (i: number) => {
    for (let j = i + 1; j <= i + LOOKAHEAD && j < events.length; j++) if (events[j].kind === "user_text") return j;
    return -1;
  };
  const edits: { file: unknown; old: unknown }[] = [];

  events.forEach((e, i) => {
    if (e.kind === "tool_rejected" || e.kind === "user_marker") {
      const j = nextTyped(i);
      if (j >= 0) add(j, e.kind === "tool_rejected" ? "rejected" : "interrupt");
    }
    if (e.kind === "user_text" && i > 0 && events[i - 1].kind.startsWith("assistant") && isCorrectionPhrase(e.text ?? "")) add(i, "phrase");
    if (e.kind === "assistant_tool_use" && e.tool === "Edit") {
      const { file_path, old_string, new_string } = e.input ?? {};
      if (edits.some((x) => x.file === file_path && x.old === new_string)) {
        for (let j = i - 1; j >= 0; j--) if (events[j].kind === "user_text") { add(j, "revert"); break; }
      }
      edits.push({ file: file_path, old: old_string });
    }
  });

  return [...signals.keys()].sort((a, b) => a - b).map((i) => {
    const e = events[i];
    const text = e.text ?? "";
    return { uuid: e.uuid, sessionId: e.sessionId, cwd: e.cwd, ts: e.ts, text, norm: normalize(text), signals: [...signals.get(i)!].sort() };
  });
}

// Spec › Repeated instructions: every typed message becomes clauses; clauses that can't be a lasting preference are
// dropped. Each clause keeps its message's correction signals for display.
const MAX_CLAUSE = 120;
const ACK = new Set("yes ok okay okey proceed go ahead continue sure thanks thank lets let start now then good great fine done next step right cool nice pls plz yea yeah yep keep going oke sip siap ya yuk lanjut terus teruskan ayo gas mantap aja saja silakan".split(" ")); // + Indonesian
const PLACEHOLDER = /^<(url|file|id|n)>$/;

const clean = (text: string) =>
  text
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, "\n")
    .replace(/<([\w-]+)[^>]*>[\s\S]*?<\/\1>/g, "\n")
    .replace(/<\/?[\w-]+[^>]*>/g, "\n");

// Pasted content is judged line by line, before clause splitting, so a log line can't leave a harmless-looking
// fragment ("…limit reached, retry later" → "retry later"). Spec › Repeated instructions.
const PASTED = [
  /^\+/, // diff line
  /[{}[\];]|=>|\(['"]/, // code punctuation
  /^[\w$.]+\s*=\s*\S/, // name = value
  /^[\w$.]+:\s*['"`]/, // name: 'value'
  /^import\s+([\w$]+\s*$|.*\bfrom\b)/i, // import json / import x from 'y'
  /^from\s+\S+\s+import\b/i,
  /^(const|let|var)\s+\w+\s*=/,
  /^(def|class|function)\s+\w+\s*[(:{]/,
  /\w\([^)]*\)/, // call: openDb(), load(cfg)
  /^(error|warning|warn|fatal|exception|traceback)\b/i,
  /^at\s+\S+\s+\(/, // stack frame
  /\berror:|exception|traceback|limit (reached|exceeded)/i,
  /:$/, // heading that introduces pasted content
];
const isIdentifier = (line: string) => /^[A-Za-z_$][\w$]*$/.test(line) && /_|[a-z][A-Z]/.test(line);
// A typed shell command: a known command and only ASCII arguments, short or with a flag or path, so sentences that
// start with a command name ("git push only after review", "npm 말고 pnpm 써") are kept.
const SHELL =
  /^(git|pnpm|npm|npx|yarn|node|python3?|pip3?|docker|kubectl|curl|wget|cd|ls|rm|mkdir|bash|sh|cargo|brew|gh|tsx|bun|deno|uv|ssh|sudo)(\s+[-\w./@:=~'"&|>]+)*\s*$/i;
const isShellCommand = (line: string) => SHELL.test(line) && (line.split(/\s+/).length <= 3 || /\s-{1,2}\w|[/\\]|\.\w/.test(line));
const isPasted = (line: string) => isIdentifier(line) || isShellCommand(line) || PASTED.some((re) => re.test(line));

// One-off requests and questions recur because the task recurs, not because they are lasting preferences.
const QUESTION = /^(what|whats|what's|how|why|when|where|which|who|can you|could you|would you|do you|is it|are you|should we|apa|apakah|bagaimana|gimana|berapa|kenapa|mengapa|kapan|di mana|dimana|siapa)\b/i;
const REQUEST =
  /^(review|check|update|provide|crawl|seed|recommend|let me|lets|let's|then|and|fix|commit|push|continue|implement|create|give|add|retry|redo|try|run|double|do (it|this|that|the)|lanjut|lanjutkan|coba|cek|periksa|perbaiki|benerin|buat|buatkan|bikin|jalankan|tambahkan|hapus|kirim)\b/i;
// A task verb can still open a lasting preference ("run tests before saying done"); these words keep it.
const PREFERENCE_CUE = /\b(always|never|every|each|before|after|first|only|myself|by default|from now on|one by one|step by step|instead|selalu|jangan|tanpa|hanya|cuma|sebelum|sesudah|setelah|mulai sekarang|sendiri)\b/i;
const FILLER = /^((pls|plz|please|yea|yeah|yep|yes|ok|okay|okey|now|so|just|also|tolong|mohon|oke|sip|siap|ya|yuk|silakan|ayo)\b[\s,]*)+/i;

// A negated instruction ("do not use npm") must never join its positive form ("use npm"); grouping runs per polarity.
const NEGATION = /\b(not|no|never|don'?t|doesn'?t|didn'?t|isn'?t|aren'?t|won'?t|can'?t|cannot|shouldn'?t|without|jangan|tidak|bukan|tanpa)\b|지\s?마|말고|않|못/i;
// A contrast tail ("use pnpm, not npm") qualifies a positive instruction; it doesn't negate it.
const CONTRAST = /^(not|instead of|rather than)\b/i;
// Without the comma too, but only after a choice verb ("use pnpm not npm", "prefer tabs not spaces"): a bare
// "X not Y" is usually an evaluation ("force pushes not ok", "do it not now") and stays negated. One word after
// "not", two or more before, no auxiliary ("use what is not needed"), participle tail or evaluative/adverb tail.
// ponytail: choice verbs and one-word tails only, so "run vitest not jest" and "use pnpm not the npm cli" stay negated.
// EVAL_TAIL is not exhaustive: a missed word merges opposites ("use it not now"); extend it when one shows up.
const CHOICE = /^(use|prefer|pick|choose|write|reply|respond|answer|install|go with|stick (with|to))\b/i;
const EVAL_TAIL = /^(ok|okay|good|fine|bad|great|now|yet|again|anymore|always|ever|never|much|more|less|later|here|there|yes|no|it|this|that|me|you|them|flaky|needed|allowed|acceptable|ideal|welcome|useful|nice|cool|wise|appropriate|necessary|mandatory|helpful|safe|correct|right|wrong|true|today|tomorrow|first|twice|often|everywhere|anywhere|too|so|really|properly)\W*$/i;
const AUX = /^(do|does|did|is|are|was|were|am|be|been|can|could|should|would|will|must|may|might|shall|have|has|had|need|try|\w+['’](s|re|m|ve|ll|d))$/i;
const choiceBody = (text: string) => text.trim().replace(FILLER, "").replace(/^(always|i said)\s+/i, "");
const isContrastWord = (w: string) => !/(ed|ing)\W*$/i.test(w) && !EVAL_TAIL.test(w);
const dropBareContrast = (text: string) => {
  const body = choiceBody(text);
  const w = body.split(/\s+/);
  const i = w.length - 2; // where "not" would be
  return CHOICE.test(body) && i >= 2 && /^not$/i.test(w[i]) && !AUX.test(w[i - 1]) && isContrastWord(w[i + 1]) ? w.slice(0, i).join(" ") : text;
};
// A ", never …" tail is a contrast too (issue #18) before a description ("…, never an instruction") or, after a
// tool-choice verb, before one word that isn't a common verb ("use pnpm, never npm"). Any other ", never …" stays
// an instruction ("commit often, never amend", "answer briefly, never ramble", "use the API, never guess").
// ponytail: NEVER_VERB is not exhaustive; a missed verb merges ("use X, never <verb>"); extend it when one shows up.
const TOOL_CHOICE = /^(use|prefer|pick|choose|install|go with|stick (with|to))\b/i;
const NEVER_VERB = /^(guess|assume|ask|skip|stop|wait|ramble|apologi[sz]e|lie|invent|hardcode|mock|retry|rewrite|refactor|rename|delete|remove|overwrite|force|amend|rebase|squash|merge|push|commit|deploy|publish|release|edit|change|touch|modify|comment|explain|summari[sz]e|speculate|hallucinate|loop|repeat|truncate|ignore)\W*$/i;
const isContrastTail = (head: string, tail: string) => {
  if (CONTRAST.test(tail) || /^never\s+(a|an|the)\s/i.test(tail)) return true;
  const word = tail.match(/^never\s+(\S+)$/i)?.[1];
  return word !== undefined && TOOL_CHOICE.test(choiceBody(head)) && isContrastWord(word) && !NEVER_VERB.test(word);
};
// The text without its ", never …" contrast tails, and those tails ("use pnpm, never npm, never yarn").
const splitNeverTails = (text: string) => {
  const tails: string[] = [];
  for (let m = text.match(/^(.*),\s*(never\b.*)$/i); m && isContrastTail(m[1], m[2]); m = text.match(/^(.*),\s*(never\b.*)$/i)) {
    tails.unshift(m[2]);
    text = m[1];
  }
  return { head: text, tails };
};
export const isNegated = (text: string) =>
  NEGATION.test(dropBareContrast(splitNeverTails(text.replace(/,\s*(not|instead of|rather than)\b.*$/i, "")).head));

// Korean (spec › Repeated instructions): Hangul has no \b word boundaries, so these match as substrings.
const KO_QUESTION = /뭐|무엇|뭔|어떻게|어떤|어디|언제|왜|얼마|몇|누구|어때|어떨까|(나요|까요|까|니|냐|습니까)[?？.!~]*$/;
const KO_REQUEST = /(해\s?줘|주세요|줘|해\s?봐|하자|보자|부탁(해|합니다|드려요)?)[.!~]*$/;
const KO_PREFERENCE = /항상|절대|지\s?마|말고|없이|금지|대신|앞으로|매번|무조건|먼저|전에|후에|다음부터|직접|자세히|간단히|짧게|쉽게/;

const keep = (clause: string, question: boolean) => {
  if (clause.length > MAX_CLAUSE || /^([-*#`|>]|\d+\.)/.test(clause)) return false;
  const body = clause.replace(FILLER, "");
  if (question || QUESTION.test(body) || (REQUEST.test(body) && !PREFERENCE_CUE.test(body))) return false;
  if ((KO_QUESTION.test(body) || KO_REQUEST.test(body)) && !KO_PREFERENCE.test(body)) return false;
  const t = tokens(normalize(clause));
  const words = t.filter((x) => !PLACEHOLDER.test(x) && x.length > 1);
  return !t.includes("<url>") && words.length >= 2 && (t.length - words.length) * 2 <= t.length && !words.every((x) => ACK.has(x));
};

// Grouping tokens: plain plurals are singularised so "words" and "word" match. A contrast "never" counts like the
// stopword "not", so "use pnpm, never npm" groups with "use pnpm, not npm".
export const clauseTokens = (text: string) => {
  const { head, tails } = splitNeverTails(text);
  const asNot = head + tails.map((t) => `, not${t.slice("never".length)}`).join("");
  return tokens(normalize(asNot)).map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
};

export function extractInstructions(events: Event[]): Correction[] {
  const signals = new Map(detectCorrections(events).map((c) => [c.uuid, c.signals]));
  return events.flatMap((e) => {
    if (e.kind !== "user_text") return [];
    return clean(e.text ?? "")
      .split("\n")
      .filter((line) => !isPasted(line.trim()))
      .join("\n")
      .split(/\n+|(?<=[.;!?？])\s+|,\s+|\s+(?:and|but)\s+/i)
      .reduce<string[]>((parts, p) => (parts.length && isContrastTail(parts.at(-1)!, p.trim()) ? [...parts.slice(0, -1), `${parts.at(-1)}, ${p.trim()}`] : [...parts, p]), [])
      .map((raw, i) => ({ c: raw.trim().replace(/[.;!?？]+$/, "").trim(), q: /[?？]\s*$/.test(raw), i }))
      .filter(({ c, q }) => keep(c, q))
      .map(({ c, i }) => ({ uuid: `${e.uuid}:${i}`, sessionId: e.sessionId, cwd: e.cwd, ts: e.ts, text: c, norm: normalize(c), signals: signals.get(e.uuid) ?? [] }));
  });
}
