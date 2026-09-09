import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, motion, typography } from "../../../styles/tokens.stylex";

const styles = stylex.create({
  root: {
    alignItems: "center",
    backgroundColor: `color-mix(in srgb, ${colors.panel} 74%, transparent)`,
    borderColor: `color-mix(in srgb, ${colors.border} 88%, transparent)`,
    borderRadius: 6,
    borderStyle: "solid",
    borderWidth: 1,
    display: "inline-flex",
    padding: 3,
  },
  option: {
    alignItems: "center",
    appearance: "none",
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: 6,
    color: colors.muted,
    cursor: "pointer",
    display: "inline-flex",
    fontFamily: typography.uiFont,
    fontSize: 11,
    fontWeight: 500,
    gap: 5,
    height: 27,
    justifyContent: "center",
    margin: 0,
    paddingBlock: 0,
    paddingInline: 10,
    transitionDuration: "150ms",
    transitionProperty: "color, background-color, box-shadow",
    transitionTimingFunction: motion.ease,
  },
  selected: {
    backgroundColor: colors.elevated,
    boxShadow: "0 1px 2px rgb(35 33 29 / 10%), inset 0 0 0 1px rgb(255 255 255 / 46%)",
    color: colors.text,
    fontWeight: 650,
  },
  iconTextOption: {
    minWidth: 52,
    height: 30,
    paddingInline: 8,
  },
  iconOption: {
    width: 27,
    minWidth: 27,
    height: 25,
    padding: 0,
  },
});

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
};

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  style,
  display = "text",
}: {
  label: string;
  value: T;
  options: Array<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
  style?: stylex.StyleXStyles;
  display?: "text" | "icon-text" | "icon";
}) {
  return (
    <div aria-label={label} role="group" {...stylex.props(styles.root, style)}>
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          data-state={value === option.value ? "selected" : "unselected"}
          key={option.value}
          onClick={() => onChange(option.value)}
          title={display === "icon" ? option.label : undefined}
          type="button"
          {...stylex.props(
            styles.option,
            value === option.value && styles.selected,
            display === "icon-text" && styles.iconTextOption,
            display === "icon" && styles.iconOption,
          )}
        >
          {option.icon}
          {display !== "icon" && <span>{option.label}</span>}
        </button>
      ))}
    </div>
  );
}
