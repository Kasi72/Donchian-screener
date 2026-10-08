function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function assertTickSize(tickSize: number): void {
  if (!Number.isFinite(tickSize) || tickSize <= 0) {
    throw new RangeError("Tick size must be positive and finite");
  }
}

/** Converts a price to the nearest exchange tick while neutralizing binary-fraction drift. */
export function priceToTicks(price: number, tickSize: number): number {
  assertFinite(price, "Price");
  assertTickSize(tickSize);
  const quotient = price / tickSize;
  const nearest = Math.round(quotient);
  // All downstream comparisons are performed in integer ticks.  Rounding
  // once here removes binary-fraction drift without introducing a separate
  // price tolerance that could disagree with the exchange tick grid.
  return nearest;
}

/** Converts integer exchange ticks back to a display-safe price. */
export function ticksToPrice(ticks: number, tickSize: number): number {
  if (!Number.isInteger(ticks)) throw new RangeError("Ticks must be an integer");
  assertTickSize(tickSize);
  return Number((ticks * tickSize).toPrecision(15));
}
