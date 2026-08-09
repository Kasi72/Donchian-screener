export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "reversal-radar:theme:v1";

export function getThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  if (preference === "system") {
    return systemDark ? "dark" : "light";
  }
  return preference;
}

export const THEME_BOOTSTRAP = `
(function () {
  var preference = "system";
  try {
    var storedPreference = window.localStorage.getItem("${THEME_STORAGE_KEY}");
    if (storedPreference === "light" || storedPreference === "dark" || storedPreference === "system") {
      preference = storedPreference;
    }
  } catch (_error) {}

  var systemDark = false;
  try {
    systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (_error) {}

  var theme = preference === "system" ? (systemDark ? "dark" : "light") : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
`;
