import { ScanForm } from "@/components/scan-form";
import { BrandMark } from "@/components/brand-mark";
import { StrategyFlow } from "@/components/strategy-flow";
import { ThemeSelector } from "@/components/theme-selector";

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#main-content" aria-label="Donchian Reversal Screener home">
          <BrandMark />
          <span>Donchian Reversal Screener</span>
        </a>
        <ThemeSelector />
      </header>
      <div className="workspace" id="main-content">
        <section className="hero-grid" aria-labelledby="page-title">
          <div className="intro">
            <h1 id="page-title">Find completed-candle reversal setups</h1>
            <p className="byline">Donchian Reversal Screener · by Dr KKR</p>
            <p>Screen equities and indices using the original Donchian reversal rule, then rank each setup by confirmation quality, risk, and data integrity.</p>
            <div className="hero-badges" aria-label="Method guarantees"><span>RAW OHLC</span><span>CANDLE-CLOSE VERIFIED</span><span>TICK-NORMALIZED</span></div>
          </div>
          <aside className="method-summary" aria-label="Method summary">
            <p className="method-summary__eyebrow">How the screen works</p>
            <h2>One hard gate. Clearer decisions.</h2>
            <ol><li><strong>Locate</strong><span>Completed candle touches the lower Donchian channel.</span></li><li><strong>Validate</strong><span>Channel rises, period is audited, and data is complete.</span></li><li><strong>Rank</strong><span>Evidence and risk metrics guide your next review.</span></li></ol>
          </aside>
        </section>
        <StrategyFlow />
        <ScanForm />
      </div>
    </main>
  );
}
