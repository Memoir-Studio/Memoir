import { useI18n } from "../../../i18n/react";
import { Button } from "../Button";
import { Dialog } from "../Dialog";

export function AlertDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
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
      <p className="text-sm text-muted">{t("dialog.recycleHint")}</p>
    </Dialog>
  );
}
