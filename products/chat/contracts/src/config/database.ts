import { z } from "zod";

export const DB_POOL_MAX_DEFAULT = 10;

export const DB_POOL_MAX_HARD = 100;

/**
 * Guard: the scheme is constrained rather than left to `z.url()`, because every
 * other URL-shaped value in this environment is an HTTP endpoint. A connection
 * string pasted into the wrong variable is otherwise accepted at boot and only
 * surfaces as a driver error on the first query.
 */
export const databaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/u });

export type DatabaseUrl = z.infer<typeof databaseUrlSchema>;
