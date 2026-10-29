// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BrandMark } from "@/components/brand-mark";

describe("BrandMark", () => {
  it("has an accessible label and trace animation hook", () => {
    render(<BrandMark />);

    expect(screen.getByRole("img", { name: "Donchian Reversal Screener mark" })).toBeInTheDocument();
    expect(document.querySelector(".brand-mark__trace")).toBeInTheDocument();
  });
});
