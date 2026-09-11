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
export type NoteSortField = "name" | "modified" | "title";
export type NoteSortDirection = "asc" | "desc";
export type AiProvider = "openai" | "ollama" | "custom";
export type SettingsSection = "general" | "appearance" | "editor" | "ai" | "about";

export const MIN_UI_SCALE = 0.8;
export const MAX_UI_SCALE = 2;
export const DEFAULT_UI_SCALE = 1;
export const MIN_AI_CONTEXT_MAX_LENGTH = 1_000;
export const MAX_AI_CONTEXT_MAX_LENGTH = 2_000_000;
export const DEFAULT_AI_CONTEXT_MAX_LENGTH = 256_000;
export const MIN_AI_EMBEDDING_MAX_LENGTH = 100;
export const MAX_AI_EMBEDDING_MAX_LENGTH = 100_000;
export const DEFAULT_AI_EMBEDDING_MAX_LENGTH = 1_800;

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
    noteSort: NoteSortField;
    noteSortDirection: NoteSortDirection;
  };
  ai: {
    enabled: boolean;
    provider: AiProvider;
    baseUrl: string;
    apiKey: string;
    embeddingModel: string;
    rerankingModel: string;
    chatModel: string;
    contextMaxLength: number;
    embeddingMaxLength: number;
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
    noteSort: "name",
    noteSortDirection: "asc",
  },
  ai: {
    enabled: false,
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    embeddingModel: "text-embedding-3-small",
    rerankingModel: "",
    chatModel: "gpt-4o-mini",
    contextMaxLength: DEFAULT_AI_CONTEXT_MAX_LENGTH,
    embeddingMaxLength: DEFAULT_AI_EMBEDDING_MAX_LENGTH,
  },
};

export function clampUiScale(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_UI_SCALE;
  const stepped = Math.round(numeric * 20) / 20;
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, stepped));
}

export function clampAiLength(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "system" || value === "zh" || value === "en";
}

export function isCloseBehavior(value: unknown): value is CloseBehavior {
  return value === "tray" || value === "quit";
}

export function isNoteSortField(value: unknown): value is NoteSortField {
  return value === "name" || value === "modified" || value === "title";
}

export function isNoteSortDirection(value: unknown): value is NoteSortDirection {
  return value === "asc" || value === "desc";
}

export function isAiProvider(value: unknown): value is AiProvider {
  return value === "openai" || value === "ollama" || value === "custom";
}

export function mergeSettings(
  settings?: {
    appearance?: Partial<AppSettings["appearance"]>;
    editor?: Partial<AppSettings["editor"]>;
    general?: Partial<AppSettings["general"]>;
    ai?: Partial<AppSettings["ai"]>;
  } | null,
): AppSettings {
  const appearance = {
    ...DEFAULT_SETTINGS.appearance,
    ...settings?.appearance,
  };
  const general = {
    ...DEFAULT_SETTINGS.general,
    ...settings?.general,
  };
  const ai = {
    ...DEFAULT_SETTINGS.ai,
    ...settings?.ai,
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
      noteSort: isNoteSortField(general.noteSort)
        ? general.noteSort
        : DEFAULT_SETTINGS.general.noteSort,
      noteSortDirection: isNoteSortDirection(general.noteSortDirection)
        ? general.noteSortDirection
        : DEFAULT_SETTINGS.general.noteSortDirection,
    },
    ai: {
      ...ai,
      provider: isAiProvider(ai.provider)
        ? ai.provider
        : DEFAULT_SETTINGS.ai.provider,
      contextMaxLength: clampAiLength(
        ai.contextMaxLength,
        MIN_AI_CONTEXT_MAX_LENGTH,
        MAX_AI_CONTEXT_MAX_LENGTH,
        DEFAULT_AI_CONTEXT_MAX_LENGTH,
      ),
      embeddingMaxLength: clampAiLength(
        ai.embeddingMaxLength,
        MIN_AI_EMBEDDING_MAX_LENGTH,
        MAX_AI_EMBEDDING_MAX_LENGTH,
        DEFAULT_AI_EMBEDDING_MAX_LENGTH,
      ),
    },
  };
}
