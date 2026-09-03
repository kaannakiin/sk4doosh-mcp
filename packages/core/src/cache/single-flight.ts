export class SingleFlight<TKey extends string, TValue> {
  private readonly inFlight = new Map<TKey, Promise<TValue>>();

  run(key: TKey, work: () => Promise<TValue>): Promise<TValue> {
    const existing = this.inFlight.get(key);
    if (existing !== undefined) {
      return existing;
    }
    let started: Promise<TValue>;
    try {
      started = work();
    } catch (error) {
      started = Promise.reject(error as unknown);
    }
    const tracked = started.finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, tracked);
    return tracked;
  }
}
