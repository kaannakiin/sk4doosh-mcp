export const taskKinds = [
  "classify",
  "extract",
  "summarize",
  "transform",
  "free",
] as const;

export type TaskKind = (typeof taskKinds)[number];

export const splittableKinds = [
  "summarize",
  "extract",
] as const satisfies readonly TaskKind[];

export type SplittableKind = (typeof splittableKinds)[number];

export function isSplittable(kind: TaskKind): kind is SplittableKind {
  return (splittableKinds as readonly TaskKind[]).includes(kind);
}

export const systemPrompts = {
  classify:
    "You are a classifier. Answer only with the requested labels. No commentary.",
  extract:
    "You are an extraction tool. Output only the requested fields. If a field is absent, use null. No commentary.",
  summarize:
    "You are a precise summarizer. One-sentence headline, then 3-7 bullets of key facts. No preamble.",
  transform:
    "You rewrite the input exactly as instructed. Output only the result.",
  free: "Follow the instruction precisely and answer concisely.",
} as const satisfies Record<TaskKind, string>;

export const schemaSuffix = " Answer with JSON that matches the given schema.";

export const notesPrompt =
  "You take notes for a later step. Write compact notes of the facts, decisions and numbers in this text that the instruction needs. No preamble.";

export const mergePrompt =
  "You merge notes for a later step. Combine these notes into shorter notes, keeping every fact, decision and number the instruction needs. No preamble.";
