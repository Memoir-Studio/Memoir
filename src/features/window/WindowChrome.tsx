import { useI18n } from "../../i18n/react";
import { isTauriRuntime } from "../../platform/runtime";
import {
  performWindowAction,
  startWindowResize,
  type WindowResizeDirection,
} from "../../platform/window";

const resizeHandles: Array<{ direction: WindowResizeDirection; className: string }> = [
  { direction: "North", className: "left-3 right-3 top-0 h-1.5 cursor-ns-resize" },
  { direction: "South", className: "bottom-0 left-3 right-3 h-1.5 cursor-ns-resize" },
  { direction: "West", className: "bottom-3 left-0 top-3 w-1.5 cursor-ew-resize" },
  { direction: "East", className: "bottom-3 right-0 top-3 w-1.5 cursor-ew-resize" },
  { direction: "NorthWest", className: "left-0 top-0 h-3.5 w-3.5 cursor-nwse-resize" },
  { direction: "NorthEast", className: "right-0 top-0 h-3.5 w-3.5 cursor-nesw-resize" },
  { direction: "SouthWest", className: "bottom-0 left-0 h-3.5 w-3.5 cursor-nesw-resize" },
  { direction: "SouthEast", className: "bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize" },
];

const windowControls = {
  close: "bg-[#ff5f57]",
  minimize: "bg-[#ffbd2e]",
  maximize: "bg-[#28c840]",
} as const;

export function WindowChrome({ controlsHidden = false }: { controlsHidden?: boolean }) {
  const { t } = useI18n();
  if (!isTauriRuntime()) return null;

  const controlLabels = {
    close: t("window.close"),
    minimize: t("window.minimize"),
    maximize: t("window.maximize"),
  } as const;

  return (
    <>
      {!controlsHidden && (
        <div className="memoir-window-controls max-[760px]:hidden">
          {(["close", "minimize", "maximize"] as const).map((type) => (
            <button
              aria-label={controlLabels[type]}
              className={`h-[13px] w-[13px] rounded-full border border-text/10 ${windowControls[type]}`}
              key={type}
              onClick={() => void performWindowAction(type)}
              type="button"
            />
          ))}
        </div>
      )}
      <div
        aria-hidden="true"
        className="memoir-window-resize pointer-events-none absolute inset-0 z-[80]"
      >
        {resizeHandles.map(({ direction, className }) => (
          <div
            className={`pointer-events-auto absolute ${className}`}
            key={direction}
            onMouseDown={() => void startWindowResize(direction)}
          />
        ))}
      </div>
    </>
  );
}
