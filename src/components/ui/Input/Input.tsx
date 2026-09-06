import * as stylex from "@stylexjs/stylex";
import { forwardRef, type InputHTMLAttributes } from "react";
import {
  accents,
  colors,
  motion,
  typography,
} from "../../../styles/tokens.stylex";

const styles = stylex.create({
  input: {
    appearance: "none",
    backgroundColor: {
      default: `color-mix(in srgb, ${colors.elevated} 88%, ${colors.panel})`,
      ":focus": colors.elevated,
      ":focus-visible": colors.elevated,
    },
    borderColor: {
      default: `color-mix(in srgb, ${colors.border} 90%, transparent)`,
      ":hover": `color-mix(in srgb, ${colors.border} 100%, transparent)`,
      ":focus": `color-mix(in srgb, ${accents.primary} 55%, ${colors.border})`,
      ":focus-visible": `color-mix(in srgb, ${accents.primary} 55%, ${colors.border})`,
    },
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: {
      default: "inset 0 1px rgb(255 255 255 / 36%)",
      ":focus": `0 0 0 3px color-mix(in srgb, ${accents.primary} 14%, transparent), inset 0 1px rgb(255 255 255 / 36%)`,
      ":focus-visible": `0 0 0 3px color-mix(in srgb, ${accents.primary} 14%, transparent), inset 0 1px rgb(255 255 255 / 36%)`,
      ':is([data-theme="dark"] *)': {
        default: "inset 0 1px rgb(255 255 255 / 4%)",
        ":focus": `0 0 0 3px color-mix(in srgb, ${accents.primary} 20%, transparent), inset 0 1px rgb(255 255 255 / 4%)`,
        ":focus-visible": `0 0 0 3px color-mix(in srgb, ${accents.primary} 20%, transparent), inset 0 1px rgb(255 255 255 / 4%)`,
      },
    },
    color: colors.text,
    fontFamily: typography.uiFont,
    fontSize: 13,
    fontWeight: 450,
    height: 32,
    letterSpacing: 0,
    margin: 0,
    outline: "none",
    paddingBlock: 0,
    paddingInline: 12,
    transitionDuration: "150ms",
    transitionProperty: "border-color, background-color, box-shadow",
    transitionTimingFunction: motion.ease,
    width: "100%",
    "::placeholder": {
      color: colors.muted,
    },
  },
});

export type InputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "style"
> & {
  style?: stylex.StyleXStyles;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ style, ...props }, ref) {
    return (
      <input ref={ref} {...props} {...stylex.props(styles.input, style)} />
    );
  },
);
