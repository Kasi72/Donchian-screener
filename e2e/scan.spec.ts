import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const FIVE_COLUMN_CSV = `Company Name,Industry,Symbol,Series,ISIN Code
Reliance Industries Ltd,Energy,RELIANCE,EQ,INE002A01018
Tata Consultancy Services,IT Services,TCS,EQ,INE467B01029
Broken Feed Ltd,Testing,BROKEN,EQ,INE000X01000
Reliance Industries Duplicate,Energy,RELIANCE,EQ,INE002A01018
Nifty Alternate Series,Index,NIFTY,BE,INE000000000`;

const REPLACEMENT_CSV = `Company Name,Industry,Symbol,Series,ISIN Code
Infosys Ltd,IT Services,INFY,EQ,INE009A01021`;

async function uploadPrimaryUniverse(page: Page): Promise<void> {
  await page.getByLabel("Upload stock list").setInputFiles({
    name: "nse-five-column.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(FIVE_COLUMN_CSV),
  });
  await expect(page.getByRole("status", { name: "Stock list summary" })).toContainText(
    "3 valid instruments",
  );
}

async function scanAtOneHour(page: Page): Promise<void> {
  await page.getByLabel("Candle timeframe").selectOption("1h");
  await page.getByRole("button", { name: "Scan for BUY signals" }).click();
  await expect(page.getByText("Scan complete: 1 BUY signal across 3 results.")).toBeVisible();
}

test("completes the deterministic mixed-result flow and exports its exact CSV", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Adaptive Donchian Screener");
  await expect(
    page.getByRole("heading", { name: "Find completed-candle bullish reversals" }),
  ).toBeVisible();

  await uploadPrimaryUniverse(page);
  const summary = page.getByRole("status", { name: "Stock list summary" });
  await expect(summary).toContainText("1 rejected row");
  await expect(summary).toContainText("1 duplicate removed");
  await expect(page.getByText("nse-five-column.csv")).toBeVisible();

  await summary.getByText("Review rejected rows").click();
  await expect(summary).toContainText("Row 6 (NIFTY): Series must be EQ");

  await scanAtOneHour(page);
  const table = page.getByRole("table", { name: "Scan results" });
  await expect(table.getByRole("row")).toHaveCount(4);

  const buyRow = table.getByRole("row").filter({ hasText: "RELIANCE" });
  await expect(buyRow).toContainText("BUY");
  await expect(buyRow).toContainText("₹102.00");
  await expect(buyRow).toContainText("₹94.50");
  await expect(buyRow).toContainText("₹109.50");
  await expect(buyRow).toContainText("₹117.00");
  await expect(buyRow).toContainText("14");
  await expect(buyRow.locator("time")).toHaveText("7 Aug 2026, 3:15 pm");
  await expect(buyRow.locator("time")).toHaveAttribute(
    "datetime",
    "2026-08-07T09:45:00.000Z",
  );

  await expect(table.getByRole("row").filter({ hasText: "TCS" })).toContainText(
    "No completed-candle BUY signal",
  );
  await expect(table.getByRole("row").filter({ hasText: "BROKEN" })).toContainText(
    "Market data provider failed for BROKEN.",
  );

  const detailsButton = page.getByRole("button", {
    name: "Show calculation details for RELIANCE",
  });
  const detailsTarget = await detailsButton.boundingBox();
  expect(detailsTarget?.height).toBeGreaterThanOrEqual(44);
  await detailsButton.click();
  const hideDetailsButton = page.getByRole("button", {
    name: "Hide calculation details for RELIANCE",
  });
  await expect(hideDetailsButton).toHaveAttribute("aria-expanded", "true");
  const details = page.getByRole("region", {
    name: "Calculation details for RELIANCE",
  });
  await expect(details).toContainText("Current Donchian low₹95.01");
  await expect(details).toContainText("Previous Donchian low₹90.00");
  await expect(details).toContainText("Strategy versionrules-v1");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export results" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("scan-results.csv");
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const downloadedCsv = await readFile(downloadedPath!, "utf8");
  expect(downloadedCsv).toBe(
    [
      "symbol,yahooSymbol,timeframe,status,recommendation,signalTime,autoPeriod,probability,entry,stop,target1,target2,currentLdc,previousLdc,anchorTime,strategyVersion,dataAsOf,message",
      "RELIANCE,RELIANCE.NS,1h,BUY,BUY,1786095900000,14,,102,94.5,109.5,117,95.01,90,1785923100000,rules-v1,1786095900000,",
      "TCS,,,NO_SIGNAL,,,,,,,,,,,,,,",
      "BROKEN,,,PROVIDER_ERROR,,,,,,,,,,,,,,Market data provider failed for BROKEN.",
    ].join("\r\n"),
  );

  await page.getByLabel("Upload stock list").setInputFiles({
    name: "replacement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(REPLACEMENT_CSV),
  });
  await expect(page.getByText("replacement.csv")).toBeVisible();
  await expect(page.getByRole("status", { name: "Stock list summary" })).toContainText(
    "1 valid instrument",
  );
  await expect(table).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export results" })).toBeDisabled();
  await expect(page.getByText("Ready to scan 1 instrument.")).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("keeps mobile controls, summary, results, and model explanation in rendered order", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await uploadPrimaryUniverse(page);
  await scanAtOneHour(page);

  const orderedSelectors = [
    ".intro h1",
    ".upload-field",
    ".timeframe-field",
    ".primary-action",
    ".summary-area",
    ".results-area",
    ".mode-control",
  ];
  const semanticOrder = await page
    .locator(orderedSelectors.join(","))
    .evaluateAll(
      (elements, selectors) =>
        elements.map((element) =>
          selectors.find((selector) => element.matches(selector)),
        ),
      orderedSelectors,
    );
  expect(semanticOrder).toEqual(orderedSelectors);

  const renderedTop = await Promise.all(
    orderedSelectors.map(async (selector) => (await page.locator(selector).boundingBox())?.y),
  );
  expect(renderedTop.every((top) => top !== undefined)).toBe(true);
  expect(renderedTop).toEqual([...renderedTop].sort((left, right) => left! - right!));

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    table: (() => {
      const region = document.querySelector<HTMLElement>(".table-scroll");
      return region !== null && region.scrollWidth > region.clientWidth;
    })(),
  }));
  expect(overflow).toEqual({ document: false, table: true });

  const rejectedRowsTarget = await page
    .getByText("Review rejected rows", { exact: true })
    .boundingBox();
  expect(rejectedRowsTarget?.height).toBeGreaterThanOrEqual(44);

  const detailsTarget = await page
    .getByRole("button", { name: "Show calculation details for RELIANCE" })
    .boundingBox();
  expect(detailsTarget?.height).toBeGreaterThanOrEqual(44);
});
