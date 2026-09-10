import { webEnvSchema } from "@chat/contracts/config/web-env";

export const env = webEnvSchema.parse(import.meta.env);
