import { Check, ExternalLink, Info, Palette, RotateCcw, SlidersHorizontal, Type } from "lucide-react";
import type { AppSettings, LocalePreference } from "../../domain/settings";
import {
  Button,
  Dialog,
  SegmentedControl,
  Select,
  Toggle,
} from "../../components/ui";
import logoUrl from "../../assets/logo.svg";
import { getGateways } from "../../gateways";
import { useI18n } from "../../i18n/react";
import type { MessageKey } from "../../i18n";
import { APP_VERSION } from "../../platform/app-version";
import type { SettingsSection } from "./types";

export const GITHUB_REPO_URL = "https://github.com/Memoir-Studio/Memoir";

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row grid grid-cols-[minmax(160px,1fr)_auto] items-center gap-6 max-sm:grid-cols-1 max-sm:gap-2">
      <div className="min-w-0">
        <div className="settings-row-label">{label}</div>
        {description && <p className="settings-row-description">{description}</p>}
      </div>
      <div className="settings-row-control flex min-w-0 justify-end max-sm:justify-start">
        {children}
      </div>
    </div>
  );
}

function RangeControl({
  label,
  min,
  max,
  step,
  value,
  valueLabel,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  valueLabel: string;
  onChange: (value: number) => void;
}) {
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <label className="settings-range-control">
      <input
        aria-label={label}
        className="settings-range"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        style={{ "--range-progress": `${progress}%` } as React.CSSProperties}
        type="range"
        value={value}
      />
      <span>{valueLabel}</span>
    </label>
  );
}

const accentKeys = [
  { value: "ink", labelKey: "settings.accentInk", color: "#343532" },
  { value: "coral", labelKey: "settings.accentCoral", color: "#d65f4d" },
  { value: "blue", labelKey: "settings.accentBlue", color: "#3f7edb" },
  { value: "green", labelKey: "settings.accentGreen", color: "#3e9b73" },
  { value: "gold", labelKey: "settings.accentGold", color: "#d5a414" },
  { value: "violet", labelKey: "settings.accentViolet", color: "#8a65d1" },
  { value: "slate", labelKey: "settings.accentSlate", color: "#607287" },
] as const;

function GeneralSettings({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}) {
  const { t } = useI18n();
  const general = settings.general;
  const update = (patch: Partial<AppSettings["general"]>) =>
    onChange({ ...settings, general: { ...general, ...patch } });

  return (
    <div className="settings-section">
      <SettingRow
        description={t("settings.closeBehaviorHint")}
        label={t("settings.closeBehavior")}
      >
        <SegmentedControl
          label={t("settings.closeBehavior")}
          onChange={(closeBehavior) => update({ closeBehavior })}
          options={[
            { value: "tray", label: t("settings.closeToTray") },
            { value: "quit", label: t("settings.quitDirectly") },
          ]}
          value={general.closeBehavior}
        />
      </SettingRow>
    </div>
  );
}

