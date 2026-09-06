import * as stylex from "@stylexjs/stylex";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../../i18n/react";
import {
  colors,
  layout,
  motion,
} from "../../../styles/tokens.stylex";
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
  style,
  bodyStyle,
  headerStyle,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  style?: stylex.StyleXStyles;
  bodyStyle?: stylex.StyleXStyles;
  headerStyle?: stylex.StyleXStyles;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const { t } = useI18n();
  const { present, visible } = usePresence(open);
  const containerRef = useDialogFocus(open, onClose);
  if (!present) return null;

  const labelled = {
    "aria-describedby": description ? descriptionId : undefined,
    "aria-labelledby": titleId,
    "aria-modal": true as const,
    "data-state": visible ? "open" : "closed",
    role: "dialog" as const,
    ...stylex.props(styles.dialog, visible && styles.visible, style),
  };
  const body = (
    <>
      <header {...stylex.props(styles.header, headerStyle)}>
        <div>
          <h2 {...stylex.props(styles.title)} id={titleId}>
            {title}
          </h2>
          {description && (
            <p {...stylex.props(styles.description)} id={descriptionId}>
              {description}
            </p>
          )}
        </div>
        <IconButton label={t("common.close")} onClick={onClose} style={styles.closeButton}>
          <X {...stylex.props(styles.closeIcon)} strokeWidth={1.8} />
        </IconButton>
      </header>
      <div {...stylex.props(styles.body, bodyStyle)}>{children}</div>
      {footer && <footer {...stylex.props(styles.footer)}>{footer}</footer>}
    </>
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit?.();
  };
  const setContainerRef = (node: HTMLElement | null) => {
    containerRef.current = node;
  };

  return createPortal(
    <div
      {...stylex.props(styles.overlay, visible && styles.visible)}
      data-state={visible ? "open" : "closed"}
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
    </div>,
    document.body,
  );
}

const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: layout.windowInset,
    zIndex: 50,
    display: "grid",
    placeItems: "center",
    padding: "16px",
    overflow: "clip",
    backgroundColor: `color-mix(in srgb, ${colors.text} 30%, transparent)`,
    backdropFilter: "blur(4px)",
    borderRadius: {
      default: "16px",
      ':is([data-window-frame="native"] *)': "10px",
      ':is([data-window-frame="flush"] *)': 0,
      ':is([data-maximized="true"] *)': 0,
      "@media (max-width: 760px)": 0,
    },
    opacity: {
      default: 0,
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transitionProperty: "opacity",
    transitionDuration: {
      default: motion.standard,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.ease,
  },
  dialog: {
    width: "100%",
    maxWidth: "448px",
    maxHeight: "90vh",
    overflow: "auto",
    color: colors.text,
    borderWidth: {
      default: "1px",
      ':is([data-os="macos"] *)': 0,
    },
    borderStyle: "solid",
    borderColor: `color-mix(in srgb, ${colors.border} 86%, transparent)`,
    borderRadius: "14px",
    backgroundColor: colors.elevated,
    boxShadow: {
      default:
        "0 28px 72px rgb(37 33 27 / 24%), 0 8px 24px rgb(37 33 27 / 10%), inset 0 1px rgb(255 255 255 / 52%)",
      ':is([data-theme="dark"] *)':
        "0 28px 72px rgb(0 0 0 / 46%), 0 8px 24px rgb(0 0 0 / 26%), inset 0 1px rgb(255 255 255 / 5%)",
      ':is([data-os="macos"] *)':
        "0 24px 80px rgb(0 0 0 / 28%), 0 8px 24px rgb(0 0 0 / 14%)",
      ':is([data-os="macos"][data-theme="dark"] *)':
        "0 24px 80px rgb(0 0 0 / 52%), 0 8px 24px rgb(0 0 0 / 28%)",
    },
    opacity: {
      default: 0,
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transform: {
      default: "translateY(6px) scale(0.985)",
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motion.standard,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.ease,
  },
  visible: {
    opacity: 1,
    transform: "none",
  },
  header: {
    display: "flex",
    minHeight: "48px",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "8px 10px 8px 20px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: `color-mix(in srgb, ${colors.border} 78%, transparent)`,
    backgroundColor: `color-mix(in srgb, ${colors.elevated} 96%, transparent)`,
  },
  title: {
    margin: 0,
    color: colors.text,
    fontSize: "14px",
    fontWeight: 700,
    letterSpacing: 0,
    lineHeight: 1.3,
  },
  description: {
    marginTop: "4px",
    color: colors.muted,
    fontSize: "12px",
    lineHeight: "20px",
  },
  closeButton: {
    width: "30px",
    height: "30px",
    borderRadius: "8px",
  },
  closeIcon: {
    width: "14px",
    height: "14px",
  },
  body: {
    padding: "16px 20px 18px",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "8px",
    padding: "14px 16px 16px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: `color-mix(in srgb, ${colors.border} 72%, transparent)`,
  },
});
