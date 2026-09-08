import * as stylex from "@stylexjs/stylex";
import { Check, ExternalLink, Info, Palette, RotateCcw, SlidersHorizontal, Type } from "lucide-react";
import { GITHUB_REPO_URL } from "../../domain/app-update";
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
import { commonStyles } from "../../styles/tokens.stylex";
import { UpdateCheckControls } from "../update/UpdateCheckControls";
import { settingsStyles as styles } from "./settings-styles.stylex";
import type { SettingsSection } from "./types";

export { GITHUB_REPO_URL };

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
    <div {...stylex.props(styles.row)} data-settings-row>
      <div {...stylex.props(styles.rowCopy)}>
        <div {...stylex.props(styles.rowLabel)}>{label}</div>
        {description && <p {...stylex.props(styles.rowDescription)}>{description}</p>}
      </div>
      <div {...stylex.props(styles.rowControl)}>{children}</div>
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
    <label {...stylex.props(styles.rangeControl)}>
      <input
        {...stylex.props(styles.range, styles.rangeProgress(`${progress}%`))}
        aria-label={label}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
      <span {...stylex.props(styles.rangeValue)}>{valueLabel}</span>
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
    <div {...stylex.props(commonStyles.fadeIn, styles.section)}>
      <SettingRow
        description={t("settings.closeBehaviorHint")}
        label={t("settings.closeBehavior")}
      >
        <SegmentedControl
          label={t("settings.closeBehavior")}
          onChange={(closeBehavior) => update({ closeBehavior })}
          optionStyle={styles.segmentedOption}
          options={[
            { value: "tray", label: t("settings.closeToTray") },
            { value: "quit", label: t("settings.quitDirectly") },
          ]}
          style={styles.segmented}
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
    <div {...stylex.props(commonStyles.fadeIn, styles.section)}>
      <SettingRow label={t("settings.language")}>
        <Select
          label={t("settings.language")}
          onChange={(locale: LocalePreference) => update({ locale })}
          options={[
            { value: "system", label: t("locale.system") },
            { value: "zh", label: t("locale.zh") },
            { value: "en", label: t("locale.en") },
          ]}
          style={styles.select}
          value={appearance.locale}
        />
      </SettingRow>
      <SettingRow label={t("settings.theme")}>
        <SegmentedControl
          label={t("settings.theme")}
          onChange={(theme) => update({ theme })}
          optionStyle={styles.segmentedOption}
          options={[
            { value: "system", label: t("settings.themeSystem") },
            { value: "light", label: t("settings.themeLight") },
            { value: "dark", label: t("settings.themeDark") },
          ]}
          style={styles.segmented}
          value={appearance.theme}
        />
      </SettingRow>
      <SettingRow label={t("settings.accent")}>
        <div {...stylex.props(styles.swatches)} role="group" aria-label={t("settings.accent")}>
          {accentKeys.map((accent) => {
            const label = t(accent.labelKey);
            return (
              <button
                {...stylex.props(
                  styles.swatch,
                  styles.swatchColor(accent.color),
                  appearance.accent === accent.value && styles.swatchSelected(accent.color),
                )}
                aria-label={label}
                aria-pressed={appearance.accent === accent.value}
                key={accent.value}
                onClick={() => update({ accent: accent.value })}
                title={label}
                type="button"
              >
                {appearance.accent === accent.value && (
                  <Check {...stylex.props(styles.swatchIcon)} />
                )}
              </button>
            );
          })}
        </div>
      </SettingRow>
      <SettingRow label={t("settings.background")}>
        <SegmentedControl
          label={t("settings.background")}
          onChange={(background) => update({ background })}
          optionStyle={styles.segmentedOption}
          options={[
            { value: "paper", label: t("settings.backgroundPaper") },
            { value: "pure", label: t("settings.backgroundPure") },
          ]}
          style={styles.segmented}
          value={appearance.background}
        />
      </SettingRow>
      <SettingRow label={t("settings.density")}>
        <SegmentedControl
          label={t("settings.density")}
          onChange={(density) => update({ density })}
          optionStyle={styles.segmentedOption}
          options={[
            { value: "comfortable", label: t("settings.densityComfortable") },
            { value: "compact", label: t("settings.densityCompact") },
          ]}
          style={styles.segmented}
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
          optionStyle={styles.segmentedOption}
          options={[
            { value: "sans", label: t("settings.fontSans") },
            { value: "serif", label: t("settings.fontSerif") },
          ]}
          style={styles.segmented}
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
          optionStyle={styles.segmentedOption}
          options={[
            { value: "narrow", label: t("settings.widthNarrow") },
            { value: "standard", label: t("settings.widthStandard") },
            { value: "wide", label: t("settings.widthWide") },
            { value: "full", label: t("settings.widthFull") },
          ]}
          style={styles.segmented}
          value={appearance.contentWidth}
        />
      </SettingRow>
      <div {...stylex.props(styles.previewBlock)}>
        <span {...stylex.props(styles.overline, styles.previewLabel)}>
          {t("settings.previewLabel")}
        </span>
        <article {...stylex.props(styles.previewCard)}>
          <h4 {...stylex.props(styles.previewHeading)}>{t("settings.previewTitle")}</h4>
          <p {...stylex.props(styles.previewBody)}>{t("settings.previewBody")}</p>
          <div {...stylex.props(styles.previewTags)}>
            <span {...stylex.props(styles.badge)}>Markdown</span>
            <span {...stylex.props(styles.badge)}>{t("settings.previewTag")}</span>
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
    <div {...stylex.props(commonStyles.fadeIn, styles.section)}>
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
          optionStyle={styles.segmentedOption}
          options={[
            { value: "edit", label: t("settings.viewEdit") },
            { value: "split", label: t("settings.viewSplit") },
            { value: "preview", label: t("settings.viewPreview") },
          ]}
          style={styles.segmented}
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
      bodyStyle={styles.dialogBody}
      headerStyle={styles.dialogHeader}
      onClose={onClose}
      open={open}
      style={styles.dialog}
      title={t("settings.title")}
    >
      <div {...stylex.props(styles.layout)}>
        <aside {...stylex.props(styles.sidebar)}>
          <div {...stylex.props(styles.navigation)}>
            {navigation.map(({ value, labelKey, icon: Icon }) => (
              <button
                {...stylex.props(styles.navItem, section === value && styles.navItemActive)}
                aria-current={section === value ? "page" : undefined}
                key={value}
                onClick={() => onSectionChange(value)}
                type="button"
              >
                <Icon
                  {...stylex.props(styles.navIcon, section === value && styles.navIconActive)}
                />
                <span>{t(labelKey)}</span>
              </button>
            ))}
          </div>
          <Button
            onClick={onReset}
            style={styles.resetButton}
            variant="ghost"
          >
            <RotateCcw {...stylex.props(styles.smallIcon)} />
            <span>{t("settings.reset")}</span>
          </Button>
        </aside>
        <section {...stylex.props(styles.content)}>
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
            <div {...stylex.props(commonStyles.fadeIn, styles.about)} key="about">
              <img
                {...stylex.props(styles.aboutMark)}
                alt=""
                height={64}
                src={logoUrl}
                width={64}
              />
              <span {...stylex.props(styles.overline, styles.aboutKicker)}>
                {t("settings.aboutKicker")}
              </span>
              <h3 {...stylex.props(styles.aboutTitle)}>Memoir</h3>
              <p {...stylex.props(styles.aboutBody)}>{t("settings.aboutBody")}</p>
              <div {...stylex.props(styles.aboutMeta)}>
                <span {...stylex.props(styles.badge)}>
                  {t("settings.version", { version: APP_VERSION })}
                </span>
                <span {...stylex.props(styles.badge)}>{t("settings.aboutBadge")}</span>
              </div>
              <a
                {...stylex.props(styles.aboutLink)}
                href={GITHUB_REPO_URL}
                onClick={(event) => {
                  event.preventDefault();
                  void getGateways().system.openExternal(GITHUB_REPO_URL);
                }}
                rel="noreferrer"
                target="_blank"
              >
                <span>{t("settings.github")}</span>
                <ExternalLink
                  {...stylex.props(styles.aboutLinkIcon)}
                  aria-hidden
                  strokeWidth={1.8}
                />
              </a>
              <UpdateCheckControls />
            </div>
          )}
        </section>
      </div>
    </Dialog>
  );
}
