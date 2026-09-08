import * as stylex from "@stylexjs/stylex";
import type { AccentColor } from "../domain/settings";

type PaletteKey =
  | "canvas"
  | "panel"
  | "elevated"
  | "border"
  | "text"
  | "muted"
  | "danger"
  | "codeKeyword"
  | "codeString"
  | "codeNumber"
  | "codeFunction"
  | "codeType"
  | "codeProperty";

export const LIGHT_PALETTE: Record<PaletteKey, string> = {
  canvas: "#fbfaf6",
  panel: "#f5f3ee",
  elevated: "#fffefb",
  border: "#e7e3db",
  text: "#292a27",
  muted: "#8c8982",
  danger: "#c94c41",
  codeKeyword: "#8a4e30",
  codeString: "#2d7a56",
  codeNumber: "#b56a16",
  codeFunction: "#3d5f8f",
  codeType: "#6a548f",
  codeProperty: "#5c6848",
};

export const DARK_PALETTE: Record<PaletteKey, string> = {
  canvas: "#171714",
  panel: "#1d1d1a",
  elevated: "#24241f",
  border: "#37362f",
  text: "#f0eee8",
  muted: "#a5a198",
  danger: "#ef766b",
  codeKeyword: "#e0a57a",
  codeString: "#86c4a4",
  codeNumber: "#e0b36a",
  codeFunction: "#8fb0dd",
  codeType: "#b7a3dd",
  codeProperty: "#b3c49a",
};

export const ACCENT_COLORS: Record<AccentColor, string> = {
  ink: "#343532",
  coral: "#d65f4d",
  blue: "#3f7edb",
  green: "#3e9b73",
  gold: "#b98b09",
  violet: "#8a65d1",
  slate: "#607287",
};

const LIGHT_ACCENT_SOFT: Record<AccentColor, string> = {
  ink: "#e7e5df",
  coral: "#f6e3de",
  blue: "#e7effb",
  green: "#e5f3ed",
  gold: "#f8f0d6",
  violet: "#eee8f9",
  slate: "#e9edf1",
};

export const colors = stylex.defineVars({
  ...LIGHT_PALETTE,
});

export const accents = stylex.defineVars({
  primary: ACCENT_COLORS.ink,
  soft: LIGHT_ACCENT_SOFT.ink,
  contrast: "#ffffff",
});

export const typography = stylex.defineVars({
  uiFont:
    'Inter, "SF Pro Text", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  monoFont:
    '"SFMono-Regular", "Cascadia Code", "Roboto Mono", Menlo, Monaco, Consolas, "PingFang SC", "Microsoft YaHei", ui-monospace, monospace',
  serifFont: 'ui-serif, "Songti SC", STSong, Georgia, serif',
  bodySize: "15px" as string,
  lineHeight: "1.8" as string,
});

export const motion = stylex.defineVars({
  standard: "160ms",
  fast: "140ms",
  ease: "cubic-bezier(0.22, 1, 0.36, 1)",
});

export const layout = stylex.defineVars({
  windowInset: "8px",
});

export const media = stylex.defineConsts({
  mobile: "@media (max-width: 760px)",
  narrow: "@media (max-width: 560px)",
  medium: "@media (max-width: 980px)",
  reducedMotion: "@media (prefers-reduced-motion: reduce)",
});

export const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

export const noticeIn = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-6px)" },
  to: { opacity: 1, transform: "none" },
});

export const commonStyles = stylex.create({
  fadeIn: {
    animationDuration: motion.fast,
    animationTimingFunction: motion.ease,
    animationFillMode: "both",
    animationName: {
      default: fadeIn,
      [media.reducedMotion]: "none",
    },
  },
  noticeIn: {
    animationDuration: "180ms",
    animationTimingFunction: motion.ease,
    animationFillMode: "both",
    animationName: {
      default: noticeIn,
      [media.reducedMotion]: "none",
    },
  },
});

export const lightTheme = stylex.createTheme(colors, LIGHT_PALETTE);
export const darkTheme = stylex.createTheme(colors, DARK_PALETTE);

