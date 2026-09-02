import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Dialog } from "../../components/ui";
import { getGateways } from "../../gateways";
import { useI18n } from "../../i18n/react";

function ReleaseNotesLink({
  href,
  children,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (href && /^https?:\/\//i.test(href)) {
          void getGateways().workspace.openExternal(href);
        }
      }}
    >
      {children}
    </a>
  );
}

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
      {releaseNotes ? (
        <div className="update-notes">
          <ReactMarkdown
            components={{ a: ReleaseNotesLink }}
            remarkPlugins={[remarkGfm]}
          >
            {releaseNotes}
          </ReactMarkdown>
        </div>
      ) : null}
    </Dialog>
  );
}
