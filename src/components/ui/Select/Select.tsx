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
import { cn } from "../cn";
import { usePresence } from "../usePresence";

const MENU_GAP = 6;
const MENU_PAD = 8;

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
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
    <div className={cn("memoir-select", className)}>
      <button
        ref={triggerRef}
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        aria-label={label}
        className={cn("memoir-select-field memoir-input", open && "is-open")}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
        role="combobox"
        type="button"
      >
        <span className="memoir-select-value">{selected?.label}</span>
        <ChevronDown
          aria-hidden
          className={cn("memoir-select-caret", open && "is-open")}
          strokeWidth={1.8}
        />
      </button>
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
            {options.map((option, index) => {
              const selectedOption = option.value === value;
              return (
                <div
                  aria-selected={selectedOption}
                  className={cn(
                    "memoir-select-option",
                    selectedOption && "is-selected",
                    index === activeIndex && "is-active",
                  )}
                  id={optionId(index)}
                  key={option.value}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectIndex(index)}
                  role="option"
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {selectedOption && <Check aria-hidden strokeWidth={2.4} />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
