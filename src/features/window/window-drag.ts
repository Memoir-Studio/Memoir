import type { MouseEvent } from "react";
import { isTauriRuntime } from "../../platform/runtime";
import { startWindowDragging } from "../../platform/window";

const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='switch']",
  "[role='separator']",
  "[data-window-drag='ignore']",
].join(",");

export function handleWindowDragMouseDown(event: MouseEvent<HTMLElement>) {
  if (!isTauriRuntime() || event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element) || target.closest(INTERACTIVE_SELECTOR)) return;
  void startWindowDragging();
}
