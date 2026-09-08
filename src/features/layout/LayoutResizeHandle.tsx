import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { accents, media, motion } from "../../styles/tokens.stylex";

function clamp(value: number, min: number, max: number) {
  if (min > max) return min;
  return Math.min(max, Math.max(min, value));
}

export function LayoutResizeHandle({
  label,
  value,
  min,
  max,
  defaultValue,
  step = 12,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const dragRef = useRef<{
    startX: number;
    startValue: number;
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
  } | null>(null);
  const valueRef = useRef(value);
  const rangeRef = useRef({ low: min, high: max });
  const onChangeRef = useRef(onChange);
  const [dragging, setDragging] = useState(false);
  valueRef.current = value;
  onChangeRef.current = onChange;
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  rangeRef.current = { low, high };
  const canResize = !disabled && high - low >= 1;

  const stopDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    delete document.documentElement.dataset.layoutResizing;
    window.removeEventListener("pointermove", drag.move);
    window.removeEventListener("pointerup", drag.up);
    window.removeEventListener("pointercancel", drag.up);
  };

  useEffect(() => {
    return () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      delete document.documentElement.dataset.layoutResizing;
      window.removeEventListener("pointermove", drag.move);
      window.removeEventListener("pointerup", drag.up);
      window.removeEventListener("pointercancel", drag.up);
    };
  }, []);

  const applyPointerDelta = (clientX: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const range = rangeRef.current;
    onChangeRef.current(clamp(drag.startValue + (clientX - drag.startX), range.low, range.high));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button > 0 || !canResize) return;
    event.preventDefault();
    event.stopPropagation();
    const move = (pointerEvent: PointerEvent) => applyPointerDelta(pointerEvent.clientX);
    const up = () => stopDrag();
    dragRef.current = {
      startX: event.clientX,
      startValue: valueRef.current,
      move,
      up,
    };
    setDragging(true);
    document.documentElement.dataset.layoutResizing = "true";
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom and some hosts do not implement pointer capture.
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div
      aria-disabled={!canResize}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={Math.round(high)}
      aria-valuemin={Math.round(low)}
      aria-valuenow={Math.round(clamp(value, low, high))}
      data-window-drag="ignore"
      onDoubleClick={() => {
        if (!canResize) return;
        onChange(clamp(defaultValue, low, high));
      }}
      onKeyDown={(event) => {
        if (!canResize) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const delta = event.key === "ArrowLeft" ? -step : step;
          onChange(clamp(valueRef.current + delta, low, high));
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          onChange(low);
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          onChange(high);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          onChange(clamp(defaultValue, low, high));
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => applyPointerDelta(event.clientX)}
      onPointerUp={() => stopDrag()}
      onPointerCancel={() => stopDrag()}
      role="separator"
      tabIndex={canResize ? 0 : -1}
      {...stylex.props(styles.handle, dragging && styles.handleActive)}
    >
      <span aria-hidden="true" {...stylex.props(styles.indicator)} />
    </div>
  );
}

const styles = stylex.create({
  handle: {
    position: "absolute",
    top: 0,
    right: -4,
    zIndex: 28,
    display: {
      default: "block",
      [media.mobile]: "none",
    },
    width: 8,
    height: "100%",
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: {
      default: "transparent",
      ":hover": `color-mix(in srgb, ${accents.primary} 58%, transparent)`,
      ":focus-visible": `color-mix(in srgb, ${accents.primary} 58%, transparent)`,
    },
    cursor: "col-resize",
    touchAction: "none",
    outline: "none",
  },
  handleActive: {
    color: `color-mix(in srgb, ${accents.primary} 58%, transparent)`,
  },
  indicator: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 3,
    width: 2,
    borderRadius: 1,
    backgroundColor: "currentColor",
    transitionProperty: "background-color",
    transitionDuration: {
      default: "120ms",
      [media.reducedMotion]: "0s",
    },
    transitionTimingFunction: motion.ease,
  },
});