function AppearanceSettings({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}) {
  const { t } = useI18n();
  const appearance = settings.appearance;
  const update = (patch: Partial<AppSettings["appearance"]>) =>
    onChange({ ...settings, appearance: { ...appearance, ...patch } });

  return (
    <div className="settings-section">
      <SettingRow label={t("settings.language")}>
        <Select
          label={t("settings.language")}
          onChange={(locale: LocalePreference) => update({ locale })}
          options={[
            { value: "system", label: t("locale.system") },
            { value: "zh", label: t("locale.zh") },
            { value: "en", label: t("locale.en") },
          ]}
          value={appearance.locale}
        />
      </SettingRow>
      <SettingRow label={t("settings.theme")}>
        <SegmentedControl
          label={t("settings.theme")}
          onChange={(theme) => update({ theme })}
          options={[
            { value: "system", label: t("settings.themeSystem") },
            { value: "light", label: t("settings.themeLight") },
            { value: "dark", label: t("settings.themeDark") },
          ]}
          value={appearance.theme}
        />
      </SettingRow>
      <SettingRow label={t("settings.accent")}>
        <div className="settings-swatches" role="group" aria-label={t("settings.accent")}>
          {accentKeys.map((accent) => {
            const label = t(accent.labelKey);
            return (
              <button
                aria-label={label}
                aria-pressed={appearance.accent === accent.value}
                className="settings-swatch"
                key={accent.value}
                onClick={() => update({ accent: accent.value })}
                style={{ "--swatch": accent.color } as React.CSSProperties}
                title={label}
                type="button"
              >
                {appearance.accent === accent.value && <Check />}
              </button>
            );
          })}
        </div>
      </SettingRow>
      <SettingRow label={t("settings.background")}>
        <SegmentedControl
          label={t("settings.background")}
          onChange={(background) => update({ background })}
          options={[
            { value: "paper", label: t("settings.backgroundPaper") },
            { value: "pure", label: t("settings.backgroundPure") },
          ]}
          value={appearance.background}
        />
      </SettingRow>
      <SettingRow label={t("settings.density")}>
        <SegmentedControl
          label={t("settings.density")}
          onChange={(density) => update({ density })}
          options={[
            { value: "comfortable", label: t("settings.densityComfortable") },
            { value: "compact", label: t("settings.densityCompact") },
          ]}
          value={appearance.density}
        />
      </SettingRow>
      <SettingRow label={t("settings.uiScale")}>
        <RangeControl
          label={t("settings.uiScale")}
          max={2}
          min={0.8}
          onChange={(uiScale) => update({ uiScale })}
          step={0.05}
          value={appearance.uiScale}
          valueLabel={`${Math.round(appearance.uiScale * 100)}%`}
        />
      </SettingRow>
      <SettingRow label={t("settings.bodyFont")}>
        <SegmentedControl
          label={t("settings.bodyFont")}
          onChange={(bodyFont) => update({ bodyFont })}
          options={[
            { value: "sans", label: t("settings.fontSans") },
            { value: "serif", label: t("settings.fontSerif") },
          ]}
          value={appearance.bodyFont}
        />
      </SettingRow>
      <SettingRow label={t("settings.bodyFontSize")}>
        <RangeControl
          label={t("settings.bodyFontSize")}
          max={20}
          min={13}
          onChange={(bodyFontSize) => update({ bodyFontSize })}
          value={appearance.bodyFontSize}
          valueLabel={`${appearance.bodyFontSize}px`}
        />
      </SettingRow>
      <SettingRow label={t("settings.lineHeight")}>
        <RangeControl
          label={t("settings.lineHeight")}
          max={2}
          min={1.4}
          onChange={(lineHeight) => update({ lineHeight })}
          step={0.1}
          value={appearance.lineHeight}
          valueLabel={appearance.lineHeight.toFixed(1)}
        />
      </SettingRow>
      <SettingRow label={t("settings.contentWidth")}>
        <SegmentedControl
          label={t("settings.contentWidth")}
          onChange={(contentWidth) => update({ contentWidth })}
          options={[
            { value: "narrow", label: t("settings.widthNarrow") },
            { value: "standard", label: t("settings.widthStandard") },
            { value: "wide", label: t("settings.widthWide") },
            { value: "full", label: t("settings.widthFull") },
          ]}
          value={appearance.contentWidth}
        />
      </SettingRow>
      <div className="settings-preview-block">
        <span className="settings-preview-label">{t("settings.previewLabel")}</span>
        <article className="settings-preview-card">
          <h4>{t("settings.previewTitle")}</h4>
          <p>{t("settings.previewBody")}</p>
          <div>
            <span>Markdown</span>
            <span>{t("settings.previewTagLocal")}</span>
          </div>
        </article>
      </div>
    </div>
  );
}

