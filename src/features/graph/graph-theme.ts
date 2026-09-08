import type { AppSettings } from "../../domain/settings";
import { ACCENT_COLORS, DARK_PALETTE, LIGHT_PALETTE } from "../../styles/tokens.stylex";

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

type GraphAppearance = Pick<AppSettings["appearance"], "accent" | "theme">;

function systemPrefersDark() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function themeFromAppearance(
  appearance: GraphAppearance,
  systemDark = systemPrefersDark(),
): GraphTheme {
  const dark = appearance.theme === "dark" || (appearance.theme === "system" && systemDark);
  const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;
  const accent = dark && appearance.accent === "ink" ? "#efede7" : ACCENT_COLORS[appearance.accent];

  return {
    canvas: palette.canvas,
    text: palette.text,
    muted: palette.muted,
    accent,
    accentSoft: `color-mix(in srgb, ${accent} ${dark ? 25 : 12}%, ${palette.panel})`,
    accentContrast: dark ? "#171715" : "#ffffff",
    elevated: palette.elevated,
    border: palette.border,
    dark,
  };
}
