import type { CandleResponse } from "./provider";

interface CacheEntry {
  value: CandleResponse;
  expiresAt: number;
}

export interface BoundedCandleCacheOptions {
  maxEntries: number;
  ttlMs: number;
  now?: () => number;
}

export class BoundedCandleCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: BoundedCandleCacheOptions) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries <= 0) {
      throw new RangeError("Cache maxEntries must be a positive integer");
    }
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      throw new RangeError("Cache ttlMs must be positive");
    }
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): CandleResponse | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: CandleResponse): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

interface QueuedWork<T> {
  task: () => Promise<T>;
  signal?: AbortSignal;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  onAbort?: () => void;
}

export interface GlobalRequestThrottleOptions {
  maxConcurrent: number;
  minSpacingMs: number;
}

export class GlobalRequestThrottle {
  private readonly maxConcurrent: number;
  private readonly minSpacingMs: number;
  private readonly queue: Array<QueuedWork<unknown>> = [];
  private active = 0;
  private lastStartedAt = 0;
  private scheduled = false;

  constructor(options: GlobalRequestThrottleOptions) {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent <= 0) {
      throw new RangeError("Throttle maxConcurrent must be a positive integer");
    }
    if (!Number.isFinite(options.minSpacingMs) || options.minSpacingMs < 0) {
      throw new RangeError("Throttle minSpacingMs cannot be negative");
    }
    this.maxConcurrent = options.maxConcurrent;
    this.minSpacingMs = options.minSpacingMs;
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      const work: QueuedWork<T> = { task, signal, resolve, reject };
      work.onAbort = () => {
        const index = this.queue.indexOf(work as QueuedWork<unknown>);
        if (index >= 0) this.queue.splice(index, 1);
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", work.onAbort, { once: true });
      this.queue.push(work as QueuedWork<unknown>);
      this.drain();
    });
  }

  private drain(): void {
    if (this.active >= this.maxConcurrent || this.queue.length === 0) return;
    const delay = Math.max(0, this.lastStartedAt + this.minSpacingMs - Date.now());
    if (delay > 0) {
      if (!this.scheduled) {
        this.scheduled = true;
        setTimeout(() => {
          this.scheduled = false;
          this.drain();
        }, delay);
      }
      return;
    }

    const work = this.queue.shift()!;
    work.signal?.removeEventListener("abort", work.onAbort!);
    if (work.signal?.aborted) {
      work.reject(work.signal.reason);
      this.drain();
      return;
    }
    this.active += 1;
    this.lastStartedAt = Date.now();
    void work
      .task()
      .then(work.resolve, work.reject)
      .finally(() => {
        this.active -= 1;
        this.drain();
      });
    this.drain();
  }
}

export const GLOBAL_CANDLE_CACHE = new BoundedCandleCache({
  maxEntries: 256,
  ttlMs: 60_000,
});

export const GLOBAL_YAHOO_THROTTLE = new GlobalRequestThrottle({
  maxConcurrent: 4,
  minSpacingMs: 50,
});
