import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const FIVE_COLUMN_CSV = `Company Name,Industry,Symbol,Series,ISIN Code
Reliance Industries Ltd,Energy,RELIANCE,EQ,INE002A01018
Tata Consultancy Services,IT Services,TCS,EQ,INE467B01029
Broken Feed Ltd,Testing,BROKEN,EQ,INE000X01000
Reliance Industries Duplicate,Energy,RELIANCE,EQ,INE002A01018
Nifty Alternate Series,Index,NIFTY,BE,INE000000000`;

const REPLACEMENT_CSV = `Company Name,Industry,Symbol,Series,ISIN Code
Infosys Ltd,IT Services,INFY,EQ,INE009A01021`;

const CSV_HEADER =
  "symbol,yahooSymbol,timeframe,status,recommendation,signalTime,autoPeriod,probability,entry,stop,target1,target2,currentLdc,previousLdc,signalLow,signalClose,signalOpen,signalHigh,currentLdcTick,previousLdcTick,signalLowTick,signalCandleTime,windowStartTime,windowEndTime,previousWindowStartTime,previousWindowEndTime,providerAsOf,rolloverTicks,touchDistanceTicks,periodCandidateCount,periodAudit,windowAudit,anchorIndex,anchorBarsAgo,anchorTime,strategyVersion,dataAsOf,adjustmentMode,tickSize,tickPolicy,reactionHigh,rewardRisk,scoreVersion,score,higherTimeframeInput,confirmationVersion,confirmationScore,confirmationGrade,closeLocation,lowerWickRatio,atrRecovery,volumeZScore,changePointScore,validPeriodCount,validPeriodMin,validPeriodMax,confirmationReasons,anchorRationale,companyName,industry,message";
const RELIANCE_PERIOD_AUDIT_CSV_CELL =
  '"[{""period"":12,""currentLdc"":95.02,""previousLdc"":95.02,""currentLdcTick"":9502,""previousLdcTick"":9502,""signalLowTick"":9502,""touchPassed"":true,""rolloverPassed"":false,""valid"":false},{""period"":13,""currentLdc"":95.02,""previousLdc"":95.02,""currentLdcTick"":9502,""previousLdcTick"":9502,""signalLowTick"":9502,""touchPassed"":true,""rolloverPassed"":false,""valid"":false},{""period"":14,""currentLdc"":95.02,""previousLdc"":90,""currentLdcTick"":9502,""previousLdcTick"":9000,""signalLowTick"":9502,""touchPassed"":true,""rolloverPassed"":true,""valid"":true},{""period"":15,""currentLdc"":90,""previousLdc"":90,""currentLdcTick"":9000,""previousLdcTick"":9000,""signalLowTick"":9502,""touchPassed"":false,""rolloverPassed"":false,""valid"":false},{""period"":16,""currentLdc"":90,""previousLdc"":90,""currentLdcTick"":9000,""previousLdcTick"":9000,""signalLowTick"":9502,""touchPassed"":false,""rolloverPassed"":false,""valid"":false}]"';
const RELIANCE_CSV_ROW =
  `RELIANCE,RELIANCE.NS,1h,BUY,BUY,1786095900000,14,,102,94.52,109.48,116.96,95.02,90,95.02,102,102,108,9502,9000,9502,1786095900000,1785987900000,1786095900000,1785923100000,1786092300000,1786095900000,502,0,1,${RELIANCE_PERIOD_AUDIT_CSV_CELL},,85,14,1785923100000,rules-v1,1786095900000,RAW,0.01,nse-cm-price-band-2025-v1,116,1.8716577540106951,structural-v1,0.7895,NEUTRAL_UNAVAILABLE,confirmation-v1,56,CORE_ONLY,0.5377503852080124,0.5377503852080124,1.3968572300566466,,0,1,14,14,signal low is aligned with the selected lower channel; lower-wick rejection is substantial; recovered at least 0.5 ATR from the low,\"Selected confirmed pivot low 14 bars earlier: prominence 5.36 ATR, recovery 7.74 ATR, structural-v1 score 0.7895. Higher-timeframe input is unavailable and contributes a neutral zero.\",Reliance Industries Ltd,Energy,`;
