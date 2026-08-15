import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../../i18n/react";
import { cn } from "../cn";
import { usePresence } from "../usePresence";

const ContextMenuCloseContext = createContext<(() => void) | null>(null);

export function ContextMenu({
  open,
  x,
  y,
  onClose,
  label,
  children,
}: {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  label?: string;
  children: ReactNode;
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
    items[0]?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (menu && !menu.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
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
  }, [onClose, present]);

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
        aria-labelledby={labelId}
        className={cn("memoir-context-menu", visible && "is-open")}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={onMenuKeyDown}
        role="menu"
        style={{ left: position.left, top: position.top }}
      >
        <span className="sr-only" id={labelId}>
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
  onSelect,
}: {
  icon?: ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const onClose = useContext(ContextMenuCloseContext);
  return (
    <button
      className={cn("memoir-context-menu-item", danger && "is-danger")}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onSelect();
        onClose?.();
      }}
      onMouseEnter={(event) => event.currentTarget.focus()}
      role="menuitem"
      type="button"
    >
      <span className="memoir-context-menu-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

export function ContextMenuSeparator() {
  return <div className="memoir-context-menu-separator" role="separator" />;
}

function menuItems(menu: HTMLElement | null) {
  return menu
    ? [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
    : [];
}
