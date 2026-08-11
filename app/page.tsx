import { ScanForm } from "@/components/scan-form";
import { ThemeSelector } from "@/components/theme-selector";

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#main-content" aria-label="Reversal Radar home">
          Reversal Radar
        </a>
        <ThemeSelector />
      </header>
      <div className="workspace" id="main-content">
        <div className="intro">
          <h1>Find completed-candle bullish reversals</h1>
          <p>
            Upload one NSE stock list, choose a timeframe, and calculate causal Donchian BUY levels
            from completed Yahoo Finance candles.
          </p>
        </div>
        <ScanForm />
      </div>
    </main>
  );
}