const EMPTY_RESULT_FIELDS = () => Array(CSV_HEADER.split(",").length - 1).fill("");
const TCS_CSV_ROW = ["TCS", "", "", "NO_SIGNAL", ...Array(CSV_HEADER.split(",").length - 4).fill("")].join(",");
const BROKEN_CSV_ROW = ["BROKEN", "", "", "PROVIDER_ERROR", ...Array(CSV_HEADER.split(",").length - 5).fill(""), "Market data provider failed for BROKEN."].join(",");

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

async function readDownloadedCsv(page: Page, buttonName: string, filename: string): Promise<string> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(filename);
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  return readFile(downloadedPath!, "utf8");
}

async function borderContrastRatios(page: Page, selector: string): Promise<{ inside: number; outside: number }> {
  return page.locator(selector).first().evaluate((element) => {
    const styles = getComputedStyle(element);
    const rgb = (value: string): [number, number, number] => {
      const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) {
        throw new Error(`Could not parse computed color: ${value}`);
      }
      return channels as [number, number, number];
    };
    const luminance = (value: string): number => {
      const channels = rgb(value).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrast = (first: string, second: string): number => {
      const firstLuminance = luminance(first);
      const secondLuminance = luminance(second);
      return (Math.max(firstLuminance, secondLuminance) + 0.05)
        / (Math.min(firstLuminance, secondLuminance) + 0.05);
    };
    const nearestOpaqueBackground = (): string => {
      let ancestor = element.parentElement;
      while (ancestor) {
        const background = getComputedStyle(ancestor).backgroundColor;
        const channels = background.match(/[\d.]+/g)?.map(Number) ?? [];
        if ((channels[3] ?? 1) > 0) {
          return background;
        }
        ancestor = ancestor.parentElement;
      }
      return getComputedStyle(document.documentElement).backgroundColor;
    };
    return {
      inside: contrast(styles.borderTopColor, styles.backgroundColor),
      outside: contrast(styles.borderTopColor, nearestOpaqueBackground()),
    };
  });
}

test("persists an explicit dark theme and follows the system color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  const root = page.locator("html");
  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
  await expect(root).toHaveAttribute("data-theme", "light");

  await page.getByText("Dark", { exact: true }).click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expect(root).toHaveAttribute("data-theme", "dark");

  await page.getByText("System", { exact: true }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "dark");
});

