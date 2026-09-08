import * as stylex from "@stylexjs/stylex";
import { Check, ChevronDown } from "lucide-react";
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
import { accents, colors, motion } from "../../../styles/tokens.stylex";
import { selectMenuStyles } from "../select-menu.stylex";
import { usePresence } from "../usePresence";

const MENU_GAP = 6;
const MENU_PAD = 8;

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  style,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  style?: stylex.StyleXStyles;
}) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef({ query: "", timer: 0 });
  const [open, setOpen] = useState(false);
  const { present, visible } = usePresence(open);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex] ?? options[0];
  const optionId = useMemo(
    () => (index: number) => `${listId}-opt-${index}`,
    [listId],
  );

  const close = () => setOpen(false);
  const selectIndex = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveActive = (next: number) => {
    if (!options.length) return;
    setActiveIndex((next + options.length) % options.length);
  };

  const findByQuery = (query: string, from: number) => {
    const needle = query.toLowerCase();
    const count = options.length;
    for (let offset = 0; offset < count; offset += 1) {
      const index = (from + offset) % count;
      if (options[index]?.label.toLowerCase().startsWith(needle)) return index;
    }
    return -1;
  };

  useLayoutEffect(() => {
    if (!present) return;
    const trigger = triggerRef.current;
    const menu = listRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const menuWidth = Math.max(triggerRect.width, menu?.offsetWidth ?? 0);
    const menuHeight = menu?.offsetHeight ?? 0;
    let top = triggerRect.bottom + MENU_GAP;
    if (top + menuHeight > window.innerHeight - MENU_PAD) {
      const above = triggerRect.top - MENU_GAP - menuHeight;
      if (above >= MENU_PAD) top = above;
      else top = Math.max(MENU_PAD, window.innerHeight - MENU_PAD - menuHeight);
    }
    let left = triggerRect.left;
    if (left + menuWidth > window.innerWidth - MENU_PAD) {
      left = window.innerWidth - MENU_PAD - menuWidth;
    }
    setPosition({
      left: Math.max(MENU_PAD, left),
      top,
      width: triggerRect.width,
    });
  }, [present, options, value]);

  useEffect(() => {
    if (open) setActiveIndex(selectedIndex);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
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

  useEffect(() => {
    return () => window.clearTimeout(searchRef.current.timer);
  }, []);

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;
    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        event.preventDefault();
        setOpen(true);
      }
      if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const index = findByQuery(key, selectedIndex);
        if (index >= 0) {
          event.preventDefault();
          setOpen(true);
          setActiveIndex(index);
        }
      }
      return;
    }

    if (key === "ArrowDown") {
      event.preventDefault();
      moveActive(activeIndex + 1);
      return;
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      moveActive(activeIndex - 1);
      return;
    }
    if (key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, options.length - 1));
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      selectIndex(activeIndex);
      return;
    }
    if (key === "Tab") {
      close();
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const nextQuery = `${searchRef.current.query}${key}`;
      window.clearTimeout(searchRef.current.timer);
      searchRef.current.query = nextQuery;
      searchRef.current.timer = window.setTimeout(() => {
        searchRef.current.query = "";
      }, 500);
      const index = findByQuery(nextQuery, activeIndex);
      if (index >= 0) setActiveIndex(index);
    }
  };

  return (
    <div {...stylex.props(styles.root, style)}>
      <button
        ref={triggerRef}
        {...stylex.props(styles.inputSurface, styles.field)}
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        aria-label={label}
        data-state={open ? "open" : "closed"}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
        role="combobox"
        type="button"
      >
        <span {...stylex.props(styles.value)}>{selected?.label}</span>
        <ChevronDown
          {...stylex.props(styles.caret, open && styles.caretOpen)}
          aria-hidden
          strokeWidth={1.8}
        />
      </button>
      {present &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={listRef}
            {...stylex.props(
              selectMenuStyles.menu,
              visible && selectMenuStyles.visible,
              selectMenuStyles.position(position.left, position.top, position.width),
            )}
            aria-hidden={!open}
            aria-label={label}
            data-state={visible ? "open" : "closed"}
            id={listId}
            role="listbox"
          >
            {options.map((option, index) => {
              const selectedOption = option.value === value;
              return (
                <div
                  {...stylex.props(
                    selectMenuStyles.option,
                    selectedOption && selectMenuStyles.selected,
                    index === activeIndex && selectMenuStyles.active,
                  )}
                  aria-selected={selectedOption}
                  id={optionId(index)}
                  key={option.value}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectIndex(index)}
                  role="option"
                >
                  <span {...stylex.props(selectMenuStyles.label)}>{option.label}</span>
                  {selectedOption && (
                    <Check
                      {...stylex.props(selectMenuStyles.icon)}
                      aria-hidden
                      strokeWidth={2.4}
                    />
                  )}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

const focusShadow = `0 0 0 3px color-mix(in srgb, ${accents.primary} 14%, transparent), inset 0 1px rgb(255 255 255 / 36%)`;
const darkFocusShadow = `0 0 0 3px color-mix(in srgb, ${accents.primary} 20%, transparent), inset 0 1px rgb(255 255 255 / 4%)`;

const styles = stylex.create({
  root: {
    position: "relative",
    display: "inline-flex",
    minWidth: "168px",
    maxWidth: "100%",
  },
  inputSurface: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: `color-mix(in srgb, ${colors.border} 90%, transparent)`,
      ":hover": colors.border,
      ":focus": `color-mix(in srgb, ${accents.primary} 55%, ${colors.border})`,
      ":focus-visible": `color-mix(in srgb, ${accents.primary} 55%, ${colors.border})`,
    },
    borderRadius: "8px",
    backgroundColor: {
      default: `color-mix(in srgb, ${colors.elevated} 88%, ${colors.panel})`,
      ":focus": colors.elevated,
      ":focus-visible": colors.elevated,
    },
    fontWeight: 450,
    letterSpacing: 0,
    boxShadow: {
      default: "inset 0 1px rgb(255 255 255 / 36%)",
      ":focus": focusShadow,
      ":focus-visible": focusShadow,
      ':is([data-theme="dark"] *)': {
        default: "inset 0 1px rgb(255 255 255 / 4%)",
        ":focus": darkFocusShadow,
        ":focus-visible": darkFocusShadow,
      },
    },
    outline: {
      default: null,
      ":focus": "none",
      ":focus-visible": "none",
    },
    transitionProperty: "border-color, background-color, box-shadow",
    transitionDuration: "150ms",
    transitionTimingFunction: motion.ease,
  },
  field: {
    appearance: "none",
    display: "flex",
    width: "100%",
    height: "33px",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "0 9px 0 11px",
    color: colors.text,
    fontFamily: "inherit",
    fontSize: "12px",
    fontWeight: 550,
    lineHeight: 1,
    margin: 0,
    textAlign: "left",
    cursor: "pointer",
  },
  value: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  caret: {
    flexShrink: 0,
    width: "13px",
    height: "13px",
    color: colors.muted,
    transitionProperty: "transform",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.ease,
  },
  caretOpen: {
    transform: "rotate(180deg)",
  },
});
