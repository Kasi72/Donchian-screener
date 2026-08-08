export interface UniverseInstrument {
  symbol: string;
  yahooSymbol: string;
  companyName?: string;
  industry?: string;
  series?: string;
  isin?: string;
}

export interface UniverseParseResult {
  instruments: UniverseInstrument[];
  rejected: Array<{ row: number; symbol?: string; reason: string }>;
  duplicateCount: number;
  totalRows: number;
}
