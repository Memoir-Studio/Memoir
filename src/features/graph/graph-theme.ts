export type GraphTheme = {
  canvas: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  accentContrast: string;
  elevated: string;
  border: string;
  dark: boolean;
};

function readCss(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function themeFromCss(): GraphTheme {
  const dark =
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
  return {
    canvas: readCss("--memoir-canvas", dark ? "#171714" : "#fbfaf6"),
    text: readCss("--memoir-text", dark ? "#f0eee8" : "#292a27"),
    muted: readCss("--memoir-muted", dark ? "#a5a198" : "#8c8982"),
    accent: readCss("--memoir-accent", dark ? "#efede7" : "#343532"),
    accentSoft: readCss("--memoir-accent-soft", dark ? "#393832" : "#e7e5df"),
    accentContrast: readCss("--memoir-accent-contrast", dark ? "#171715" : "#ffffff"),
    elevated: readCss("--memoir-elevated", dark ? "#24241f" : "#fffefb"),
    border: readCss("--memoir-border", dark ? "#37362f" : "#e7e3db"),
    dark,
  };
}
