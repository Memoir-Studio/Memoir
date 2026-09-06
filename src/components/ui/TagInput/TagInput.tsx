import * as stylex from "@stylexjs/stylex";
import { ChevronDown, Plus, X } from "lucide-react";
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
import { addUniqueTags, normalizeTag, parseTagTokens } from "../../../domain/notes";
import {
  accents,
  colors,
  motion,
} from "../../../styles/tokens.stylex";
import {
  filterComboboxOptions,
  suggestAutocomplete,
  type ComboboxOption,
} from "../Combobox";
import { Tag } from "../Tag";
import { selectMenuStyles } from "../select-menu.stylex";
import { usePresence } from "../usePresence";

const MENU_GAP = 6;
const MENU_PAD = 8;

type ListItem = ComboboxOption & { create?: boolean };

function hasExactOption(options: ComboboxOption[], query: string) {
  const needle = query.trim().toLowerCase();
  return options.some((option) => option.value.toLowerCase() === needle);
}

export function TagInput({
  label,
  value,
  query,
  options,
  onChange,
  onQueryChange,
  placeholder,
  disabled,
  allowCreate = true,
  createLabel,
  emptyLabel,
  removeLabel,
  style,
}: {
  label: string;
  value: string[];
  query: string;
  options: ComboboxOption[];
  onChange: (value: string[]) => void;
  onQueryChange: (query: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowCreate?: boolean;
  createLabel?: (query: string) => string;
  emptyLabel?: string;
  removeLabel: (tag: string) => string;
  style?: stylex.StyleXStyles;
}) {
  const listId = useId();
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const { present, visible } = usePresence(open);
  const [activeIndex, setActiveIndex] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });

  const selectedKeys = useMemo(() => new Set(value.map(normalizeTag)), [value]);
  const available = useMemo(
    () => options.filter((option) => !selectedKeys.has(normalizeTag(option.value))),
    [options, selectedKeys],
  );
  const filtered = useMemo(() => filterComboboxOptions(available, query), [available, query]);
  const trimmedQuery = query.trim();
  const alreadySelected = Boolean(trimmedQuery) && selectedKeys.has(normalizeTag(trimmedQuery));
  const showCreate = Boolean(
    allowCreate && trimmedQuery && !alreadySelected && !hasExactOption(options, trimmedQuery),
  );
  const items = useMemo<ListItem[]>(() => {
    const next: ListItem[] = [...filtered];
    if (showCreate) {
      next.push({
        value: trimmedQuery,
        label: createLabel?.(trimmedQuery) ?? trimmedQuery,
        create: true,
      });
    }
    return next;
  }, [createLabel, filtered, showCreate, trimmedQuery]);

  const optionId = useMemo(() => (index: number) => `${listId}-opt-${index}`, [listId]);

  const close = () => {
    setOpen(false);
    setNavigated(false);
  };

  const commitTags = (incoming: string[]) => {
    const next = addUniqueTags(value, incoming);
    onChange(next);
    onQueryChange("");
    setNavigated(false);
    setActiveIndex(0);
    setOpen(true);
    inputRef.current?.focus();
  };

  const commitQuery = () => {
    const tokens = parseTagTokens(query);
    if (!tokens.length) return false;
    commitTags(tokens);
    return true;
  };

  const removeTag = (tag: string) => {
    const key = normalizeTag(tag);
    onChange(value.filter((item) => normalizeTag(item) !== key));
    inputRef.current?.focus();
  };

  const moveActive = (delta: number) => {
    if (!items.length) return;
    setActiveIndex((current) => (current + delta + items.length) % items.length);
  };

  const applyTypedValue = (next: string) => {
    const deleting = next.length < query.length;
    if (/[,，]/.test(next)) {
      const tokens = parseTagTokens(next);
      if (tokens.length) {
        commitTags(tokens);
        return;
      }
    }
    onQueryChange(next);
    setOpen(true);
    setNavigated(false);
    setActiveIndex(0);
    if (composingRef.current || deleting || !next) return;
    const suggestion = suggestAutocomplete(
      available.map((option) => option.value),
      next,
    );
    if (!suggestion) return;
    onQueryChange(suggestion);
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(next.length, suggestion.length);
    });
  };

  useLayoutEffect(() => {
    if (!present) return;
    const trigger = fieldRef.current;
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
  }, [items, present, query, value]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    setNavigated(false);
  }, [open]);

  useEffect(() => {
    if (!open || !items.length) return;
    setActiveIndex((current) => Math.min(current, items.length - 1));
  }, [items, open]);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(activeIndex))}`);
    active?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open, optionId]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (fieldRef.current?.contains(target) || listRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      inputRef.current?.focus();
    };
    const onViewportChange = () => close();
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

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.key === "Process") return;
    const { key } = event;

    if (key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setNavigated(true);
      moveActive(1);
      return;
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setNavigated(true);
      moveActive(-1);
      return;
    }
    if (key === "Home" && open && navigated) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (key === "End" && open && navigated) {
      event.preventDefault();
      setActiveIndex(Math.max(0, items.length - 1));
      return;
    }
    if (key === "Backspace" && !query && value.length) {
      event.preventDefault();
      removeTag(value[value.length - 1]);
      return;
    }
    if (key === "Enter") {
      if (open && navigated && items[activeIndex]) {
        event.preventDefault();
        commitTags([items[activeIndex].value]);
        return;
      }
      if (trimmedQuery) {
        event.preventDefault();
        commitQuery();
      }
      return;
    }
    if (key === "Tab") {
      close();
    }
  };

  return (
    <div {...stylex.props(styles.root, style)}>
      <div
        {...stylex.props(styles.field)}
        onClick={() => {
          inputRef.current?.focus();
          setOpen(true);
        }}
        ref={fieldRef}
      >
        {value.map((tag) => (
          <Tag key={normalizeTag(tag)} style={styles.chip}>
            {tag}
            <button
              {...stylex.props(styles.removeButton)}
              aria-label={removeLabel(tag)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                removeTag(tag);
              }}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              <X {...stylex.props(styles.removeIcon)} aria-hidden strokeWidth={2.2} />
            </button>
          </Tag>
        ))}
        <input
          ref={inputRef}
          {...stylex.props(styles.input)}
          aria-activedescendant={open && items[activeIndex] ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={label}
          autoComplete="off"
          autoCorrect="off"
          disabled={disabled}
          onBlur={() => {
            if (listRef.current?.contains(document.activeElement)) return;
            commitQuery();
          }}
          onChange={(event) => applyTypedValue(event.target.value)}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            applyTypedValue(event.currentTarget.value);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onKeyDown={onInputKeyDown}
          placeholder={value.length ? undefined : placeholder}
          role="combobox"
          spellCheck={false}
          value={query}
        />
        <span
          {...stylex.props(styles.caret, open && styles.caretOpen)}
          aria-hidden
          data-state={open ? "open" : "closed"}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((current) => !current);
            inputRef.current?.focus();
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <ChevronDown strokeWidth={1.8} />
        </span>
      </div>
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
            {items.length === 0 ? (
              <div {...stylex.props(selectMenuStyles.empty)}>{emptyLabel}</div>
            ) : (
              items.map((item, index) => (
                <div
                  {...stylex.props(
                    selectMenuStyles.option,
                    item.create && selectMenuStyles.create,
                    index === activeIndex && selectMenuStyles.active,
                  )}
                  aria-selected={index === activeIndex}
                  data-create={item.create || undefined}
                  id={optionId(index)}
                  key={item.create ? `${item.value}::create` : item.value}
                  onClick={() => commitTags([item.value])}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    setActiveIndex(index);
                    setNavigated(true);
                  }}
                  role="option"
                >
                  <span {...stylex.props(selectMenuStyles.label)}>{item.label}</span>
                  {item.create && (
                    <Plus
                      {...stylex.props(selectMenuStyles.icon)}
                      aria-hidden
                      strokeWidth={2.2}
                    />
                  )}
                </div>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

const styles = stylex.create({
  root: {
    position: "relative",
    display: "block",
    width: "100%",
  },
  field: {
    position: "relative",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "5px",
    minHeight: "32px",
    padding: "4px 28px 4px 6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: `color-mix(in srgb, ${colors.border} 90%, transparent)`,
      ":hover": colors.border,
      ":focus-within": `color-mix(in srgb, ${accents.primary} 55%, ${colors.border})`,
    },
    borderRadius: "8px",
    backgroundColor: {
      default: `color-mix(in srgb, ${colors.elevated} 88%, ${colors.panel})`,
      ":focus-within": colors.elevated,
    },
    boxShadow: {
      default: "inset 0 1px rgb(255 255 255 / 36%)",
      ":focus-within": `0 0 0 3px color-mix(in srgb, ${accents.primary} 14%, transparent), inset 0 1px rgb(255 255 255 / 36%)`,
      ':is([data-theme="dark"] *)': {
        default: "inset 0 1px rgb(255 255 255 / 4%)",
        ":focus-within": `0 0 0 3px color-mix(in srgb, ${accents.primary} 20%, transparent), inset 0 1px rgb(255 255 255 / 4%)`,
      },
    },
    transitionProperty: "border-color, background-color, box-shadow",
    transitionDuration: "150ms",
    transitionTimingFunction: motion.ease,
  },
  input: {
    appearance: "none",
    flex: "1 1 72px",
    minWidth: "72px",
    height: "22px",
    padding: "0 2px",
    borderWidth: 0,
    backgroundColor: "transparent",
    color: colors.text,
    fontFamily: "inherit",
    fontSize: "13px",
    letterSpacing: 0,
    margin: 0,
    outline: "none",
    "::placeholder": {
      color: colors.muted,
    },
  },
  chip: {
    maxWidth: "100%",
    gap: "1px",
    paddingRight: "2px",
  },
  removeButton: {
    appearance: "none",
    display: "grid",
    width: "16px",
    height: "16px",
    flexShrink: 0,
    placeItems: "center",
    padding: 0,
    borderWidth: 0,
    borderRadius: "4px",
    backgroundColor: {
      default: "transparent",
      ":hover": `color-mix(in srgb, ${accents.soft} 80%, transparent)`,
      ":focus-visible": `color-mix(in srgb, ${accents.soft} 80%, transparent)`,
    },
    color: {
      default: colors.muted,
      ":hover": colors.text,
      ":focus-visible": colors.text,
    },
    cursor: "pointer",
    margin: 0,
    outline: {
      default: null,
      ":focus-visible": "none",
    },
  },
  removeIcon: {
    width: "11px",
    height: "11px",
  },
  caret: {
    position: "absolute",
    top: "8px",
    right: "8px",
    display: "grid",
    width: "16px",
    height: "16px",
    placeItems: "center",
    color: colors.muted,
    cursor: "pointer",
    transitionProperty: "transform",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.ease,
  },
  caretOpen: {
    transform: "rotate(180deg)",
  },
});
