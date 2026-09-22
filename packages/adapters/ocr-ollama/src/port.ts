/**
 * The shape `@sk-mcp/pdf-mcp` injects an OCR provider through.
 *
 * Guard: declared structurally rather than imported, so this adapter names no
 * `@sk-mcp/*` package and the dependency graph stays acyclic. `ocr-port.spec.ts`
 * in pdf-mcp assigns this factory's result to the real `OcrProvider` at compile
 * time, so the two cannot drift apart unnoticed.
 */
export interface RenderedPage {
  readonly page: number;
  readonly image: Uint8Array;
  readonly mediaType: "image/png" | "image/jpeg" | "image/webp";
}

export interface RecognizedPage {
  readonly page: number;
  readonly markdown: string;
  readonly confidence?: number;
}

export interface RecognizeJob {
  readonly pages: readonly RenderedPage[];
  readonly signal?: AbortSignal;
}

export interface OcrProvider {
  readonly name: string;
  recognize(job: RecognizeJob): Promise<readonly RecognizedPage[]>;
}
