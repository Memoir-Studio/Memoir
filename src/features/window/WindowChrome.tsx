import * as stylex from "@stylexjs/stylex";
import type { MouseEvent, ReactNode } from "react";
import { useI18n } from "../../i18n/react";
import { isTauriRuntime } from "../../platform/runtime";
import { layout, media } from "../../styles/tokens.stylex";
import {
  performWindowAction,
  startWindowResize,
  type WindowResizeDirection,
} from "../../platform/window";
import { handleWindowDragMouseDown } from "./window-drag";

const resizeHandles: WindowResizeDirection[] = [
  "North",
  "South",
  "West",
  "East",
  "NorthWest",
  "NorthEast",
  "SouthWest",
  "SouthEast",
];

type WindowControlsPosition = "left" | "right";

export function WindowControls({
  inline = false,
  position = "left",
}: {
  inline?: boolean;
  position?: WindowControlsPosition;
}) {
  const { t } = useI18n();
  if (!isTauriRuntime()) return null;

  const controlLabels = {
    close: t("window.close"),
    minimize: t("window.minimize"),
    maximize: t("window.maximize"),
  } as const;
  const controls = position === "right"
    ? (["minimize", "maximize", "close"] as const)
    : (["close", "minimize", "maximize"] as const);

  return (
    <div
      data-window-controls-position={position}
      {...stylex.props(
        styles.controls,
        position === "right" && styles.controlsRight,
        inline && styles.controlsInline,
      )}
    >
      {controls.map((type) => (
        <button
          aria-label={controlLabels[type]}
          data-window-drag="ignore"
          key={type}
          onClick={() => void performWindowAction(type)}
          type="button"
          {...stylex.props(styles.control, styles[type])}
        />
      ))}
    </div>
  );
}

export function WindowChrome({ controlsHidden = false }: { controlsHidden?: boolean }) {
  if (!isTauriRuntime()) return null;

  return (
    <>
      {!controlsHidden && <WindowControls />}
      <div
        aria-hidden="true"
        {...stylex.props(styles.resizeLayer)}
      >
        {resizeHandles.map((direction) => (
          <div
            data-window-drag="ignore"
            key={direction}
            onMouseDown={(event) => {
              event.stopPropagation();
              void startWindowResize(direction);
            }}
            {...stylex.props(styles.resizeHandle, styles[direction])}
          />
        ))}
      </div>
    </>
  );
}

export function WindowFrame({
  children,
  controlsHidden = false,
  surfaceDrag = false,
}: {
  children: ReactNode;
  controlsHidden?: boolean;
  surfaceDrag?: boolean;
}) {
  const onSurfaceMouseDown = surfaceDrag
    ? (event: MouseEvent<HTMLDivElement>) => handleWindowDragMouseDown(event)
    : undefined;

  return (
    <div onMouseDown={onSurfaceMouseDown} {...stylex.props(styles.frame)}>
      <WindowChrome controlsHidden={controlsHidden} />
      {surfaceDrag && isTauriRuntime() && (
        <div
          aria-hidden="true"
          data-window-drag-bar=""
          data-tauri-drag-region=""
          onMouseDown={handleWindowDragMouseDown}
          {...stylex.props(styles.dragBar)}
        />
      )}
      {children}
    </div>
  );
}

const styles = stylex.create({
  frame: {
    position: "relative",
    boxSizing: "border-box",
    width: "100%",
    height: {
      default: "100%",
      [media.mobile]: "auto",
    },
    minHeight: {
      default: null,
      [media.mobile]: "100%",
    },
    padding: {
      default: layout.windowInset,
      [stylex.when.ancestor('[data-maximized="true"]')]: 0,
      [stylex.when.ancestor('[data-window-frame="flush"]')]: 0,
      [stylex.when.ancestor('[data-window-frame="native"]')]: 0,
      [media.mobile]: 0,
    },
    backgroundColor: "transparent",
  },
  controls: {
    position: "absolute",
    left: `calc(${layout.windowInset} + 12px)`,
    top: `calc(${layout.windowInset} + 16px)`,
    zIndex: 30,
    display: {
      default: "flex",
      [media.mobile]: "none",
    },
    gap: 8,
  },
  controlsRight: {
    right: `calc(${layout.windowInset} + 12px)`,
    left: "auto",
  },
  controlsInline: {
    position: "static",
    flexShrink: 0,
    marginLeft: 8,
    paddingLeft: 14,
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: "color-mix(in srgb, var(--memoir-text) 10%, transparent)",
  },
  control: {
    width: 13,
    height: 13,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "color-mix(in srgb, var(--memoir-text) 10%, transparent)",
    borderRadius: 999,
  },
  close: { backgroundColor: "#ff5f57" },
  minimize: { backgroundColor: "#ffbd2e" },
  maximize: { backgroundColor: "#28c840" },
  dragBar: {
    position: "absolute",
    insetInline: layout.windowInset,
    top: layout.windowInset,
    zIndex: 25,
    display: {
      default: "block",
      [media.mobile]: "none",
    },
    height: 44,
  },
  resizeLayer: {
    pointerEvents: "none",
    position: "absolute",
    inset: 0,
    zIndex: 80,
    display: {
      default: "block",
      [stylex.when.ancestor('[data-maximized="true"]')]: "none",
    },
  },
  resizeHandle: {
    pointerEvents: "auto",
    position: "absolute",
  },
  North: { left: 12, right: 12, top: 0, height: 6, cursor: "ns-resize" },
  South: { bottom: 0, left: 12, right: 12, height: 6, cursor: "ns-resize" },
  West: { bottom: 12, left: 0, top: 12, width: 6, cursor: "ew-resize" },
  East: { bottom: 12, right: 0, top: 12, width: 6, cursor: "ew-resize" },
  NorthWest: { left: 0, top: 0, width: 14, height: 14, cursor: "nwse-resize" },
  NorthEast: { right: 0, top: 0, width: 14, height: 14, cursor: "nesw-resize" },
  SouthWest: { bottom: 0, left: 0, width: 14, height: 14, cursor: "nesw-resize" },
  SouthEast: { bottom: 0, right: 0, width: 14, height: 14, cursor: "nwse-resize" },
});
