import { describe, expect, it, vi } from "vitest";

import type { CandleResponse } from "@/lib/market/provider";
import {
  BoundedCandleCache,
  GlobalRequestThrottle,
} from "@/lib/market/provider-controls";

function response(asOf: number): CandleResponse {
  return { status: "OK", candles: [], asOf, adjustmentMode: "RAW" };
}

describe("BoundedCandleCache", () => {
  it("uses LRU eviction and expires entries", () => {
    let now = 1_000;
    const cache = new BoundedCandleCache({ maxEntries: 2, ttlMs: 50, now: () => now });
    cache.set("A", response(1));
    cache.set("B", response(2));
    expect(cache.get("A")?.asOf).toBe(1);
    cache.set("C", response(3));

    expect(cache.size).toBe(2);
    expect(cache.get("B")).toBeUndefined();
    expect(cache.get("A")?.asOf).toBe(1);
    now += 51;
    expect(cache.get("A")).toBeUndefined();
  });
});

describe("GlobalRequestThrottle", () => {
  it("bounds concurrent work globally and rejects an aborted queued request", async () => {
    const throttle = new GlobalRequestThrottle({ maxConcurrent: 2, minSpacingMs: 0 });
    let active = 0;
    let maximumActive = 0;
    const release: Array<() => void> = [];
    const task = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active -= 1;
      return active;
    });

    const first = throttle.run(task);
    const second = throttle.run(task);
    const abortController = new AbortController();
    const third = throttle.run(task, abortController.signal);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(2));
    abortController.abort(new DOMException("cancelled", "AbortError"));
    await expect(third).rejects.toMatchObject({ name: "AbortError" });
    release.splice(0).forEach((resolve) => resolve());
    await Promise.all([first, second]);

    expect(maximumActive).toBe(2);
    expect(throttle.activeCount).toBe(0);
    expect(throttle.queuedCount).toBe(0);
  });
});
