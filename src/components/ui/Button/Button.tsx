import * as stylex from "@stylexjs/stylex";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import {
  accents,
  colors,
  motion,
  typography,
} from "../../../styles/tokens.stylex";

const styles = stylex.create({
  base: {
    alignItems: "center",
    appearance: "none",
    borderRadius: 8,
    cursor: "pointer",
    display: "inline-flex",
    fontFamily: typography.uiFont,
    fontSize: 12,
    fontWeight: 550,
    gap: 6,
    justifyContent: "center",
    letterSpacing: 0,
    lineHeight: 1,
    margin: 0,
    transitionDuration: "150ms",
    transitionProperty: "color, background-color, border-color, box-shadow",
    transitionTimingFunction: motion.ease,
    opacity: {
      default: 1,
      ":disabled": 0.5,
    },
    pointerEvents: {
      default: "auto",
      ":disabled": "none",
    },
  },
  primary: {
    backgroundColor: {
      default: accents.primary,
      ":hover": `color-mix(in srgb, ${accents.primary} 88%, ${colors.elevated})`,
      ":active": `color-mix(in srgb, ${accents.primary} 92%, ${colors.text})`,
    },
    borderWidth: 0,
    boxShadow: {
      default: `0 1px 2px color-mix(in srgb, ${accents.primary} 22%, transparent), inset 0 1px rgb(255 255 255 / 22%)`,
      ':is([data-theme="dark"] *)':
        "0 1px 2px rgb(0 0 0 / 28%), inset 0 1px rgb(255 255 255 / 8%)",
    },
    color: accents.contrast,
    fontWeight: 620,
  },
  secondary: {
    backgroundColor: {
      default: `color-mix(in srgb, ${colors.panel} 82%, ${colors.elevated})`,
      ":hover": colors.panel,
    },
    borderColor: {
      default: `color-mix(in srgb, ${colors.border} 88%, transparent)`,
      ":hover": `color-mix(in srgb, ${colors.border} 100%, transparent)`,
    },
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: {
      default: "inset 0 1px rgb(255 255 255 / 42%)",
      ':is([data-theme="dark"] *)': "inset 0 1px rgb(255 255 255 / 4%)",
    },
    color: {
      default: `color-mix(in srgb, ${colors.text} 88%, ${colors.muted})`,
      ":hover": colors.text,
    },
  },
  ghost: {
    backgroundColor: {
      default: "transparent",
      ":hover": `color-mix(in srgb, ${colors.elevated} 54%, transparent)`,
    },
    borderWidth: 0,
    color: {
      default: colors.muted,
      ":hover": colors.text,
    },
  },
  ghostActive: {
    backgroundColor: `color-mix(in srgb, ${colors.elevated} 54%, transparent)`,
    color: colors.text,
  },
  danger: {
    backgroundColor: {
      default: colors.danger,
      ":hover": `color-mix(in srgb, ${colors.danger} 88%, ${colors.elevated})`,
    },
    borderWidth: 0,
    boxShadow: {
      default: `0 1px 2px color-mix(in srgb, ${colors.danger} 22%, transparent), inset 0 1px rgb(255 255 255 / 22%)`,
      ':is([data-theme="dark"] *)':
        "0 1px 2px rgb(0 0 0 / 28%), inset 0 1px rgb(255 255 255 / 8%)",
    },
    color: accents.contrast,
    fontWeight: 620,
  },
  medium: {
    height: 32,
    minWidth: 64,
    paddingBlock: 0,
    paddingInline: 13,
  },
  small: {
    fontSize: 11,
    height: 28,
    minWidth: 0,
    paddingBlock: 0,
    paddingInline: 10,
  },
  icon: {
    height: 32,
    minWidth: 0,
    padding: 0,
    width: 32,
  },
});

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "style"
> & {
  active?: boolean;
  size?: "sm" | "md" | "icon";
  style?: stylex.StyleXStyles;
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    active = false,
    size = "md",
    style,
    type = "button",
    variant = "secondary",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      {...props}
      {...stylex.props(
        styles.base,
        styles[variant],
        styles[size === "md" ? "medium" : size === "sm" ? "small" : "icon"],
        variant === "ghost" && active && styles.ghostActive,
        style,
      )}
    />
  );
});
