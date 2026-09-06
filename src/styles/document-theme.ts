import * as stylex from "@stylexjs/stylex";
import type { AccentColor, AppSettings } from "../domain/settings";
import {
  accentThemes,
  darkTheme,
  documentMarker,
  documentStyles,
  lightTheme,
} from "./tokens.stylex";

type ManagedStyle = {
  classes: string[];
  properties: string[];
};

const managedStyles = new WeakMap<HTMLElement, ManagedStyle>();

function setManagedStyle(element: HTMLElement, props: ReturnType<typeof stylex.props>) {
  const previous = managedStyles.get(element);
  if (previous) {
    element.classList.remove(...previous.classes);
    for (const property of previous.properties) element.style.removeProperty(property);
  }

  const classes = props.className?.split(/\s+/).filter(Boolean) ?? [];
  if (classes.length) element.classList.add(...classes);

  const properties = Object.keys(props.style ?? {});
  for (const property of properties) {
    element.style.setProperty(property, String(props.style?.[property]));
  }
  managedStyles.set(element, { classes, properties });
}

export function themeStyles(isDark: boolean, accent: AccentColor) {
  return [
    isDark ? darkTheme : lightTheme,
    accentThemes[isDark ? "dark" : "light"][accent],
  ] as const;
}

export function applyDocumentTheme(
  appearance: AppSettings["appearance"],
  isDark: boolean,
  root: HTMLElement = document.documentElement,
) {
  setManagedStyle(
    root,
    stylex.props(
      documentMarker,
      documentStyles.root,
      isDark && documentStyles.dark,
      ...themeStyles(isDark, appearance.accent),
      appearance.background === "pure" && documentStyles.pureBackground,
      documentStyles.appearance(`${appearance.bodyFontSize}px`, String(appearance.lineHeight)),
      documentStyles.compatibilityVariables,
    ),
  );
}

export function applyElementTheme(
  element: HTMLElement,
  {
    accent,
    bodyFontSize,
    isDark,
    lineHeight,
  }: {
    accent: AccentColor;
    bodyFontSize: number;
    isDark: boolean;
    lineHeight: number;
  },
) {
  setManagedStyle(
    element,
    stylex.props(
      documentMarker,
      documentStyles.root,
      isDark && documentStyles.dark,
      ...themeStyles(isDark, accent),
      documentStyles.appearance(`${bodyFontSize}px`, String(lineHeight)),
      documentStyles.compatibilityVariables,
    ),
  );
}
