"use client";

import { useEffect, useRef, useState } from "react";

import {
  getThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme/theme";

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

function getStoredPreference(): ThemePreference {
  try {
    return getThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function applyTheme(preference: ThemePreference, systemDark: boolean) {
  const theme = resolveTheme(preference, systemDark);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeSelector() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const hasInitialized = useRef(false);

  useEffect(() => {
    const activePreference = hasInitialized.current ? preference : getStoredPreference();
    hasInitialized.current = true;

    if (activePreference !== preference) {
      setPreference(activePreference);
    }

    const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
    const syncTheme = () => applyTheme(activePreference, mediaQuery.matches);
    syncTheme();

    if (activePreference !== "system") {
      return;
    }

    const handleChange = (event: MediaQueryListEvent) => {
      applyTheme("system", event.matches);
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [preference]);

  function selectTheme(nextPreference: ThemePreference) {
    setPreference(nextPreference);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
    } catch {
      // Theme selection still applies when storage is unavailable.
    }
  }

  return (
    <div className="theme-selector" role="radiogroup" aria-label="Theme">
      {(["light", "dark", "system"] as const).map((option) => (
        <button
          aria-checked={preference === option}
          className="theme-option"
          key={option}
          onClick={() => selectTheme(option)}
          role="radio"
          type="button"
        >
          {option.charAt(0).toUpperCase() + option.slice(1)}
        </button>
      ))}
    </div>
  );
}
