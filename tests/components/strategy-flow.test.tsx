// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StrategyFlow } from "@/components/strategy-flow";

describe("StrategyFlow", () => {
  it("exposes the causal screening path as an accessible flowchart", () => {
    render(<StrategyFlow />);

    expect(screen.getByRole("region", { name: "How the reversal signal is validated" })).toBeInTheDocument();
    expect(screen.getByText("Upload universe")).toBeInTheDocument();
    expect(screen.getByText("Completed candles")).toBeInTheDocument();
    expect(screen.getByText("Donchian gate")).toBeInTheDocument();
    expect(screen.getByText("Evidence check")).toBeInTheDocument();
    expect(screen.getByText("Actionable BUY")).toBeInTheDocument();
  });
});
