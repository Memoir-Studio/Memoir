export type ThemePreference = "system" | "light" | "dark";
export type AccentColor = "ink" | "coral" | "blue" | "green" | "gold" | "violet" | "slate";
export type BackgroundStyle = "paper" | "pure";
export type InterfaceDensity = "comfortable" | "compact";
export type BodyFont = "sans" | "serif";
export type ContentWidth = "narrow" | "standard" | "wide" | "full";
export type ViewMode = "edit" | "split" | "preview";
export type AppLocale = "zh" | "en";
export type LocalePreference = "system" | AppLocale;
export type CloseBehavior = "tray" | "quit";

export const MIN_UI_SCALE = 0.8;
export const MAX_UI_SCALE = 2;
export const DEFAULT_UI_SCALE = 1;

export type AppSettings = {
  appearance: {
    locale: LocalePreference;
    theme: ThemePreference;
    accent: AccentColor;
    background: BackgroundStyle;
    density: InterfaceDensity;
    uiScale: number;
    bodyFont: BodyFont;
    bodyFontSize: number;
    lineHeight: number;
    contentWidth: ContentWidth;
  };
  editor: {
    fontSize: number;
    lineWrapping: boolean;
    lineNumbers: boolean;
    defaultView: ViewMode;
  };
  general: {
    closeBehavior: CloseBehavior;
  };
};

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: {
    locale: "system",
    theme: "system",
    accent: "ink",
    background: "paper",
    density: "comfortable",
    uiScale: DEFAULT_UI_SCALE,
    bodyFont: "sans",
    bodyFontSize: 15,
    lineHeight: 1.8,
    contentWidth: "standard",
  },
  editor: {
    fontSize: 14,
    lineWrapping: true,
    lineNumbers: false,
    defaultView: "split",
  },
  general: {
    closeBehavior: "tray",
  },
};

export function clampUiScale(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_UI_SCALE;
  const stepped = Math.round(numeric * 20) / 20;
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, stepped));
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "system" || value === "zh" || value === "en";
}

export function isCloseBehavior(value: unknown): value is CloseBehavior {
  return value === "tray" || value === "quit";
}

export function mergeSettings(settings?: Partial<AppSettings> | null): AppSettings {
  const appearance = {
    ...DEFAULT_SETTINGS.appearance,
    ...settings?.appearance,
  };
  const general = {
    ...DEFAULT_SETTINGS.general,
    ...settings?.general,
  };
  return {
    appearance: {
      ...appearance,
      uiScale: clampUiScale(appearance.uiScale),
      locale: isLocalePreference(appearance.locale)
        ? appearance.locale
        : DEFAULT_SETTINGS.appearance.locale,
    },
    editor: {
      ...DEFAULT_SETTINGS.editor,
      ...settings?.editor,
    },
    general: {
      ...general,
      closeBehavior: isCloseBehavior(general.closeBehavior)
        ? general.closeBehavior
        : DEFAULT_SETTINGS.general.closeBehavior,
    },
  };
}
