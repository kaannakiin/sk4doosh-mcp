export const SESSION_PAGE_SIZE_DEFAULT = 20;

export const SESSION_PAGE_SIZE_HARD = 50;

/**
 * Guard: a detail response is capped because it is read back into the model's
 * window on the next turn. A long tool-heavy conversation exceeds both the api's
 * 8 MB json body limit on the way out and `CHAT_LLM_CONTEXT_TOKENS` on the way
 * in, so the newest slice is returned and the response says it was cut.
 */
export const SESSION_HISTORY_LIMIT_DEFAULT = 200;

export const SESSION_HISTORY_LIMIT_HARD = 500;

export const SESSION_TITLE_MAX_LENGTH = 60;
