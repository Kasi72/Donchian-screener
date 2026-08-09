// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getThemePreference,
  resolveTheme,
  THEME_BOOTSTRAP,
  THEME_STORAGE_KEY,
} from "@/lib/theme/theme";

describe("theme preferences", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("keeps each supported stored preference", () => {
    expect(getThemePreference("light")).toBe("light");
    expect(getThemePreference("dark")).toBe("dark");
    expect(getThemePreference("system")).toBe("system");
    expect(THEME_STORAGE_KEY).toBe("reversal-radar:theme:v1");
  });

  it("falls back to System for malformed storage values", () => {
    expect(getThemePreference(null)).toBe("system");
    expect(getThemePreference("sepia")).toBe("system");
    expect(getThemePreference({ preference: "dark" })).toBe("system");
  });

  it("resolves System using the current media-query state", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("keeps explicit preferences independent of the system setting", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("bootstraps the resolved System theme before hydration", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "not-a-theme");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));

    new Function(THEME_BOOTSTRAP)();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
