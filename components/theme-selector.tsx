"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import {
  getThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme/theme";

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";
const THEME_OPTIONS = ["light", "dark", "system"] as const;

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
  const radioRefs = useRef<Record<ThemePreference, HTMLInputElement | null>>({
    light: null,
    dark: null,
    system: null,
  });

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

  function handleRadioKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    currentPreference: ThemePreference,
  ) {
    const currentIndex = THEME_OPTIONS.indexOf(currentPreference);
    let nextIndex: number | undefined;

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % THEME_OPTIONS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = THEME_OPTIONS.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextPreference = THEME_OPTIONS[nextIndex];
    selectTheme(nextPreference);
    radioRefs.current[nextPreference]?.focus();
  }

  return (
    <div className="theme-selector" role="radiogroup" aria-label="Theme">
      {THEME_OPTIONS.map((option) => (
        <label
          className="theme-option"
          data-selected={preference === option}
          key={option}
        >
          <input
            checked={preference === option}
            className="visually-hidden"
            ref={(element) => {
              radioRefs.current[option] = element;
            }}
            name="theme-preference"
            onChange={() => selectTheme(option)}
            onKeyDown={(event) => handleRadioKeyDown(event, option)}
            type="radio"
            value={option}
          />
          {option.charAt(0).toUpperCase() + option.slice(1)}
        </label>
      ))}
    </div>
  );
}
