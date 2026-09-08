import * as stylex from "@stylexjs/stylex";
import { accents, colors, motion } from "../../../styles/tokens.stylex";

const styles = stylex.create({
  track: {
    alignItems: "center",
    appearance: "none",
    borderWidth: 0,
    borderRadius: 999,
    boxShadow: "inset 0 1px 2px rgb(43 38 31 / 12%)",
    color: "inherit",
    cursor: "pointer",
    display: "inline-flex",
    flexShrink: 0,
    height: 22,
    margin: 0,
    padding: 3,
    position: "relative",
    transitionDuration: "150ms",
    transitionProperty: "background-color",
    transitionTimingFunction: motion.ease,
    width: 38,
  },
  checked: {
    backgroundColor: accents.primary,
  },
  unchecked: {
    backgroundColor: colors.border,
  },
  thumb: {
    backgroundColor: colors.elevated,
    borderRadius: 999,
    boxShadow:
      "0 1px 3px 0 rgb(0 0 0 / 10%), 0 1px 2px -1px rgb(0 0 0 / 10%)",
    display: "block",
    height: 16,
    pointerEvents: "none",
    transitionDuration: "200ms",
    transitionProperty: "transform",
    transitionTimingFunction: motion.ease,
    width: 16,
  },
  thumbChecked: {
    transform: "translateX(16px)",
  },
});

export function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      data-state={checked ? "checked" : "unchecked"}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
      {...stylex.props(styles.track, checked ? styles.checked : styles.unchecked)}
    >
      <span {...stylex.props(styles.thumb, checked && styles.thumbChecked)} />
    </button>
  );
}
