import { Check, ChevronDown, Plus } from "lucide-react";
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
import { cn } from "../cn";
import { Input } from "../Input";
import { usePresence } from "../usePresence";

const MENU_GAP = 6;
const MENU_PAD = 8;

export type ComboboxOption = {
  value: string;
  label: string;
};

type ListItem = ComboboxOption & { create?: boolean };

export function filterComboboxOptions(options: ComboboxOption[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  return options
    .map((option) => ({ option, score: scoreOption(option, needle) }))
    .filter((item) => item.score >= 0)
    .sort(
      (left, right) =>
        left.score - right.score || left.option.label.localeCompare(right.option.label),
    )
    .map((item) => item.option);
}

export function suggestAutocomplete(candidates: string[], query: string) {
  if (!query) return null;
  const needle = query.toLowerCase();
  const matches = candidates.filter(
    (candidate) => candidate.toLowerCase().startsWith(needle) && candidate.length > query.length,
  );
  if (!matches.length) return null;
  matches.sort((left, right) => left.length - right.length || left.localeCompare(right));
  return matches[0];
}

function scoreOption(option: ComboboxOption, needle: string) {
  const value = option.value.toLowerCase();
  const label = option.label.toLowerCase();
  if (value === needle || label === needle) return 0;
  if (value.startsWith(needle) || label.startsWith(needle)) return 1;
  if (value.includes(needle) || label.includes(needle)) return 2;
  return -1;
}

function hasExactOption(options: ComboboxOption[], query: string) {
  const needle = query.trim().toLowerCase();
  return options.some((option) => option.value.toLowerCase() === needle);
}

export function Combobox({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  autoFocus,
  allowCreate = true,
  createLabel,
  emptyLabel,
  className,
}: {
  label: string;
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  allowCreate?: boolean;
  createLabel?: (query: string) => string;
  emptyLabel?: string;
  className?: string;
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

  const filtered = useMemo(() => filterComboboxOptions(options, value), [options, value]);
  const query = value.trim();
  const showCreate = Boolean(allowCreate && query && !hasExactOption(options, query));
  const items = useMemo<ListItem[]>(() => {
    const next: ListItem[] = [...filtered];
    if (showCreate) {
      next.push({
        value: query,
        label: createLabel?.(query) ?? query,
        create: true,
      });
    }
    return next;
  }, [createLabel, filtered, query, showCreate]);

  const optionId = useMemo(
    () => (index: number) => `${listId}-opt-${index}`,
    [listId],
  );

  const close = () => {
    setOpen(false);
    setNavigated(false);
  };

  const commit = (next: string) => {
    onChange(next);
    close();
    inputRef.current?.focus();
  };

  const moveActive = (delta: number) => {
    if (!items.length) return;
    setActiveIndex((current) => (current + delta + items.length) % items.length);
  };

  const applyTypedValue = (next: string) => {
    const deleting = next.length < value.length;
    onChange(next);
    setOpen(true);
    setNavigated(false);
    setActiveIndex(0);
    if (composingRef.current || deleting || !next) return;
    const suggestion = suggestAutocomplete(
      options.map((option) => option.value),
      next,
    );
    if (!suggestion) return;
    onChange(suggestion);
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
  }, [items, present, value]);

  useEffect(() => {
    if (!open) return;
    const match = items.findIndex((item) => item.value === value && !item.create);
    setActiveIndex(match >= 0 ? match : 0);
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
    if (key === "Enter") {
      if (open && navigated && items[activeIndex]) {
        event.preventDefault();
        commit(items[activeIndex].value);
      }
      return;
    }
    if (key === "Tab") {
      close();
    }
  };

  return (
    <div className={cn("memoir-combobox", className)}>
      <div className="memoir-combobox-field" ref={fieldRef}>
        <Input
          ref={inputRef}
          aria-activedescendant={open && items[activeIndex] ? optionId(activeIndex) : undefined}
          aria-autocomplete="both"
          aria-controls={listId}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={label}
          autoComplete="off"
          autoCorrect="off"
          autoFocus={autoFocus}
          disabled={disabled}
          onChange={(event) => applyTypedValue(event.target.value)}
          onClick={() => setOpen(true)}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            applyTypedValue(event.currentTarget.value);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          role="combobox"
          spellCheck={false}
          value={value}
        />
        <span
          aria-hidden
          className={cn("memoir-combobox-caret", open && "is-open")}
          onClick={() => {
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
            aria-hidden={!open}
            aria-label={label}
            className={cn("memoir-select-menu", visible && "is-open")}
            id={listId}
            role="listbox"
            style={{ left: position.left, top: position.top, minWidth: position.width }}
          >
            {items.length === 0 ? (
              <div className="memoir-select-empty">{emptyLabel}</div>
            ) : (
              items.map((item, index) => {
                const selected = !item.create && item.value === value;
                return (
                  <div
                    aria-selected={selected}
                    className={cn(
                      "memoir-select-option",
                      item.create && "is-create",
                      selected && "is-selected",
                      index === activeIndex && "is-active",
                    )}
                    id={optionId(index)}
                    key={item.create ? `${item.value}::create` : item.value}
                    onClick={() => commit(item.value)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => {
                      setActiveIndex(index);
                      setNavigated(true);
                    }}
                    role="option"
                  >
                    <span className="min-w-0 truncate">{item.label}</span>
                    {item.create ? (
                      <Plus aria-hidden strokeWidth={2.2} />
                    ) : (
                      selected && <Check aria-hidden strokeWidth={2.4} />
                    )}
                  </div>
                );
              })
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
