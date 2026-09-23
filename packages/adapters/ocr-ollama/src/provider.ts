import type {
  OcrProvider,
  RecognizeJob,
  RecognizedPage,
  RenderedPage,
} from "./port.js";

export interface OllamaOcrOptions {
  /** Host root without an /api suffix, for example http://127.0.0.1:11434. */
  readonly baseUrl: string;
  readonly model: string;
  /**
   * Guard: deepseek-ocr answers a bare instruction with bounding boxes mixed
   * into the text, and "<image>\n<|grounding|>..." makes that the norm rather
   * than the exception. "Free OCR." was measured to return the page's text and
   * nothing else. Override only against a model you have measured.
   */
  readonly prompt?: string;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly keepAlive?: string;
}

/**
 * What one /api/generate body can mean, as data rather than as a throw.
 *
 * Guard: Ollama answers 200 with an `error` field for a missing model, so a
 * status check alone would hand that string back as the page's text. Every
 * outcome is named here and the caller decides what each one costs.
 */
type OllamaAnswer =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "refused"; readonly detail: string }
  | { readonly kind: "unreadable"; readonly detail: string };

function fieldOf(body: object, key: string): unknown {
  return Object.hasOwn(body, key)
    ? (body as Readonly<Record<string, unknown>>)[key]
    : undefined;
}

function answerOf(body: unknown): OllamaAnswer {
  if (typeof body !== "object" || body === null) {
    return { kind: "unreadable", detail: "the body was not a JSON object" };
  }
  const error = fieldOf(body, "error");
  if (typeof error === "string" && error !== "") {
    return { kind: "refused", detail: error };
  }
  const text = fieldOf(body, "response");
  if (typeof text !== "string") {
    return { kind: "unreadable", detail: "the body carried no response field" };
  }
  return { kind: "text", text };
}

const defaultPrompt = "<image>\nFree OCR.";
const defaultTimeoutMs = 120_000;

function endpointOf(baseUrl: string): string {
  return new URL("/api/generate", baseUrl).toString();
}

function transcriptOf(body: unknown, page: number): string {
  const answer = answerOf(body);
  switch (answer.kind) {
    case "text":
      return answer.text;
    case "refused":
      throw new Error(`Ollama refused page ${String(page)}: ${answer.detail}`);
    case "unreadable":
      throw new Error(
        `Ollama returned no transcript for page ${String(page)}: ${answer.detail}.`,
      );
  }
}

/**
 * Recognises page images with an Ollama vision model.
 *
 * Pages are sent one request at a time: a vision model holds the whole image in
 * its context, and Ollama serialises requests per model anyway, so batching buys
 * nothing and makes one slow page delay every other page's result.
 */
export function createOllamaOcrProvider(
  options: OllamaOcrOptions,
): OcrProvider {
  const endpoint = endpointOf(options.baseUrl);
  const prompt = options.prompt ?? defaultPrompt;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;

  const transcribe = async (
    page: RenderedPage,
    signal: AbortSignal | undefined,
  ): Promise<RecognizedPage> => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const abort =
      signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body: JSON.stringify({
          model: options.model,
          prompt,
          images: [Buffer.from(page.image).toString("base64")],
          stream: false,
          options: { temperature: 0 },
          ...(options.keepAlive === undefined
            ? {}
            : { keep_alive: options.keepAlive }),
        }),
        signal: abort,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Ollama at ${options.baseUrl} did not answer for page ${String(page.page)}: ${detail}`,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new Error(
        `Ollama answered ${String(response.status)} for page ${String(page.page)}.`,
      );
    }
    return {
      page: page.page,
      markdown: transcriptOf(await response.json(), page.page).trim(),
    };
  };

  return {
    name: `ollama/${options.model}`,
    async recognize(job: RecognizeJob): Promise<readonly RecognizedPage[]> {
      const recognized: RecognizedPage[] = [];
      for (const page of job.pages) {
        recognized.push(await transcribe(page, job.signal));
      }
      return recognized;
    },
  };
}
