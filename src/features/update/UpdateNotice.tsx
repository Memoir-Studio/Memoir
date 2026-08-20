import { Button, Dialog } from "../../components/ui";
import { useI18n } from "../../i18n/react";

export function UpdateNotice({
  open,
  latestVersion,
  releaseNotes,
  onClose,
  onSkip,
  onDownload,
}: {
  open: boolean;
  latestVersion: string;
  releaseNotes: string | null;
  onClose: () => void;
  onSkip: () => void;
  onDownload: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      className="update-dialog"
      description={t("update.description", { version: latestVersion })}
      footer={
        <>
          <Button className="mr-auto" onClick={onSkip} variant="ghost">
            {t("update.skip")}
          </Button>
          <Button onClick={onClose}>{t("update.later")}</Button>
          <Button onClick={onDownload} variant="primary">
            {t("update.download")}
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      title={t("update.title")}
    >
      {releaseNotes ? <pre className="update-notes">{releaseNotes}</pre> : null}
    </Dialog>
  );
}
