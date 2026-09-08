import * as stylex from "@stylexjs/stylex";
import { useI18n } from "../../../i18n/react";
import { colors, typography } from "../../../styles/tokens.stylex";
import { Button } from "../Button";
import { Dialog } from "../Dialog";

const styles = stylex.create({
  hint: {
    color: colors.muted,
    fontFamily: typography.uiFont,
    fontSize: 14,
  },
});

export function AlertDialog({
  open,
  title,
  description,
  confirmLabel,
  hint,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  hint?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      description={description}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="danger">
            {confirmLabel}
          </Button>
        </>
      }
      onClose={onClose}
      onSubmit={() => {
        onConfirm();
        onClose();
      }}
      open={open}
      title={title}
    >
      <p {...stylex.props(styles.hint)}>{hint ?? t("dialog.recycleHint")}</p>
    </Dialog>
  );
}
