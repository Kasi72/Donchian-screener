import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market/provider";
import {
  selectHighestPeriodCandidate,
  selectRulesPeriod,
  structuralScore,
  type PeriodCandidate,
} from "@/lib/signals/period-selector";

function candle(
  index: number,
  low = 110,
  high = 112,
  close = 111,
  volume = 1_000,
): Candle {
  return { time: index * 60_000, open: close, high, low, close, volume };
}

function candidateFixture(): Candle[] {
  const candles = Array.from({ length: 31 }, (_, index) => candle(index));

  // Both anchors are fully confirmed before t=30. The sub-tick raw rise from
  // the newer anchor to the signal permits both anchored periods to satisfy
  // the exact rollover rule without scanning unrelated integer periods.
  candles[16] = candle(16, 90, 110, 100, 2_000);
  candles[17] = candle(17, 108, 114, 112);
  candles[18] = candle(18, 109, 116, 114);
  candles[22] = candle(22, 95.01, 108, 100, 900);
  candles[23] = candle(23, 108, 111, 110);
  candles[24] = candle(24, 109, 112, 111);
  candles[30] = candle(30, 95.02, 108, 102);
  return candles;
}

describe("rules period selection", () => {
  it("freezes the exact structural-v1 score for a hand-calculated fixture", () => {
    const candles = Array.from({ length: 21 }, (_, index) =>
      candle(index, 99, 101, 100, index === 14 ? 200 : 100),
    );
    const score = structuralScore(candles, 20, {
      index: 14,
      time: candles[14].time,
      low: 99,
      prominenceAtr: 1,
      recoveryAtr: 1.5,
      confirmedAt: 16,
    });

    expect(score).toEqual({
      version: "structural-v1",
      score: 0.5705,
      components: {
        prominence: 0.5,
        recovery: 0.5,
        recency: 0.97,
        retests: 1 / 3,
        relativeVolume: 1,
        higherTimeframeAgreement: 0,
      },
    });
  });

  it("creates periods only from independently confirmed anchors", () => {
    const candles = candidateFixture();

    // This low would make arbitrary N=1 pass, but it is not independently
    // confirmed before the signal is evaluated.
    candles[29] = candle(29, 95.01, 109, 105);

    const result = selectRulesPeriod(candles, 30);

    expect(result.candidates.map(({ anchor, period }) => ({
      anchorIndex: anchor.index,
      confirmedAt: anchor.confirmedAt,
      period,
    }))).toEqual([
      { anchorIndex: 16, confirmedAt: 18, period: 14 },
    ]);
    expect(result.candidates.some((candidate) => candidate.period === 1)).toBe(
      false,
    );
  });

  it("selects the candidate with the highest frozen structural score", () => {
    const result = selectRulesPeriod(candidateFixture(), 30);

    expect(result.candidates.map((candidate) => candidate.anchor.index)).toEqual([
      16,
      22,
    ]);
    expect(result.candidates[0].score).toBeGreaterThan(
      result.candidates[1].score,
    );
    expect(result.selected?.anchor.index).toBe(16);
    expect(result.selected?.score).toBe(result.candidates[0].score);
  });

  it("does not let candles after the signal alter candidates or scores", () => {
    const candles = candidateFixture();
    const before = selectRulesPeriod(candles, 30);
    candles.push(candle(31, 1, 500, 400, 1_000_000));

    expect(selectRulesPeriod(candles, 30)).toEqual(before);
  });

  it("breaks score ties by raw prominence and then by the newer anchor", () => {
    const candidate = (
      index: number,
      prominenceAtr: number,
    ): PeriodCandidate => ({
      anchor: {
        index,
        time: index,
        low: 90,
        prominenceAtr,
        recoveryAtr: 1,
        confirmedAt: index + 2,
      },
      period: 30 - index,
      score: 0.75,
      currentLdc: 100,
      previousLdc: 90,
    });

    expect(
      selectHighestPeriodCandidate([candidate(20, 0.8), candidate(10, 1.2)])
        ?.anchor.index,
    ).toBe(10);
    expect(
      selectHighestPeriodCandidate([candidate(10, 1.2), candidate(20, 1.2)])
        ?.anchor.index,
    ).toBe(20);
  });
});
