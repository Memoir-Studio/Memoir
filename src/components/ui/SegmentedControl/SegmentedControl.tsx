import * as stylex from "@stylexjs/stylex";
import { colors, motion, typography } from "../../../styles/tokens.stylex";

const styles = stylex.create({
  root: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 6,
    borderStyle: "solid",
    borderWidth: 1,
    display: "inline-flex",
    padding: 2,
  },
  option: {
    appearance: "none",
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: 4,
    color: colors.muted,
    cursor: "pointer",
    fontFamily: typography.uiFont,
    fontSize: 12,
    height: 28,
    margin: 0,
    paddingBlock: 0,
    paddingInline: 10,
    transitionDuration: "150ms",
    transitionProperty: "color, background-color, box-shadow",
    transitionTimingFunction: motion.ease,
  },
  selected: {
    backgroundColor: colors.elevated,
    boxShadow:
      "0 1px 3px 0 rgb(0 0 0 / 10%), 0 1px 2px -1px rgb(0 0 0 / 10%)",
    color: colors.text,
    fontWeight: 600,
  },
});

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  style,
  optionStyle,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  style?: stylex.StyleXStyles;
  optionStyle?: stylex.StyleXStyles;
}) {
  return (
    <div aria-label={label} role="group" {...stylex.props(styles.root, style)}>
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          data-state={value === option.value ? "selected" : "unselected"}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
          {...stylex.props(
            styles.option,
            value === option.value && styles.selected,
            optionStyle,
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
