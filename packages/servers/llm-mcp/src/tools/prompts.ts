export const taskKinds = [
  "classify",
  "extract",
  "summarize",
  "transform",
  "free",
] as const;

export type TaskKind = (typeof taskKinds)[number];

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
