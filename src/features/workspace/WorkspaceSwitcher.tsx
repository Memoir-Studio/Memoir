import * as stylex from "@stylexjs/stylex";
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
import { usePresence } from "../../components/ui";
import { useI18n } from "../../i18n/react";
import { useAppStore } from "../../store/app-store";
import { accents, colors, media, motion } from "../../styles/tokens.stylex";
import { mergeRecentWorkspaces, workspaceDisplayName } from "./workspace-utils";

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
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
        title={workspaceRoot || t("nav.switchWorkspace")}
        type="button"
        {...stylex.props(
          styles.trigger,
          open && styles.triggerOpen,
          collapsed && styles.triggerCollapsed,
        )}
      >
        <span
          {...stylex.props(styles.triggerText, collapsed && styles.collapsedHidden)}
        >
          <span {...stylex.props(styles.workspaceName)}>{workspaceName}</span>
          <span {...stylex.props(styles.noteCount)}>
            {tc("nav.notesInWorkspace", noteCount)}
          </span>
        </span>
        <ChevronsUpDown
          aria-hidden
          strokeWidth={1.8}
          {...stylex.props(styles.chevron, collapsed && styles.chevronCollapsed)}
        />
      </button>
      {present &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            aria-hidden={!open}
            aria-label={t("nav.switchWorkspace")}
            id={menuId}
            role="menu"
            {...stylex.props(styles.menu, visible && styles.menuVisible, styles.menuPosition(position.left, position.top))}
          >
            <p {...stylex.props(styles.heading)}>{t("nav.recentWorkspaces")}</p>
            {workspaces.map((root, index) => {
              const name = workspaceDisplayName(root, t("nav.workspaceFallback"));
              const current = root === workspaceRoot;
              return (
                <button
                  aria-current={current ? "true" : undefined}
                  key={root}
                  onClick={() => selectIndex(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="menuitem"
                  title={current ? t("nav.currentWorkspace") : root}
                  type="button"
                  {...stylex.props(styles.item, index === activeIndex && styles.itemActive)}
                >
                  <span {...stylex.props(styles.itemText)}>
                    <span {...stylex.props(styles.itemName)}>{name}</span>
                    <span {...stylex.props(styles.itemPath)} title={root}>
                      {root}
                    </span>
                  </span>
                  <span aria-hidden {...stylex.props(styles.check)}>
                    {current ? <Check strokeWidth={2.4} {...stylex.props(styles.checkIcon)} /> : null}
                  </span>
                </button>
              );
            })}
            <div role="separator" {...stylex.props(styles.separator)} />
            <button
              onClick={() => selectIndex(workspaces.length)}
              onMouseEnter={() => setActiveIndex(workspaces.length)}
              role="menuitem"
              type="button"
              {...stylex.props(
                styles.item,
                styles.actionItem,
                activeIndex === workspaces.length && styles.itemActive,
              )}
            >
              <FolderOpen aria-hidden strokeWidth={1.8} {...stylex.props(styles.actionIcon)} />
              <span {...stylex.props(styles.actionLabel)}>
                {t("nav.openAnotherWorkspace")}
              </span>
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

const desktop = "@media (min-width: 761px)";

const styles = stylex.create({
  trigger: {
    display: "flex",
    minWidth: 0,
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingInline: 4,
    borderWidth: 0,
    borderRadius: 8,
    color: "inherit",
    backgroundColor: {
      default: "transparent",
      ":hover": `color-mix(in srgb, ${colors.elevated} 62%, transparent)`,
      ":focus-visible": `color-mix(in srgb, ${colors.elevated} 62%, transparent)`,
    },
    font: "inherit",
    textAlign: "left",
    outline: "none",
    transitionProperty: "background-color",
    transitionDuration: {
      default: "150ms",
      [media.reducedMotion]: "0s",
    },
    transitionTimingFunction: motion.ease,
  },
  triggerCollapsed: {
    height: { [desktop]: 28 },
    width: { [desktop]: 28 },
    flex: { [desktop]: "none" },
    justifyContent: { [desktop]: "center" },
    paddingInline: { [desktop]: 0 },
  },
  triggerOpen: {
    backgroundColor: `color-mix(in srgb, ${colors.elevated} 62%, transparent)`,
  },
  triggerText: {
    minWidth: 0,
    flex: 1,
  },
  collapsedHidden: {
    display: { [desktop]: "none" },
  },
  workspaceName: {
    display: "block",
    overflow: "hidden",
    color: colors.text,
    fontSize: 11,
    fontWeight: 600,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  noteCount: {
    display: "block",
    overflow: "hidden",
    color: colors.muted,
    fontSize: 9,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chevron: {
    width: 11,
    height: 11,
    flexShrink: 0,
    color: colors.muted,
    opacity: 0.72,
  },
  chevronCollapsed: {
    width: { [desktop]: 16 },
    height: { [desktop]: 16 },
  },
  menu: {
    position: "fixed",
    zIndex: 60,
    width: 240,
    padding: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: `color-mix(in srgb, ${colors.border} 86%, transparent)`,
    borderRadius: 12,
    backgroundColor: `color-mix(in srgb, ${colors.elevated} 96%, ${colors.panel})`,
    boxShadow:
      "light-dark(0 16px 40px rgb(37 33 27 / 18%), 0 16px 40px rgb(0 0 0 / 36%)), light-dark(0 4px 12px rgb(37 33 27 / 8%), 0 4px 12px rgb(0 0 0 / 22%)), inset 0 1px light-dark(rgb(255 255 255 / 52%), rgb(255 255 255 / 6%))",
    opacity: 0,
    transform: "translateY(4px) scale(0.98)",
    pointerEvents: "none",
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motion.fast,
      [media.reducedMotion]: "0s",
    },
    transitionTimingFunction: motion.ease,
  },
  menuVisible: {
    opacity: 1,
    transform: "none",
    pointerEvents: "auto",
  },
  menuPosition: (left: number, top: number) => ({ left, top }),
  heading: {
    margin: 0,
    paddingTop: 5,
    paddingRight: 8,
    paddingBottom: 4,
    paddingLeft: 8,
    color: `color-mix(in srgb, ${colors.muted} 86%, transparent)`,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0,
  },
  item: {
    display: "grid",
    width: "100%",
    minHeight: 40,
    gridTemplateColumns: "minmax(0, 1fr) 14px",
    alignItems: "center",
    gap: 8,
    paddingBlock: 6,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: 8,
    color: colors.text,
    backgroundColor: {
      default: "transparent",
      ":hover": `color-mix(in srgb, ${accents.soft} 82%, ${colors.elevated})`,
      ":focus-visible": `color-mix(in srgb, ${accents.soft} 82%, ${colors.elevated})`,
    },
    textAlign: "left",
    outline: "none",
  },
  itemActive: {
    backgroundColor: `color-mix(in srgb, ${accents.soft} 82%, ${colors.elevated})`,
  },
  actionItem: {
    minHeight: 34,
    gridTemplateColumns: "14px minmax(0, 1fr)",
  },
  itemText: {
    minWidth: 0,
  },
  itemName: {
    display: "block",
    overflow: "hidden",
    color: colors.text,
    fontSize: 12,
    fontWeight: 600,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemPath: {
    display: "block",
    overflow: "hidden",
    color: colors.muted,
    fontSize: 10,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  check: {
    display: "grid",
    width: 14,
    height: 14,
    placeItems: "center",
    color: accents.primary,
  },
  checkIcon: {
    width: 13,
    height: 13,
  },
  separator: {
    height: 1,
    marginBlock: 4,
    marginInline: 6,
    backgroundColor: `color-mix(in srgb, ${colors.border} 88%, transparent)`,
  },
  actionIcon: {
    width: 14,
    height: 14,
    flexShrink: 0,
  },
  actionLabel: {
    minWidth: 0,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: 500,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});
