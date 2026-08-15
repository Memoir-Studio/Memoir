import { X } from "lucide-react";
import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { useI18n } from "../../../i18n/react";
import { cn } from "../cn";
import { IconButton } from "../IconButton";
import { usePresence } from "../usePresence";

const FOCUSABLE_SELECTOR =
  "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";
const TEXT_FIELD_SELECTOR =
  "input:not([disabled]):not([type]), input[type='text']:not([disabled]), input[type='search']:not([disabled]), input[type='url']:not([disabled]), textarea:not([disabled])";

function useDialogFocus(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const active = document.activeElement;
    const alreadyFocused =
      active instanceof HTMLElement && Boolean(container?.contains(active)) && active !== container;
    if (!alreadyFocused) {
      const preferred =
        container?.querySelector<HTMLElement>(TEXT_FIELD_SELECTOR) ??
        container?.querySelector<HTMLElement>("button[type='submit']:not([disabled])") ??
        container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      preferred?.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !container) return;
      const elements = [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  return containerRef;
}

export function Dialog({
  open,
  title,
  description,
  onClose,
  onSubmit,
  children,
  footer,
  className,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const { t } = useI18n();
  const { present, visible } = usePresence(open);
  const containerRef = useDialogFocus(open, onClose);
  if (!present) return null;

  const dialogClassName = cn(
    "memoir-dialog max-h-[90vh] w-full max-w-md overflow-auto text-text",
    visible && "is-open",
    className,
  );
  const labelled = {
    "aria-describedby": description ? descriptionId : undefined,
    "aria-labelledby": titleId,
    "aria-modal": true as const,
    className: dialogClassName,
    role: "dialog" as const,
  };
  const body = (
    <>
      <header>
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && (
            <p className="mt-1 text-[12px] leading-5 text-muted" id={descriptionId}>
              {description}
            </p>
          )}
        </div>
        <IconButton label={t("common.close")} onClick={onClose}>
          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
        </IconButton>
      </header>
      <div className="memoir-dialog-body">{children}</div>
      {footer && <footer className="memoir-dialog-footer">{footer}</footer>}
    </>
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit?.();
  };
  const setContainerRef = (node: HTMLElement | null) => {
    containerRef.current = node;
  };

  return (
    <div
      className={cn("memoir-overlay fixed inset-0 z-50 grid place-items-center bg-text/30 p-4 backdrop-blur-sm", visible && "is-open")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      {onSubmit ? (
        <form {...labelled} onSubmit={handleSubmit} ref={setContainerRef}>
          {body}
        </form>
      ) : (
        <div {...labelled} ref={setContainerRef}>
          {body}
        </div>
      )}
    </div>
  );
}
