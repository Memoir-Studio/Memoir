import { Check, Folder, FolderOpen } from "lucide-react";
import { useState, type CSSProperties } from "react";
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
  open,
  onClose,
  onChange,
}: {
  folder: string;
  folderLabel: string;
  appearance?: FolderAppearance;
  open: boolean;
  onClose: () => void;
  onChange: (appearance: FolderAppearance | null) => void;
}) {
  const { t } = useI18n();
  const [customEmoji, setCustomEmoji] = useState("");
  const Icon = isRootFolder(folder) ? FolderOpen : Folder;

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
      <div className="folder-appearance-dialog grid gap-4">
        <div className="folder-appearance-preview" data-folder-color={appearance?.color}>
          <span className="sidebar-nav-icon" aria-hidden="true">
            {appearance?.emoji ? (
              <span className="sidebar-folder-emoji">{appearance.emoji}</span>
            ) : (
              <Icon className="h-[15px] w-[15px]" strokeWidth={1.8} />
            )}
          </span>
          <span className="truncate">{folderLabel}</span>
        </div>

        <div className="grid gap-2">
          <p className="folder-appearance-label">{t("folder.icon")}</p>
          <div className="folder-emoji-grid" role="group" aria-label={t("folder.icon")}>
            {FOLDER_EMOJIS.map((emoji) => (
              <button
                aria-label={emoji}
                aria-pressed={appearance?.emoji === emoji}
                className="folder-emoji-button"
                key={emoji}
                onClick={() => selectEmoji(emoji)}
                type="button"
              >
                {emoji}
              </button>
            ))}
          </div>
          <label className="memoir-field-label">
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

        <div className="grid gap-2">
          <p className="folder-appearance-label">{t("folder.color")}</p>
          <div className="folder-color-swatches" role="group" aria-label={t("folder.color")}>
            <button
              aria-label={t("folder.defaultColor")}
              aria-pressed={!appearance?.color}
              className="folder-color-swatch is-default"
              onClick={() => selectColor(undefined)}
              title={t("folder.defaultColor")}
              type="button"
            />
            {FOLDER_COLORS.map((color) => {
              const label = t(COLOR_LABELS[color]);
              return (
                <button
                  aria-label={label}
                  aria-pressed={appearance?.color === color}
                  className="folder-color-swatch"
                  key={color}
                  onClick={() => selectColor(color)}
                  style={{ "--swatch": FOLDER_COLOR_HEX[color] } as CSSProperties}
                  title={label}
                  type="button"
                >
                  {appearance?.color === color && <Check />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
