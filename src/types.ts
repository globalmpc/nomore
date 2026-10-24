import { z } from "zod";

export const Event = z.object({
  kind: z.enum(["user_text", "user_marker", "tool_rejected", "assistant_tool_use", "assistant_text"]),
  uuid: z.string(),
  sessionId: z.string(),
  cwd: z.string(),
  ts: z.string(),
  text: z.string().optional(),
  tool: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
});
export type Event = z.infer<typeof Event>;

export const Signal = z.enum(["rejected", "interrupt", "phrase", "revert", "repeated"]);
export type Signal = z.infer<typeof Signal>;

export const Correction = z.object({
  uuid: z.string(),
  sessionId: z.string(),
  cwd: z.string(),
  ts: z.string(),
  text: z.string(),
  norm: z.string(),
  signals: z.array(Signal),
});
export type Correction = z.infer<typeof Correction>;

export const Group = z.object({
  id: z.string(),
  members: z.array(Correction),
  representative: Correction,
  count: z.number(),
  sessions: z.number(),
  projects: z.number(),
  days: z.number(),
  lastSeen: z.string(),
  score: z.number(),
  signals: z.array(Signal),
});
export type Group = z.infer<typeof Group>;

export const Suggestion = z.object({
  id: z.string(),
  text: z.string(),
  status: z.enum(["new", "ignored"]),
  matchedRule: z.string().optional(),
  count: z.number(),
  sessions: z.number(),
  projects: z.number(),
  days: z.number(),
  score: z.number(),
  lastSeen: z.string(),
  examples: z.array(z.string()).max(3),
  signals: z.array(Signal),
});
export type Suggestion = z.infer<typeof Suggestion>;

export const Report = z.object({
  scannedSessions: z.number(),
  skippedLines: z.number(),
  corrections: z.number(),
  suggestions: z.array(Suggestion),
});
export type Report = z.infer<typeof Report>;