const lightAccentInk = stylex.createTheme(accents, {
  primary: ACCENT_COLORS.ink,
  soft: LIGHT_ACCENT_SOFT.ink,
  contrast: "#ffffff",
});
const lightAccentCoral = stylex.createTheme(accents, {
  primary: ACCENT_COLORS.coral,
  soft: LIGHT_ACCENT_SOFT.coral,
  contrast: "#ffffff",
});
const lightAccentBlue = stylex.createTheme(accents, {
  primary: ACCENT_COLORS.blue,
  soft: LIGHT_ACCENT_SOFT.blue,
  contrast: "#ffffff",
});
const lightAccentGreen = stylex.createTheme(accents, {
  primary: ACCENT_COLORS.green,
  soft: LIGHT_ACCENT_SOFT.green,
  contrast: "#ffffff",
});
const lightAccentGold = stylex.createTheme(accents, {
  primary: ACCENT_COLORS.gold,
  soft: LIGHT_ACCENT_SOFT.gold,
  contrast: "#ffffff",
});
const lightAccentViolet = stylex.createTheme(accents, {
  primary: ACCENT_COLORS.violet,
  soft: LIGHT_ACCENT_SOFT.violet,
  contrast: "#ffffff",
});
const lightAccentSlate = stylex.createTheme(accents, {
  primary: ACCENT_COLORS.slate,
  soft: LIGHT_ACCENT_SOFT.slate,
  contrast: "#ffffff",
});

const darkAccentInk = stylex.createTheme(accents, {
  primary: "#efede7",
  soft: "#393832",
  contrast: "#171715",
});
const darkAccentCoral = stylex.createTheme(accents, {
  primary: ACCENT_COLORS.coral,
  soft: `color-mix(in srgb, ${ACCENT_COLORS.coral} 25%, ${colors.panel})`,
  contrast: "#171715",
});
const darkAccentBlue = stylex.createTheme(accents, {
  primary: ACCENT_COLORS.blue,
  soft: `color-mix(in srgb, ${ACCENT_COLORS.blue} 25%, ${colors.panel})`,
  contrast: "#171715",
});
const darkAccentGreen = stylex.createTheme(accents, {
  primary: ACCENT_COLORS.green,
  soft: `color-mix(in srgb, ${ACCENT_COLORS.green} 25%, ${colors.panel})`,
  contrast: "#171715",
});
const darkAccentGold = stylex.createTheme(accents, {
  primary: ACCENT_COLORS.gold,
  soft: `color-mix(in srgb, ${ACCENT_COLORS.gold} 25%, ${colors.panel})`,
  contrast: "#171715",
});
const darkAccentViolet = stylex.createTheme(accents, {
  primary: ACCENT_COLORS.violet,
  soft: `color-mix(in srgb, ${ACCENT_COLORS.violet} 25%, ${colors.panel})`,
  contrast: "#171715",
});
const darkAccentSlate = stylex.createTheme(accents, {
  primary: ACCENT_COLORS.slate,
  soft: `color-mix(in srgb, ${ACCENT_COLORS.slate} 25%, ${colors.panel})`,
  contrast: "#171715",
});

export const accentThemes = {
  light: {
    ink: lightAccentInk,
    coral: lightAccentCoral,
    blue: lightAccentBlue,
    green: lightAccentGreen,
    gold: lightAccentGold,
    violet: lightAccentViolet,
    slate: lightAccentSlate,
  },
  dark: {
    ink: darkAccentInk,
    coral: darkAccentCoral,
    blue: darkAccentBlue,
    green: darkAccentGreen,
    gold: darkAccentGold,
    violet: darkAccentViolet,
    slate: darkAccentSlate,
  },
} as const;

export const documentMarker = stylex.defaultMarker();

export const documentStyles = stylex.create({
  root: {
    fontFamily: typography.uiFont,
    colorScheme: "light",
    fontSynthesis: "none",
    textRendering: "optimizeLegibility",
    WebkitFontSmoothing: "antialiased",
  },
  dark: {
    colorScheme: "dark",
  },
  pureBackground: {
    [colors.canvas]: colors.elevated,
  },
  appearance: (bodySize: string, lineHeight: string) => ({
    [typography.bodySize]: bodySize,
    [typography.lineHeight]: lineHeight,
  }),
  compatibilityVariables: {
    "--memoir-canvas": colors.canvas,
    "--memoir-panel": colors.panel,
    "--memoir-elevated": colors.elevated,
    "--memoir-border": colors.border,
    "--memoir-text": colors.text,
    "--memoir-muted": colors.muted,
    "--memoir-accent": accents.primary,
    "--memoir-accent-soft": accents.soft,
    "--memoir-accent-contrast": accents.contrast,
    "--memoir-danger": colors.danger,
    "--memoir-mono-font": typography.monoFont,
    "--memoir-body-size": typography.bodySize,
    "--memoir-line-height": typography.lineHeight,
    "--memoir-motion": motion.standard,
    "--memoir-motion-fast": motion.fast,
    "--memoir-ease": motion.ease,
    "--memoir-window-inset": layout.windowInset,
    "--memoir-code-keyword": colors.codeKeyword,
    "--memoir-code-string": colors.codeString,
    "--memoir-code-number": colors.codeNumber,
    "--memoir-code-fn": colors.codeFunction,
    "--memoir-code-type": colors.codeType,
    "--memoir-code-prop": colors.codeProperty,
  },
});
