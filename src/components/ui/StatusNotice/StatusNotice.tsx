import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../../../i18n/react";
import { cn } from "../cn";

export function StatusNotice({
  children,
  danger,
  onDismiss,
}: {
  children: ReactNode;
  danger?: boolean;
  onDismiss?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "memoir-notice fixed right-4 top-4 z-40 flex max-w-md items-start gap-3 rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-text shadow-lg",
        danger && "border-danger/40 text-danger",
      )}
      role={danger ? "alert" : "status"}
    >
      <span className="leading-5">{children}</span>
      {onDismiss && (
        <button aria-label={t("common.closeNotice")} onClick={onDismiss} type="button">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
