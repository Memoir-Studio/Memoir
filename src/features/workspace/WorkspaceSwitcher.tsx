import { Check, ChevronsUpDown, FolderOpen } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn, usePresence } from "../../components/ui";
import { useI18n } from "../../i18n/react";
import { useAppStore } from "../../store/app-store";
import {
  mergeRecentWorkspaces,
  workspaceDisplayName,
  workspaceInitial,
} from "./workspace-utils";

const MENU_GAP = 6;
const MENU_PAD = 8;
const MENU_WIDTH = 240;

type SwitcherItem =
  | { type: "workspace"; root: string }
  | { type: "open" };

export function WorkspaceSwitcher({
  collapsed,
  noteCount,
}: {
  collapsed: boolean;
  noteCount: number;
}) {
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const recentWorkspaces = useAppStore((state) => state.recentWorkspaces);
  const openWorkspace = useAppStore((state) => state.openWorkspace);
  const { t, tc } = useI18n();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { present, visible } = usePresence(open);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const workspaceName = workspaceDisplayName(workspaceRoot, t("nav.workspaceFallback"));
  const workspaces = useMemo(
    () => mergeRecentWorkspaces(workspaceRoot, recentWorkspaces),
    [recentWorkspaces, workspaceRoot],
  );
  const items = useMemo<SwitcherItem[]>(
    () => [...workspaces.map((root) => ({ type: "workspace" as const, root })), { type: "open" }],
    [workspaces],
  );

  const close = () => setOpen(false);

  const selectIndex = (index: number) => {
    const item = items[index];
    if (!item) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (item.type === "open") {
      void openWorkspace();
      return;
    }
    if (item.root !== workspaceRoot) void openWorkspace(item.root);
  };

  useLayoutEffect(() => {
    if (!present) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const menuWidth = Math.max(MENU_WIDTH, menu?.offsetWidth ?? 0);
    const menuHeight = menu?.offsetHeight ?? 0;
    let top = triggerRect.top - MENU_GAP - menuHeight;
    if (top < MENU_PAD) {
      top = triggerRect.bottom + MENU_GAP;
      if (top + menuHeight > window.innerHeight - MENU_PAD) {
        top = Math.max(MENU_PAD, window.innerHeight - MENU_PAD - menuHeight);
      }
    }
    let left = triggerRect.left;
    if (left + menuWidth > window.innerWidth - MENU_PAD) {
      left = window.innerWidth - MENU_PAD - menuWidth;
    }
    setPosition({
      left: Math.max(MENU_PAD, left),
      top,
    });
  }, [present, items, workspaceRoot]);

  useEffect(() => {
    if (open) setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onViewportChange = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open]);

  const moveActive = (next: number) => {
    if (!items.length) return;
    setActiveIndex((next + items.length) % items.length);
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(activeIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(activeIndex - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, items.length - 1));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectIndex(activeIndex);
      return;
    }
    if (event.key === "Tab") close();
  };

  return (
    <>
      <button
        ref={triggerRef}
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("nav.switchWorkspace")}
        className={cn(
          "sidebar-workspace-switcher flex min-w-0 flex-1 items-center gap-1 rounded-lg px-1 text-left",
          collapsed &&
            "min-[761px]:h-7 min-[761px]:w-7 min-[761px]:flex-none min-[761px]:justify-center min-[761px]:px-0",
        )}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
        title={workspaceRoot || t("nav.switchWorkspace")}
        type="button"
      >
        <span
          className={cn(
            "min-w-0 flex-1",
            collapsed && "min-[761px]:hidden",
          )}
        >
          <span className="block truncate text-[11px] font-semibold text-text">{workspaceName}</span>
          <span className="block truncate text-[9px] text-muted">
            {tc("nav.notesInWorkspace", noteCount)}
          </span>
        </span>
        <ChevronsUpDown
          aria-hidden
          className={cn(
            "sidebar-workspace-chevron shrink-0",
            collapsed && "min-[761px]:h-4 min-[761px]:w-4",
          )}
          strokeWidth={1.8}
        />
      </button>
      {present &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            aria-hidden={!open}
            aria-label={t("nav.switchWorkspace")}
            className={cn("workspace-switcher-menu", visible && "is-open")}
            id={menuId}
            role="menu"
            style={{ left: position.left, top: position.top }}
          >
            <p className="workspace-switcher-heading">{t("nav.recentWorkspaces")}</p>
            {workspaces.map((root, index) => {
              const name = workspaceDisplayName(root, t("nav.workspaceFallback"));
              const current = root === workspaceRoot;
              return (
                <button
                  aria-current={current ? "true" : undefined}
                  className={cn(
                    "workspace-switcher-item",
                    current && "is-current",
                    index === activeIndex && "is-active",
                  )}
                  key={root}
                  onClick={() => selectIndex(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="menuitem"
                  title={current ? t("nav.currentWorkspace") : root}
                  type="button"
                >
                  <span aria-hidden className="workspace-switcher-avatar">
                    {workspaceInitial(name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold text-text">{name}</span>
                    <span className="block truncate text-[10px] text-muted" title={root}>
                      {root}
                    </span>
                  </span>
                  <span className="workspace-switcher-check" aria-hidden>
                    {current ? <Check strokeWidth={2.4} /> : null}
                  </span>
                </button>
              );
            })}
            <div className="workspace-switcher-separator" role="separator" />
            <button
              className={cn(
                "workspace-switcher-item workspace-switcher-open",
                activeIndex === workspaces.length && "is-active",
              )}
              onClick={() => selectIndex(workspaces.length)}
              onMouseEnter={() => setActiveIndex(workspaces.length)}
              role="menuitem"
              type="button"
            >
              <span aria-hidden className="workspace-switcher-avatar is-action">
                <FolderOpen strokeWidth={1.8} />
              </span>
              <span className="min-w-0 truncate text-[12px] font-medium">
                {t("nav.openAnotherWorkspace")}
              </span>
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
