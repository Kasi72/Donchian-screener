export function BrandMark() {
  return (
    <svg
      className="brand-mark"
      role="img"
      aria-label="Donchian Reversal Screener mark"
      viewBox="0 0 44 44"
      focusable="false"
    >
      <title>Donchian Reversal Screener mark</title>
      <rect className="brand-mark__frame" x="2" y="2" width="40" height="40" rx="12" />
      <path className="brand-mark__channel" d="M11 14h22M11 30h22" />
      <path className="brand-mark__trace" d="M11 30V20h7v6h7V14h8" />
      <circle className="brand-mark__dot" cx="33" cy="14" r="2.5" />
    </svg>
  );
}
