import * as stylex from "@stylexjs/stylex";
import { Check } from "lucide-react";
import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../../i18n/react";
import {
  accents,
  colors,
  motion,
  typography,
} from "../../../styles/tokens.stylex";
import { usePresence } from "../usePresence";

const ContextMenuCloseContext = createContext<(() => void) | null>(null);

export function ContextMenu({
  open,
  x,
  y,
  onClose,
  label,
  autoFocus = true,
  children,
  style,
}: {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  label?: string;
  autoFocus?: boolean;
  children: ReactNode;
  style?: stylex.StyleXStyles;
}) {
  const { t } = useI18n();
  const menuLabel = label ?? t("menu.fallback");
  const labelId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const { present, visible } = usePresence(open);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!present) return;
    const menu = menuRef.current;
    if (!menu) {
      setPosition({ left: x, top: y });
      return;
    }
    const pad = 8;
    const rect = menu.getBoundingClientRect();
    setPosition({
      left: Math.min(Math.max(pad, x), Math.max(pad, window.innerWidth - rect.width - pad)),
      top: Math.min(Math.max(pad, y), Math.max(pad, window.innerHeight - rect.height - pad)),
    });
  }, [present, x, y, children]);

  useEffect(() => {
    if (!present) return;
    const menu = menuRef.current;
    const items = menuItems(menu);
    if (autoFocus) items[0]?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (menu && !menu.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (!autoFocus && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const next = menuItems(menu);
        (event.key === "ArrowUp" ? next[next.length - 1] : next[0])?.focus();
      }
    };
    const onViewportChange = () => onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [autoFocus, onClose, present]);

  if (!present || typeof document === "undefined") return null;

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      const next = current < 0 ? 0 : (current + offset + items.length) % items.length;
      items[next]?.focus();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  return createPortal(
    <ContextMenuCloseContext.Provider value={onClose}>
      <div
        ref={menuRef}
        {...stylex.props(
          styles.menu,
          visible && styles.menuVisible,
          styles.menuPosition(position.left, position.top),
          style,
        )}
        aria-labelledby={labelId}
        data-state={visible ? "open" : "closed"}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={onMenuKeyDown}
        role="menu"
      >
        <span {...stylex.props(styles.screenReaderOnly)} id={labelId}>
          {menuLabel}
        </span>
        {children}
      </div>
    </ContextMenuCloseContext.Provider>,
    document.body,
  );
}

export function ContextMenuItem({
  icon,
  label,
  danger,
  disabled,
  checked,
  onSelect,
  style,
}: {
  icon?: ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onSelect: () => void;
  style?: stylex.StyleXStyles;
}) {
  const onClose = useContext(ContextMenuCloseContext);
  return (
    <button
      {...stylex.props(
        styles.item,
        checked && styles.itemChecked,
        danger && styles.itemDanger,
        style,
      )}
      aria-checked={checked}
      data-danger={danger || undefined}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect();
        onClose?.();
      }}
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      type="button"
    >
      <span {...stylex.props(styles.iconSlot)} aria-hidden="true">
        {checked ? <Check {...stylex.props(styles.icon)} /> : styleMenuIcon(icon)}
      </span>
      <span {...stylex.props(styles.itemLabel)}>{label}</span>
    </button>
  );
}

export function ContextMenuSeparator({ style }: { style?: stylex.StyleXStyles } = {}) {
  return <div {...stylex.props(styles.separator, style)} role="separator" />;
}

function menuItems(menu: HTMLElement | null) {
  return menu
    ? [
        ...menu.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)',
        ),
      ]
    : [];
}

function styleMenuIcon(icon: ReactNode) {
  if (!isValidElement<{ className?: string; style?: CSSProperties }>(icon)) return icon;
  const iconProps = stylex.props(styles.icon);
  return cloneElement(icon as ReactElement<{ className?: string; style?: CSSProperties }>, {
    ...iconProps,
    className: [icon.props.className, iconProps.className].filter(Boolean).join(" "),
    style: { ...icon.props.style, ...iconProps.style },
  });
}

const styles = stylex.create({
  menu: {
    position: "fixed",
    zIndex: 60,
    minWidth: "188px",
    padding: "5px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: `color-mix(in srgb, ${colors.border} 86%, transparent)`,
    borderRadius: "10px",
    backgroundColor: `color-mix(in srgb, ${colors.elevated} 96%, ${colors.panel})`,
    boxShadow: {
      default:
        "0 16px 40px rgb(37 33 27 / 18%), 0 4px 12px rgb(37 33 27 / 8%), inset 0 1px rgb(255 255 255 / 52%)",
      ':is([data-theme="dark"] *)':
        "0 28px 72px rgb(0 0 0 / 46%), 0 8px 24px rgb(0 0 0 / 26%), inset 0 1px rgb(255 255 255 / 5%)",
    },
    opacity: {
      default: 0,
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transform: {
      default: "translateY(4px) scale(0.98)",
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motion.fast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.ease,
  },
  menuVisible: {
    opacity: 1,
    transform: "none",
  },
  menuPosition: (left: number, top: number) => ({
    left,
    top,
  }),
  screenReaderOnly: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
  item: {
    appearance: "none",
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr)",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    height: "30px",
    padding: "0 8px",
    borderWidth: 0,
    borderRadius: "7px",
    backgroundColor: {
      default: "transparent",
      ":hover": `color-mix(in srgb, ${accents.soft} 82%, ${colors.elevated})`,
      ":focus-visible": `color-mix(in srgb, ${accents.soft} 82%, ${colors.elevated})`,
    },
    color: colors.text,
    cursor: "pointer",
    fontFamily: typography.uiFont,
    fontSize: "12px",
    fontWeight: 500,
    letterSpacing: 0,
    margin: 0,
    textAlign: "left",
    outline: {
      default: null,
      ":focus-visible": "none",
    },
    opacity: {
      default: 1,
      ":disabled": 0.45,
    },
  },
  itemChecked: {
    fontWeight: 600,
  },
  itemDanger: {
    color: colors.danger,
    backgroundColor: {
      default: "transparent",
      ":hover": `color-mix(in srgb, ${colors.danger} 12%, ${colors.elevated})`,
      ":focus-visible": `color-mix(in srgb, ${colors.danger} 12%, ${colors.elevated})`,
    },
  },
  iconSlot: {
    display: "grid",
    width: "16px",
    height: "16px",
    placeItems: "center",
    color: "currentColor",
  },
  icon: {
    width: "14px",
    height: "14px",
  },
  itemLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  separator: {
    height: "1px",
    margin: "4px 6px",
    backgroundColor: `color-mix(in srgb, ${colors.border} 88%, transparent)`,
  },
});
