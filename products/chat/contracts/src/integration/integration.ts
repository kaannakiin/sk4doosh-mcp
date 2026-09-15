import { z } from "zod";

export const integrationIdSchema = z.uuid();

export type IntegrationId = z.infer<typeof integrationIdSchema>;

export const integrationOriginSchema = z.enum(["partner", "user"]);

export type IntegrationOrigin = z.infer<typeof integrationOriginSchema>;
