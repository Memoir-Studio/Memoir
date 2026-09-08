import * as stylex from "@stylexjs/stylex";
import { Check, Folder, FolderOpen } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, Input } from "../../components/ui";
import {
  FOLDER_COLOR_HEX,
  FOLDER_COLORS,
  FOLDER_EMOJIS,
  extractEmoji,
  normalizeFolderAppearance,
  type FolderAppearance,
  type FolderColor,
} from "../../domain/folders";
import type { MessageKey } from "../../i18n";
import { useI18n } from "../../i18n/react";
import { isRootFolder } from "./note-utils";
import { accents } from "../../styles/tokens.stylex";
import {
  folderAppearanceStyles,
  sharedLibraryStyles,
  sidebarStyles,
} from "./library-styles.stylex";

const COLOR_LABELS: Record<FolderColor, MessageKey> = {
  coral: "settings.accentCoral",
  blue: "settings.accentBlue",
  green: "settings.accentGreen",
  gold: "settings.accentGold",
  violet: "settings.accentViolet",
  slate: "settings.accentSlate",
  ink: "settings.accentInk",
};

export function FolderAppearanceDialog({
  folder,
  folderLabel,
  appearance,
  isDark = false,
  open,
  onClose,
  onChange,
}: {
  folder: string;
  folderLabel: string;
  appearance?: FolderAppearance;
  isDark?: boolean;
  open: boolean;
  onClose: () => void;
  onChange: (appearance: FolderAppearance | null) => void;
}) {
  const { t } = useI18n();
  const [customEmoji, setCustomEmoji] = useState("");
  const Icon = isRootFolder(folder) ? FolderOpen : Folder;
  const previewColor = appearance?.color
    ? appearance.color === "ink"
      ? isDark
        ? "#efede7"
        : FOLDER_COLOR_HEX.ink
      : FOLDER_COLOR_HEX[appearance.color]
    : accents.primary;

  const commit = (next: FolderAppearance | undefined) => {
    onChange(next ? (normalizeFolderAppearance(next) ?? null) : null);
  };

  const selectEmoji = (emoji: string) => {
    commit({
      ...appearance,
      emoji: appearance?.emoji === emoji ? undefined : emoji,
    });
  };

  const selectColor = (color?: FolderColor) => {
    commit({
      ...appearance,
      color: color && appearance?.color === color ? undefined : color,
    });
  };

  return (
    <Dialog
      description={t("dialog.folderAppearanceDescription", { name: folderLabel })}
      footer={
        <>
          <Button onClick={() => commit(undefined)} variant="ghost">
            {t("folder.reset")}
          </Button>
          <Button onClick={onClose} variant="primary">
            {t("folder.done")}
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      title={t("dialog.folderAppearance")}
    >
      <div {...stylex.props(folderAppearanceStyles.dialog)}>
        <div data-folder-color={appearance?.color} {...stylex.props(folderAppearanceStyles.preview)}>
          <span
            aria-hidden="true"
            {...stylex.props(
              sidebarStyles.navIcon,
              appearance?.color && folderAppearanceStyles.previewIcon(previewColor),
            )}
          >
            {appearance?.emoji ? (
              <span
                {...stylex.props(
                  sidebarStyles.folderEmoji,
                  appearance.color && sidebarStyles.folderEmojiColored(previewColor),
                )}
              >
                {appearance.emoji}
              </span>
            ) : (
              <Icon {...stylex.props(folderAppearanceStyles.previewSvg)} strokeWidth={1.8} />
            )}
          </span>
          <span {...stylex.props(sharedLibraryStyles.truncate)}>{folderLabel}</span>
        </div>

        <div {...stylex.props(folderAppearanceStyles.section)}>
          <p {...stylex.props(folderAppearanceStyles.label)}>{t("folder.icon")}</p>
          <div {...stylex.props(folderAppearanceStyles.emojiGrid)} role="group" aria-label={t("folder.icon")}>
            {FOLDER_EMOJIS.map((emoji) => (
              <button
                aria-label={emoji}
                aria-pressed={appearance?.emoji === emoji}
                key={emoji}
                onClick={() => selectEmoji(emoji)}
                type="button"
                {...stylex.props(
                  folderAppearanceStyles.emojiButton,
                  appearance?.emoji === emoji && folderAppearanceStyles.emojiSelected,
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
          <label {...stylex.props(folderAppearanceStyles.fieldLabel)}>
            {t("folder.customEmoji")}
            <Input
              onChange={(event) => {
                const value = event.target.value;
                const emoji = extractEmoji(value);
                setCustomEmoji(emoji ?? value);
                if (emoji) commit({ ...appearance, emoji });
              }}
              placeholder={t("folder.customEmojiPlaceholder")}
              value={customEmoji}
            />
          </label>
        </div>

        <div {...stylex.props(folderAppearanceStyles.section)}>
          <p {...stylex.props(folderAppearanceStyles.label)}>{t("folder.color")}</p>
          <div {...stylex.props(folderAppearanceStyles.swatches)} role="group" aria-label={t("folder.color")}>
            <button
              aria-label={t("folder.defaultColor")}
              aria-pressed={!appearance?.color}
              onClick={() => selectColor(undefined)}
              title={t("folder.defaultColor")}
              type="button"
              {...stylex.props(
                folderAppearanceStyles.defaultSwatch,
                !appearance?.color && folderAppearanceStyles.defaultSwatchSelected,
              )}
            />
            {FOLDER_COLORS.map((color) => {
              const label = t(COLOR_LABELS[color]);
              return (
                <button
                  aria-label={label}
                  aria-pressed={appearance?.color === color}
                  key={color}
                  onClick={() => selectColor(color)}
                  title={label}
                  type="button"
                  {...stylex.props(
                    folderAppearanceStyles.swatch(FOLDER_COLOR_HEX[color]),
                    appearance?.color === color &&
                      folderAppearanceStyles.swatchSelected(FOLDER_COLOR_HEX[color]),
                  )}
                >
                  {appearance?.color === color && (
                  <Check strokeWidth={3} {...stylex.props(folderAppearanceStyles.swatchIcon)} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
