// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScanForm } from "@/components/scan-form";
import type { BuyRecommendation } from "@/lib/signals/scan-symbol";

const FIRST_PARSE = {
  instruments: [
    { symbol: "RELIANCE", yahooSymbol: "RELIANCE.NS" },
    { symbol: "TCS", yahooSymbol: "TCS.NS" },
  ],
  rejected: [{ row: 4, symbol: "NIFTY", reason: "Series must be EQ" }],
  duplicateCount: 1,
  totalRows: 4,
};

const BUY: BuyRecommendation = {
  recommendation: "BUY",
  symbol: "RELIANCE",
  yahooSymbol: "RELIANCE.NS",
  timeframe: "1h",
  signalTime: Date.UTC(2026, 7, 7, 10),
  autoPeriod: 94,
  probability: null,
  entry: 1400,
  stop: 1375,
  target1: 1425,
  target2: 1450,
  currentLdc: 1385,
  previousLdc: 1380,
  anchorTime: Date.UTC(2026, 6, 28, 10),
  strategyVersion: "rules-v1",
  dataAsOf: Date.UTC(2026, 7, 7, 10, 5),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ScanForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts with an accessible upload flow and disabled unavailable actions", () => {
    render(<ScanForm />);

    expect(screen.getByLabelText("Upload stock list")).toHaveAttribute("accept", ".csv,text/csv");
    expect(screen.getByText("Uploading another file replaces this list.")).toBeInTheDocument();
    expect(screen.getByLabelText("Candle timeframe")).toHaveValue("1d");
    expect(screen.getByRole("button", { name: "Scan for BUY signals" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export results" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Validated Model BUY" })).toBeDisabled();
    expect(
      screen.getByText(
        "Validated Model BUY becomes available only after an out-of-sample model passes its acceptance checks.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Upload a stock list to begin.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Quantitative research output, not a guarantee or personalized investment advice.",
      ),
    ).toBeInTheDocument();
  });

  it("posts the file as multipart data and shows a validation summary", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(FIRST_PARSE));
    render(<ScanForm />);

    await user.upload(
      screen.getByLabelText("Upload stock list"),
      new File(["Symbol\nRELIANCE"], "stocks.csv", { type: "text/csv" }),
    );

    const summary = await screen.findByRole("status", { name: "Stock list summary" });
    expect(summary).toHaveTextContent("2 valid instruments");
    expect(summary).toHaveTextContent("1 rejected row");
    expect(summary).toHaveTextContent("1 duplicate removed");
    expect(screen.getByText("stocks.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan for BUY signals" })).toBeEnabled();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/universe/parse");
    expect(options?.method).toBe("POST");
    expect(options?.body).toBeInstanceOf(FormData);
    expect((options?.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("uses the selected timeframe, shows every scan result, and replaces prior results on a new upload", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(FIRST_PARSE))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            { symbol: "RELIANCE", status: "BUY", recommendation: BUY },
            { symbol: "TCS", status: "NO_SIGNAL" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          instruments: [{ symbol: "INFY", yahooSymbol: "INFY.NS" }],
          rejected: [],
          duplicateCount: 0,
          totalRows: 1,
        }),
      );
    render(<ScanForm />);

    const input = screen.getByLabelText("Upload stock list");
    await user.upload(input, new File(["Symbol\nRELIANCE\nTCS"], "first.csv", { type: "text/csv" }));
    await screen.findByText("2 valid instruments");
    await user.selectOptions(screen.getByLabelText("Candle timeframe"), "1h");
    await user.click(screen.getByRole("button", { name: "Scan for BUY signals" }));

    const results = await screen.findByRole("table", { name: "Scan results" });
    expect(within(results).getByText("RELIANCE")).toBeInTheDocument();
    expect(within(results).getByText("TCS")).toBeInTheDocument();
    expect(within(results).getByText("No completed-candle BUY signal")).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      instruments: FIRST_PARSE.instruments,
      timeframe: "1h",
    });

    await user.upload(input, new File(["Symbol\nINFY"], "replacement.csv", { type: "text/csv" }));
    await screen.findByText("1 valid instrument");
    expect(screen.queryByRole("table", { name: "Scan results" })).not.toBeInTheDocument();
    expect(screen.getByText("Ready to scan 1 instrument.")).toBeInTheDocument();
  });

  it("focuses a plain-language error summary when parsing fails", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: "A CSV file is required" }, 400),
    );
    render(<ScanForm />);

    await user.upload(
      screen.getByLabelText("Upload stock list"),
      new File(["not,csv"], "broken.csv", { type: "text/csv" }),
    );

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("We couldn't load that stock list.");
    expect(error).toHaveTextContent("A CSV file is required");
    await waitFor(() => expect(error).toHaveFocus());
    expect(screen.getByRole("button", { name: "Scan for BUY signals" })).toBeDisabled();
  });

  it("posts all visible rows to the export API and downloads the returned CSV", async () => {
    const user = userEvent.setup();
    const csv = "symbol,status\r\nRELIANCE,BUY\r\nTCS,NO_SIGNAL";
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(FIRST_PARSE))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            { symbol: "RELIANCE", status: "BUY", recommendation: BUY },
            { symbol: "TCS", status: "NO_SIGNAL" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Response(csv, {
          headers: {
            "content-type": "text/csv",
            "content-disposition": 'attachment; filename="scan-results.csv"',
          },
        }),
      );
    const createObjectURL = vi.fn(() => "blob:scan-results");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ScanForm />);

    await user.upload(
      screen.getByLabelText("Upload stock list"),
      new File(["Symbol\nRELIANCE\nTCS"], "stocks.csv", { type: "text/csv" }),
    );
    await screen.findByText("2 valid instruments");
    await user.click(screen.getByRole("button", { name: "Scan for BUY signals" }));
    await screen.findByRole("table", { name: "Scan results" });
    await user.click(screen.getByRole("button", { name: "Export results" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/scans/export");
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      results: [
        { symbol: "RELIANCE", status: "BUY", recommendation: BUY },
        { symbol: "TCS", status: "NO_SIGNAL" },
      ],
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:scan-results");
  });
});