function EditorSettings({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}) {
  const { t } = useI18n();
  const editor = settings.editor;
  const update = (patch: Partial<AppSettings["editor"]>) =>
    onChange({ ...settings, editor: { ...editor, ...patch } });

  return (
    <div className="settings-section">
      <SettingRow label={t("settings.editorFontSize")} description={t("settings.editorFontSizeHint")}>
        <RangeControl
          label={t("settings.editorFontSize")}
          max={18}
          min={12}
          onChange={(fontSize) => update({ fontSize })}
          value={editor.fontSize}
          valueLabel={`${editor.fontSize}px`}
        />
      </SettingRow>
      <SettingRow label={t("settings.lineWrapping")} description={t("settings.lineWrappingHint")}>
        <Toggle
          checked={editor.lineWrapping}
          label={t("settings.lineWrapping")}
          onChange={(lineWrapping) => update({ lineWrapping })}
        />
      </SettingRow>
      <SettingRow label={t("settings.lineNumbers")}>
        <Toggle
          checked={editor.lineNumbers}
          label={t("settings.lineNumbers")}
          onChange={(lineNumbers) => update({ lineNumbers })}
        />
      </SettingRow>
      <SettingRow label={t("settings.defaultView")}>
        <SegmentedControl
          label={t("settings.defaultView")}
          onChange={(defaultView) => update({ defaultView })}
          options={[
            { value: "edit", label: t("settings.viewEdit") },
            { value: "split", label: t("settings.viewSplit") },
            { value: "preview", label: t("settings.viewPreview") },
          ]}
          value={editor.defaultView}
        />
      </SettingRow>
    </div>
  );
}

export default function SettingsDialog({
  open,
  section,
  settings,
  onClose,
  onSectionChange,
  onSettingsChange,
  onReset,
}: {
  open: boolean;
  section: SettingsSection;
  settings: AppSettings;
  onClose: () => void;
  onSectionChange: (section: SettingsSection) => void;
  onSettingsChange: (settings: AppSettings) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const navigation = [
    { value: "general", labelKey: "settings.general", icon: SlidersHorizontal },
    { value: "appearance", labelKey: "settings.appearance", icon: Palette },
    { value: "editor", labelKey: "settings.editor", icon: Type },
    { value: "about", labelKey: "settings.about", icon: Info },
  ] as const satisfies ReadonlyArray<{
    value: SettingsSection;
    labelKey: MessageKey;
    icon: typeof Palette;
  }>;

  return (
    <Dialog
      className="settings-dialog max-w-[860px]"
      onClose={onClose}
      open={open}
      title={t("settings.title")}
    >
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-nav">
            {navigation.map(({ value, labelKey, icon: Icon }) => (
              <button
                aria-current={section === value ? "page" : undefined}
                className={`sidebar-nav-item grid w-full grid-cols-[15px_minmax(0,1fr)] items-center gap-2 rounded-[7px] px-2 text-left ${
                  section === value ? "is-active" : ""
                }`}
                key={value}
                onClick={() => onSectionChange(value)}
                type="button"
              >
                <Icon />
                <span>{t(labelKey)}</span>
              </button>
            ))}
          </div>
          <Button
            className="settings-reset"
            onClick={onReset}
            variant="ghost"
          >
            <RotateCcw />
            <span>{t("settings.reset")}</span>
          </Button>
        </aside>
        <section className="settings-content">
          {section === "general" && (
            <GeneralSettings key="general" onChange={onSettingsChange} settings={settings} />
          )}
          {section === "appearance" && (
            <AppearanceSettings key="appearance" onChange={onSettingsChange} settings={settings} />
          )}
          {section === "editor" && (
            <EditorSettings key="editor" onChange={onSettingsChange} settings={settings} />
          )}
          {section === "about" && (
            <div className="settings-about" key="about">
              <img alt="" className="settings-about-mark" height={64} src={logoUrl} width={64} />
              <span className="settings-about-kicker">LOCAL FIRST WRITING</span>
              <h3>Memoir</h3>
              <p>{t("settings.aboutBody")}</p>
              <div className="settings-about-meta">
                <span>{t("settings.version", { version: APP_VERSION })}</span>
                <span>{t("settings.dataLocal")}</span>
              </div>
              <a
                className="settings-about-link"
                href={GITHUB_REPO_URL}
                onClick={(event) => {
                  event.preventDefault();
                  void getGateways().workspace.openExternal(GITHUB_REPO_URL);
                }}
                rel="noreferrer"
                target="_blank"
              >
                <span>{t("settings.github")}</span>
                <ExternalLink aria-hidden strokeWidth={1.8} />
              </a>
            </div>
          )}
        </section>
      </div>
    </Dialog>
  );
}
