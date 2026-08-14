const STEPS = [
  ["01", "Upload universe", "CSV symbols are validated and deduplicated."],
  ["02", "Completed candles", "Only closed NSE-session candles are evaluated."],
  ["03", "Donchian gate", "The tick-normalized lower-channel reversal rule stays causal."],
  ["04", "Evidence check", "CUSUM, change-point, trend and candle-quality evidence grade the setup."],
  ["05", "Actionable BUY", "Entry, stop and targets are emitted with full diagnostics."],
] as const;

export function StrategyFlow() {
  return (
    <section className="strategy-flow" aria-label="How the reversal signal is validated">
      <div className="strategy-flow__heading">
        <div>
          <p className="eyebrow">Signal architecture</p>
          <h2>From market data to a defensible reversal</h2>
        </div>
        <p className="strategy-flow__note">Every stage remains observable in the result details.</p>
      </div>
      <ol className="strategy-flow__steps">
        {STEPS.map(([number, title, description], index) => (
          <li className="strategy-flow__step" key={title}>
            <div className="strategy-flow__node">
              <span className="strategy-flow__number">{number}</span>
              <span className="strategy-flow__title">{title}</span>
              <span className="strategy-flow__description">{description}</span>
            </div>
            {index < STEPS.length - 1 ? <span className="strategy-flow__connector" aria-hidden="true">→</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
