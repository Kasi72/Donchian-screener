// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeSelector } from "@/components/theme-selector";
import { THEME_STORAGE_KEY } from "@/lib/theme/theme";

function createMatchMedia(initiallyDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQueryList = {
    matches: initiallyDark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      }
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      }
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    dispatchEvent: () => true,
  } as MediaQueryList;

  return {
    matchMedia: vi.fn(() => mediaQueryList),
    setDark(isDark: boolean) {
      Object.defineProperty(mediaQueryList, "matches", { configurable: true, value: isDark });
      for (const listener of listeners) {
        listener({ matches: isDark } as MediaQueryListEvent);
      }
    },
  };
}

describe("ThemeSelector", () => {
  let media: ReturnType<typeof createMatchMedia>;

  beforeEach(() => {
    media = createMatchMedia(false);
    vi.stubGlobal("matchMedia", media.matchMedia);
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("exposes Light, Dark, and System as an accessible radio group", () => {
    render(<ThemeSelector />);

    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  });

  it("moves radio selection and focus with Arrow, Home, and End keys", () => {
    render(<ThemeSelector />);

    const light = screen.getByRole("radio", { name: "Light" });
    const dark = screen.getByRole("radio", { name: "Dark" });
    const system = screen.getByRole("radio", { name: "System" });
    system.focus();

    fireEvent.keyDown(system, { key: "Home" });
    expect(light).toBeChecked();
    expect(light).toHaveFocus();

    fireEvent.keyDown(light, { key: "ArrowRight" });
    expect(dark).toBeChecked();
    expect(dark).toHaveFocus();

    fireEvent.keyDown(dark, { key: "End" });
    expect(system).toBeChecked();
    expect(system).toHaveFocus();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("persists an explicit choice and applies it to the document", async () => {
    const user = userEvent.setup();
    render(<ThemeSelector />);

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  it("restores a persisted choice after mounting", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeSelector />);

    await waitFor(() => expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked());
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("falls back to System for a malformed stored value", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    render(<ThemeSelector />);

    await waitFor(() => expect(screen.getByRole("radio", { name: "System" })).toBeChecked());
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("updates the document when the system setting changes in System mode", async () => {
    render(<ThemeSelector />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    media.setDark(true);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("keeps an explicit selection when the system setting changes", async () => {
    const user = userEvent.setup();
    render(<ThemeSelector />);

    await user.click(screen.getByRole("radio", { name: "Light" }));
    media.setDark(true);

    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
