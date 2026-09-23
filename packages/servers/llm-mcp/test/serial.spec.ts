import { describe, expect, it } from "vitest";
import type { Backend, Completion } from "../src/backend/port.js";
import { createSerialBackend } from "../src/backend/serial.js";

interface Gate {
  readonly backend: Backend;
  readonly started: string[];
  readonly release: (label: string, outcome?: Error) => void;
}

function gatedBackend(): Gate {
  const started: string[] = [];
  const waiting = new Map<string, (outcome?: Error) => void>();
  const backend: Backend = {
    model: "m",
    contextTokens: 16_384,
    complete: ({ messages }) => {
      const label = messages[0]?.content ?? "";
      started.push(label);
      return new Promise<Completion>((resolve, reject) => {
        waiting.set(label, (outcome) => {
          if (outcome === undefined) {
            resolve({
              text: label,
              promptTokens: 0,
              outputTokens: 0,
              durationMs: 0,
            });
          } else {
            reject(outcome);
          }
        });
      });
    },
    probe: () => Promise.resolve({ reachable: true, loaded: true }),
    warm: () => Promise.resolve(),
  };
  return {
    backend,
    started,
    release: (label, outcome) => waiting.get(label)?.(outcome),
  };
}

const ask = (label: string) => ({
  messages: [{ role: "user" as const, content: label }],
});

const tick = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe("createSerialBackend", () => {
  it("starts the next call only after the previous one settled", async () => {
    const gate = gatedBackend();
    const serial = createSerialBackend(gate.backend);
    const first = serial.complete(ask("a"));
    const second = serial.complete(ask("b"));
    await tick();
    expect(gate.started).toEqual(["a"]);
    expect(serial.pending).toBe(2);
    gate.release("a");
    expect((await first).text).toBe("a");
    await tick();
    expect(gate.started).toEqual(["a", "b"]);
    gate.release("b");
    await second;
    expect(serial.pending).toBe(0);
  });

  it("keeps the queue moving after a failed call", async () => {
    const gate = gatedBackend();
    const serial = createSerialBackend(gate.backend);
    const first = serial.complete(ask("a"));
    const second = serial.complete(ask("b"));
    await tick();
    gate.release("a", new Error("boom"));
    await expect(first).rejects.toThrow("boom");
    await tick();
    gate.release("b");
    expect((await second).text).toBe("b");
  });

  it("skips a queued call whose caller already gave up", async () => {
    const gate = gatedBackend();
    const serial = createSerialBackend(gate.backend);
    const first = serial.complete(ask("a"));
    const controller = new AbortController();
    const second = serial.complete({ ...ask("b"), signal: controller.signal });
    controller.abort();
    await tick();
    gate.release("a");
    await first;
    await expect(second).rejects.toThrow();
    expect(gate.started).toEqual(["a"]);
  });

  it("answers probe without waiting in the queue", async () => {
    const gate = gatedBackend();
    const serial = createSerialBackend(gate.backend);
    const running = serial.complete(ask("a"));
    await tick();
    expect(await serial.probe()).toEqual({ reachable: true, loaded: true });
    gate.release("a");
    await running;
  });
});