test("keeps control borders at 3:1 contrast in light and dark themes", async ({ page }) => {
  await page.goto("/");
  await uploadPrimaryUniverse(page);
  await scanAtOneHour(page);

  const selectors = [
    ".theme-option[data-selected=\"true\"]",
    ".theme-option[data-selected=\"false\"]",
    ".field select",
    ".results-toolbar input",
    ".table-action",
  ];

  for (const theme of ["Light", "Dark"] as const) {
    await page.getByText(theme, { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.toLowerCase());
    for (const selector of selectors) {
      const ratios = await borderContrastRatios(page, selector);
      expect(ratios.inside, `${theme} ${selector} inside`).toBeGreaterThanOrEqual(3);
      expect(ratios.outside, `${theme} ${selector} outside`).toBeGreaterThanOrEqual(3);
    }
  }
});

test("completes the deterministic mixed-result flow and exports its exact CSV", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Donchian Reversal Screener | Dr KKR");
  await expect(
    page.getByRole("heading", { name: "Donchian Reversal Screener" }),
  ).toBeVisible();
  await expect(page.getByText("by Dr KKR")).toBeVisible();

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
  await expect(buyRow).toContainText("₹94.52");
  await expect(buyRow).toContainText("₹109.48");
  await expect(buyRow).toContainText("₹116.96");
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
  await expect(details).toContainText("Current Donchian low₹95.02");
  await expect(details).toContainText("Previous Donchian low₹90.00");
  await expect(details).toContainText("Strategy versionrules-v1");

  const downloadedCsv = await readDownloadedCsv(
    page,
    "Export filtered (3)",
    "scan-results-filtered.csv",
  );
  expect(downloadedCsv).toBe(
    [CSV_HEADER, RELIANCE_CSV_ROW, TCS_CSV_ROW, BROKEN_CSV_ROW].join("\r\n"),
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
  await expect(page.getByRole("button", { name: "Export filtered (0)" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export selected (0)" })).toBeDisabled();
  await expect(page.getByText("Ready to scan 1 instrument.")).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("sorts, combines filters, preserves details, and exports the intended rows", async ({
  page,
}) => {
  await page.goto("/");
  await uploadPrimaryUniverse(page);
  await scanAtOneHour(page);

  const table = page.getByRole("table", { name: "Scan results" });
  const instrumentSort = page.getByRole("button", { name: "Sort by Instrument" });
  const instrumentHeader = instrumentSort.locator("xpath=..");
  const instruments = table.locator("tbody > tr:not(.details-row) > .instrument-column");

  const category = page.getByRole("combobox", { name: "Show", exact: true });
  await category.selectOption("BUY");
  await expect(instruments).toHaveText(["RELIANCE"]);
  await expect(page.getByRole("button", { name: "Export filtered (1)" })).toBeEnabled();
  await category.selectOption("NO_SIGNAL");
  await expect(instruments).toHaveText(["TCS"]);
  await category.selectOption("DATA_ISSUE");
  await expect(instruments).toHaveText(["BROKEN"]);
  await category.selectOption("ALL");
  await expect(instruments).toHaveText(["RELIANCE", "TCS", "BROKEN"]);

  await page.getByLabel("Status filter").fill("BUY");
  await expect(instruments).toHaveText(["RELIANCE"]);
  await page.getByRole("button", { name: "Clear table filters" }).click();

  await instrumentSort.click();
  await expect(instrumentHeader).toHaveAttribute("aria-sort", "ascending");
  await expect(instruments).toHaveText(["BROKEN", "RELIANCE", "TCS"]);
  await instrumentSort.click();
  await expect(instrumentHeader).toHaveAttribute("aria-sort", "descending");
  await expect(instruments).toHaveText(["TCS", "RELIANCE", "BROKEN"]);

  await page
    .getByRole("button", { name: "Show calculation details for RELIANCE" })
    .click();
  const details = page.getByRole("region", { name: "Calculation details for RELIANCE" });
  await expect(details).toBeVisible();
  expect(
    await details.evaluate(
      (element) => element.closest("tr")?.previousElementSibling?.textContent?.includes("RELIANCE"),
    ),
  ).toBe(true);

  await page.getByLabel("Instrument filter").fill("reli");
  await page.getByLabel("Status filter").fill("buy");
  await page.getByLabel("Minimum Entry").fill("100");
  await page.getByLabel("Maximum Entry").fill("103");
  await page.getByLabel("Data as of from").fill("2026-08-07");
  await page.getByLabel("Data as of to").fill("2026-08-07");
  await expect(instruments).toHaveText(["RELIANCE"]);
  await expect(page.getByText("1 result visible", { exact: true })).toBeVisible();

  await page.getByRole("checkbox", { name: "Select RELIANCE" }).check();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear table filters" }).click();
  await page.getByLabel("Instrument filter").fill("BROKEN");
  await expect(instruments).toHaveText(["BROKEN"]);

  const selectAllVisible = page.getByRole("checkbox", { name: "Select all visible results" });
  await expect(selectAllVisible).not.toBeChecked();
  await expect(selectAllVisible).toHaveJSProperty("indeterminate", false);

  await page.getByRole("button", { name: "Clear table filters" }).click();
  await expect(selectAllVisible).not.toBeChecked();
  await expect(selectAllVisible).toHaveJSProperty("indeterminate", true);
  await page.getByLabel("Instrument filter").fill("BROKEN");
  await expect(selectAllVisible).not.toBeChecked();
  await expect(selectAllVisible).toHaveJSProperty("indeterminate", false);

  await selectAllVisible.check();
  await expect(selectAllVisible).toBeChecked();
  await expect(selectAllVisible).toHaveJSProperty("indeterminate", false);
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  await selectAllVisible.uncheck();
  await expect(selectAllVisible).not.toBeChecked();
  await expect(selectAllVisible).toHaveJSProperty("indeterminate", false);
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await selectAllVisible.check();
  await expect(selectAllVisible).toBeChecked();
  await expect(selectAllVisible).toHaveJSProperty("indeterminate", false);
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();

  const selectedCsv = await readDownloadedCsv(
    page,
    "Export selected (2)",
    "scan-results-selected.csv",
  );
  expect(selectedCsv).toBe([CSV_HEADER, RELIANCE_CSV_ROW, BROKEN_CSV_ROW].join("\r\n"));

  const filteredCsv = await readDownloadedCsv(
    page,
    "Export filtered (1)",
    "scan-results-filtered.csv",
  );
  expect(filteredCsv).toBe([CSV_HEADER, BROKEN_CSV_ROW].join("\r\n"));

  await page.getByRole("button", { name: "Clear table filters" }).click();
  await page.getByText("Dark", { exact: true }).click();
  await page.screenshot({
    fullPage: true,
    path: resolve(
      ".superpowers/sdd/2026-08-09-dark-sortable-selectable-results/desktop-dark.png",
    ),
  });

  expect((await instrumentSort.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect((await page.getByLabel("Instrument filter").boundingBox())?.height).toBeGreaterThanOrEqual(
    44,
  );
  expect(
    (await page.getByRole("button", { name: "Clear table filters" }).boundingBox())?.height,
  ).toBeGreaterThanOrEqual(44);
  const selectAllTarget = selectAllVisible.locator("xpath=ancestor::label");
  expect((await selectAllTarget.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    table: (() => {
      const region = document.querySelector<HTMLElement>(".table-scroll");
      return region !== null && region.scrollWidth > region.clientWidth;
    })(),
  }));
  expect(overflow).toEqual({ document: false, table: false });
});

test("keeps mobile controls, summary, results, and model explanation in rendered order", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await uploadPrimaryUniverse(page);
  await scanAtOneHour(page);
  const table = page.getByRole("table", { name: "Scan results" });

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

  const tableScroll = page.getByRole("region", { name: "Scrollable scan results" });
  await tableScroll.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const selectionColumnBox = await table
    .locator("thead .selection-column")
    .boundingBox();
  const instrumentColumnBox = await table
    .locator("thead .instrument-column")
    .boundingBox();
  expect(instrumentColumnBox!.x).toBeGreaterThanOrEqual(
    selectionColumnBox!.x + selectionColumnBox!.width,
  );
  await tableScroll.evaluate((element) => {
    element.scrollLeft = 0;
  });

  const rejectedRowsTarget = await page
    .getByText("Review rejected rows", { exact: true })
    .boundingBox();
  expect(rejectedRowsTarget?.height).toBeGreaterThanOrEqual(44);

  const detailsTarget = await page
    .getByRole("button", { name: "Show calculation details for RELIANCE" })
    .boundingBox();
  expect(detailsTarget?.height).toBeGreaterThanOrEqual(44);

  await page.screenshot({
    fullPage: true,
    path: resolve(
      ".superpowers/sdd/2026-08-09-dark-sortable-selectable-results/mobile-390px.png",
    ),
  });
});
