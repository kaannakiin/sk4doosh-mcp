import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../config/configuration.ts";

interface Waiter {
  readonly admit: () => void;
  readonly signal: AbortSignal;
}

/**
 * A first-in, first-out gate that lets `limit` tasks run at once.
 *
 * Guard: a waiter that is aborted leaves the queue and never runs. A turn that
 * was cancelled while its worker call queued behind another conversation's
 * would otherwise still occupy the model host after nobody is waiting for it.
 */
export class Lane {
  private active = 0;

  private readonly queue: Waiter[] = [];

  constructor(private readonly limit: number) {}

  /**
   * Runs `task` once a slot is free.
   *
   * @param signal cancels the wait, not a task that has started
   * @param task the work that needs a slot
   * @returns the task's value and how long it queued
   */
  async run<T>(
    signal: AbortSignal,
    task: () => Promise<T>,
  ): Promise<{ readonly value: T; readonly queuedMs: number }> {
    const queuedAt = Date.now();
    await this.acquire(signal);
    const queuedMs = Date.now() - queuedAt;
    try {
      return { value: await task(), queuedMs };
    } finally {
      this.releaseSlot();
    }
  }

  private acquire(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.active < this.limit) {
      this.active += 1;

      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        signal,
        admit: () => {
          signal.removeEventListener("abort", abandon);
          resolve();
        },
      };
      const abandon = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) {
          this.queue.splice(index, 1);
        }
        reject(signal.reason);
      };
      signal.addEventListener("abort", abandon, { once: true });
      this.queue.push(waiter);
    });
  }

  private releaseSlot(): void {
    const next = this.queue.shift();
    if (next === undefined) {
      this.active -= 1;

      return;
    }
    next.admit();
  }
}

/**
 * One lane per model host, shared by every conversation.
 *
 * Guard: the lane is keyed by host, not by conversation. `llm-mcp` serializes
 * its own calls, but each conversation runs its own `llm-mcp`, so without a lane
 * here two conversations put two prompts on one GPU at once and both of them
 * run at half speed against their own timeouts.
 */
@Injectable()
export class WorkerLanes {
  private readonly lanes = new Map<string, Lane>();

  private readonly limit: number;

  constructor(config: ConfigService<AppConfig, true>) {
    this.limit = config.get("gateway", { infer: true }).workerConcurrency;
  }

  laneFor(host: string): Lane {
    const existing = this.lanes.get(host);
    if (existing !== undefined) {
      return existing;
    }

    const lane = new Lane(this.limit);
    this.lanes.set(host, lane);

    return lane;
  }
}
