// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  adjustmentMode: "BACK_ADJUSTED",
  tickSize: 0.05,
  tickPolicy: "nse-cm-legacy-0.05-v1",
  reactionHigh: 1450,
  rewardRisk: 2,
  scoreVersion: "structural-v1",
  score: 0.5705,
  scoreComponents: { prominence: 0.5, recovery: 0.5, recency: 0.5, retests: 0.5, relativeVolume: 0.5, higherTimeframeAgreement: 0 },
  higherTimeframeInput: "NEUTRAL_UNAVAILABLE",
  anchorRationale: "Confirmed structural pivot selected causally.",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("ScanForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows parsing progress without showing empty or ready copy", async () => {
    const user = userEvent.setup();
    const pendingParse = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pendingParse.promise);
    render(<ScanForm />);

    await user.upload(
      screen.getByLabelText("Upload stock list"),
      new File(["Symbol\nRELIANCE"], "stocks.csv", { type: "text/csv" }),
    );

    expect(screen.getByText("Checking the stock list…")).toBeInTheDocument();
    expect(screen.queryByText("Upload a stock list to begin.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Ready to scan/)).not.toBeInTheDocument();
  });

  it("shows scanning progress without showing ready copy", async () => {
    const user = userEvent.setup();
    const pendingScan = deferred<Response>();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(FIRST_PARSE))
      .mockReturnValueOnce(pendingScan.promise);
    render(<ScanForm />);

    await user.upload(
      screen.getByLabelText("Upload stock list"),
      new File(["Symbol\nRELIANCE\nTCS"], "stocks.csv", { type: "text/csv" }),
    );
    await screen.findByText("2 valid instruments");
    await user.click(screen.getByRole("button", { name: "Scan for BUY signals" }));

    expect(screen.getByText("Scanning 2 instruments…")).toBeInTheDocument();
    expect(screen.queryByText(/Ready to scan/)).not.toBeInTheDocument();
    expect(screen.queryByText("Upload a stock list to begin.")).not.toBeInTheDocument();
  });

  it("lets the user cancel an active scan and return to the ready state", async () => {
    const user = userEvent.setup();
    const pendingScan = deferred<Response>();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(FIRST_PARSE))
      .mockReturnValueOnce(pendingScan.promise);
    render(<ScanForm />);

    await user.upload(
      screen.getByLabelText("Upload stock list"),
      new File(["Symbol\nRELIANCE\nTCS"], "stocks.csv", { type: "text/csv" }),
    );
    await screen.findByText("2 valid instruments");
    await user.click(screen.getByRole("button", { name: "Scan for BUY signals" }));
    await user.click(screen.getByRole("button", { name: "Cancel scan" }));

    expect(screen.queryByText("Scanning 2 instruments…")).not.toBeInTheDocument();
    expect(screen.getByText("Ready to scan 2 instruments.")).toBeInTheDocument();
  });

  it("clears results and disables export when the timeframe changes", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(FIRST_PARSE))
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ symbol: "TCS", status: "NO_SIGNAL" }] }),
      );
    render(<ScanForm />);

    await user.upload(
      screen.getByLabelText("Upload stock list"),
      new File(["Symbol\nRELIANCE\nTCS"], "stocks.csv", { type: "text/csv" }),
    );
    await screen.findByText("2 valid instruments");
    await user.click(screen.getByRole("button", { name: "Scan for BUY signals" }));
    await screen.findByRole("table", { name: "Scan results" });
    expect(screen.getByText("Scan complete: 0 BUY signals across 1 result.")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select TCS" }));
    expect(screen.getByRole("button", { name: "Export selected (1)" })).toBeEnabled();

    await user.selectOptions(screen.getByLabelText("Candle timeframe"), "1h");

    expect(screen.queryByRole("table", { name: "Scan results" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Scan complete:/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export filtered (0)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export selected (0)" })).toBeDisabled();
    expect(screen.getByText("Ready to scan 2 instruments.")).toBeInTheDocument();
  });

  it("lets a newer upload supersede an older parse response", async () => {
    const user = userEvent.setup();
    const oldParse = deferred<Response>();
    vi.mocked(fetch)
      .mockReturnValueOnce(oldParse.promise)
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
    await user.upload(input, new File(["Symbol\nRELIANCE"], "older.csv", { type: "text/csv" }));
    expect(input).toBeEnabled();
    await user.upload(input, new File(["Symbol\nINFY"], "newer.csv", { type: "text/csv" }));
    await screen.findByText("1 valid instrument");

    await act(async () => oldParse.resolve(jsonResponse(FIRST_PARSE)));

    expect(screen.getByText("newer.csv")).toBeInTheDocument();
    expect(screen.getByText("1 valid instrument")).toBeInTheDocument();
    expect(screen.queryByText("2 valid instruments")).not.toBeInTheDocument();
  });

  it("lets a replacement upload supersede an in-flight scan", async () => {
    const user = userEvent.setup();
    const oldScan = deferred<Response>();
    const fetchMock = vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/scans") {
        return oldScan.promise;
      }
      const parseCalls = fetchMock.mock.calls.filter(([called]) => String(called) === "/api/universe/parse").length;
      return Promise.resolve(
        parseCalls === 1
          ? jsonResponse(FIRST_PARSE)
          : jsonResponse({
              instruments: [{ symbol: "INFY", yahooSymbol: "INFY.NS" }],
              rejected: [],
              duplicateCount: 0,
              totalRows: 1,
            }),
      );
    });
    render(<ScanForm />);

    const input = screen.getByLabelText("Upload stock list");
    await user.upload(input, new File(["Symbol\nRELIANCE\nTCS"], "older.csv", { type: "text/csv" }));
    await screen.findByText("2 valid instruments");
    await user.click(screen.getByRole("button", { name: "Scan for BUY signals" }));
    expect(input).toBeEnabled();
    await user.upload(input, new File(["Symbol\nINFY"], "newer.csv", { type: "text/csv" }));
    await screen.findByText("1 valid instrument");

    await act(async () =>
      oldScan.resolve(jsonResponse({ results: [{ symbol: "RELIANCE", status: "NO_SIGNAL" }] })),
    );

    expect(screen.queryByRole("table", { name: "Scan results" })).not.toBeInTheDocument();
    expect(screen.getByText("Ready to scan 1 instrument.")).toBeInTheDocument();
  });

  it("lets a replacement upload supersede an in-flight export", async () => {
    const user = userEvent.setup();
    const oldExport = deferred<Response>();
    let parseCount = 0;
    const fetchMock = vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/universe/parse") {
        parseCount += 1;
        return Promise.resolve(
          parseCount === 1
            ? jsonResponse(FIRST_PARSE)
            : jsonResponse({
                instruments: [{ symbol: "INFY", yahooSymbol: "INFY.NS" }],
                rejected: [],
                duplicateCount: 0,
                totalRows: 1,
              }),
        );
      }
      if (url === "/api/scans") {
        return Promise.resolve(jsonResponse({ results: [{ symbol: "TCS", status: "NO_SIGNAL" }] }));
      }
      return oldExport.promise;
    });
    const createObjectURL = vi.fn(() => "blob:stale-export");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    render(<ScanForm />);

    const input = screen.getByLabelText("Upload stock list");
    await user.upload(input, new File(["Symbol\nRELIANCE\nTCS"], "older.csv", { type: "text/csv" }));
    await screen.findByText("2 valid instruments");
    await user.click(screen.getByRole("button", { name: "Scan for BUY signals" }));
    await screen.findByRole("table", { name: "Scan results" });
    await user.click(screen.getByRole("button", { name: "Export filtered (1)" }));
    expect(input).toBeEnabled();

    await user.upload(input, new File(["Symbol\nINFY"], "newer.csv", { type: "text/csv" }));
    await screen.findByText("1 valid instrument");
    await act(async () => oldExport.resolve(new Response("symbol,status")));

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Scan results" })).not.toBeInTheDocument();
  });

  it("rejects malformed parse JSON with an accessible error", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        instruments: [{ symbol: "RELIANCE" }],
        rejected: [],
        duplicateCount: 0,
        totalRows: 1,
      }),
    );
    render(<ScanForm />);

    await user.upload(
      screen.getByLabelText("Upload stock list"),
      new File(["Symbol\nRELIANCE"], "stocks.csv", { type: "text/csv" }),
    );

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("We couldn't load that stock list.");
    expect(error).toHaveTextContent("The server returned an invalid stock list summary.");
    expect(error).toHaveFocus();
    expect(screen.getByRole("button", { name: "Scan for BUY signals" })).toBeDisabled();
  });

  it("rejects malformed scan rows with an accessible error", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(FIRST_PARSE))
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ symbol: "RELIANCE", status: "ALIEN" }] }),
      );
    render(<ScanForm />);

    await user.upload(
      screen.getByLabelText("Upload stock list"),
      new File(["Symbol\nRELIANCE"], "stocks.csv", { type: "text/csv" }),
    );
    await screen.findByText("2 valid instruments");
    await user.click(screen.getByRole("button", { name: "Scan for BUY signals" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("We couldn't complete this scan.");
    expect(error).toHaveTextContent("The server returned invalid scan results.");
    expect(error).toHaveFocus();
    expect(screen.queryByRole("table", { name: "Scan results" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export filtered (0)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export selected (0)" })).toBeDisabled();
  });

  it("rejects scan timestamps that cannot be rendered", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(FIRST_PARSE))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              symbol: "RELIANCE",
              status: "BUY",
              recommendation: { ...BUY, dataAsOf: Number.MAX_VALUE },
            },
          ],
        }),
      );
    render(<ScanForm />);

    await user.upload(
      screen.getByLabelText("Upload stock list"),
      new File(["Symbol\nRELIANCE"], "stocks.csv", { type: "text/csv" }),
    );
    await screen.findByText("2 valid instruments");
    await user.click(screen.getByRole("button", { name: "Scan for BUY signals" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("We couldn't complete this scan.");
    expect(error).toHaveTextContent("The server returned invalid scan results.");
    expect(screen.queryByRole("table", { name: "Scan results" })).not.toBeInTheDocument();
  });

  it("places scan results before the disabled model explanation in semantic order", () => {
    render(<ScanForm />);

    const results = screen.getByRole("region", { name: "Scan results" });
    const mode = screen.getByRole("group", { name: "Recommendation mode" });
    expect(results.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("starts with an accessible upload flow and disabled unavailable actions", () => {
    render(<ScanForm />);

    expect(screen.getByLabelText("Upload stock list")).toHaveAttribute("accept", ".csv,text/csv");
    expect(screen.getByText("Uploading another file replaces this list.")).toBeInTheDocument();
    expect(screen.getByLabelText("Candle timeframe")).toHaveValue("1d");
    expect(screen.getByRole("button", { name: "Scan for BUY signals" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export filtered (0)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export selected (0)" })).toBeDisabled();
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
    await user.click(screen.getByRole("checkbox", { name: "Select RELIANCE" }));
    expect(screen.getByRole("button", { name: "Export selected (1)" })).toBeEnabled();

    await user.upload(input, new File(["Symbol\nINFY"], "replacement.csv", { type: "text/csv" }));
    await screen.findByText("1 valid instrument");
    expect(screen.queryByRole("table", { name: "Scan results" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export filtered (0)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export selected (0)" })).toBeDisabled();
    expect(screen.getByText("Ready to scan 1 instrument.")).toBeInTheDocument();
  });

  it("clears selected and filtered export projections when a new scan replaces results", async () => {
    const user = userEvent.setup();
    const replacementScan = deferred<Response>();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(FIRST_PARSE))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            { symbol: "RELIANCE", status: "BUY", recommendation: BUY },
            { symbol: "TCS", status: "NO_SIGNAL" },
          ],
        }),
      )
      .mockReturnValueOnce(replacementScan.promise);
    render(<ScanForm />);

    await user.upload(
      screen.getByLabelText("Upload stock list"),
      new File(["Symbol\nRELIANCE\nTCS"], "stocks.csv", { type: "text/csv" }),
    );
    await screen.findByText("2 valid instruments");
    await user.click(screen.getByRole("button", { name: "Scan for BUY signals" }));
    await screen.findByRole("table", { name: "Scan results" });
    await user.click(screen.getByRole("checkbox", { name: "Select RELIANCE" }));
    await user.type(screen.getByLabelText("Instrument filter"), "RELIANCE");
    expect(screen.getByRole("button", { name: "Export filtered (1)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Export selected (1)" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Scan for BUY signals" }));

    expect(screen.getByRole("button", { name: "Export filtered (0)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export selected (0)" })).toBeDisabled();
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

  it("exports only the table's filtered projection and downloads the returned CSV", async () => {
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
    let connectedDuringClick = false;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      connectedDuringClick = this.isConnected;
    });
    render(<ScanForm />);

    await user.upload(
      screen.getByLabelText("Upload stock list"),
      new File(["Symbol\nRELIANCE\nTCS"], "stocks.csv", { type: "text/csv" }),
    );
    await screen.findByText("2 valid instruments");
    await user.click(screen.getByRole("button", { name: "Scan for BUY signals" }));
    await screen.findByRole("table", { name: "Scan results" });
    await user.type(screen.getByLabelText("Instrument filter"), "RELIANCE");
    expect(screen.queryByText("TCS")).not.toBeInTheDocument();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export filtered (1)" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe("/api/scans/export");
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      results: [
        { symbol: "RELIANCE", status: "BUY", recommendation: BUY },
      ],
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(connectedDuringClick).toBe(true);
    expect(document.querySelector('a[download="scan-results-filtered.csv"]')).not.toBeInTheDocument();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:scan-results");
  });

  it("exports hidden selected rows and disables selected export while another export is busy", async () => {
    const user = userEvent.setup();
    const pendingExport = deferred<Response>();
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
      .mockReturnValueOnce(pendingExport.promise)
      .mockResolvedValueOnce(new Response("symbol,status"));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:scan-results"), revokeObjectURL: vi.fn() });
    render(<ScanForm />);

    await user.upload(
      screen.getByLabelText("Upload stock list"),
      new File(["Symbol\nRELIANCE\nTCS"], "stocks.csv", { type: "text/csv" }),
    );
    await screen.findByText("2 valid instruments");
    await user.click(screen.getByRole("button", { name: "Scan for BUY signals" }));
    await screen.findByRole("table", { name: "Scan results" });

    await user.click(screen.getByRole("checkbox", { name: "Select TCS" }));
    await user.type(screen.getByLabelText("Instrument filter"), "RELIANCE");
    expect(screen.queryByText("TCS")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export selected (1)" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Export filtered (1)" }));
    expect(screen.getByRole("button", { name: "Export selected (1)" })).toBeDisabled();
    await act(async () => pendingExport.resolve(new Response("symbol,status")));

    await user.click(screen.getByRole("button", { name: "Export selected (1)" }));
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({
      results: [{ symbol: "TCS", status: "NO_SIGNAL" }],
    });
  });
});
