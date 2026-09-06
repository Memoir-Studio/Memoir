import * as stylex from "@stylexjs/stylex";
import { accents, colors, motion } from "../../styles/tokens.stylex";

export const selectMenuStyles = stylex.create({
  menu: {
    position: "fixed",
    zIndex: 70,
    maxHeight: "min(280px, calc(100vh - 16px))",
    padding: "5px",
    overflow: "auto",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: `color-mix(in srgb, ${colors.border} 86%, transparent)`,
    borderRadius: "10px",
    backgroundColor: `color-mix(in srgb, ${colors.elevated} 96%, ${colors.panel})`,
    boxShadow: {
      default:
        "0 16px 40px rgb(37 33 27 / 18%), 0 4px 12px rgb(37 33 27 / 8%), inset 0 1px rgb(255 255 255 / 52%)",
      ':is([data-theme="dark"] *)':
        "0 28px 72px rgb(0 0 0 / 46%), 0 8px 24px rgb(0 0 0 / 26%), inset 0 1px rgb(255 255 255 / 5%)",
    },
    opacity: {
      default: 0,
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transform: {
      default: "translateY(4px) scale(0.98)",
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motion.fast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.ease,
  },
  visible: {
    opacity: 1,
    transform: "none",
  },
  position: (left: number, top: number, minWidth: number) => ({
    left,
    top,
    minWidth,
  }),
  option: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 16px",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    height: "30px",
    padding: "0 8px",
    borderWidth: 0,
    borderRadius: "7px",
    backgroundColor: "transparent",
    color: colors.text,
    fontSize: "12px",
    fontWeight: 500,
    letterSpacing: 0,
    textAlign: "left",
    cursor: "pointer",
  },
  active: {
    backgroundColor: `color-mix(in srgb, ${accents.soft} 82%, ${colors.elevated})`,
    outline: "none",
  },
  selected: {
    fontWeight: 650,
  },
  create: {
    color: colors.muted,
  },
  label: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  icon: {
    width: "13px",
    height: "13px",
    color: accents.primary,
  },
  empty: {
    padding: "8px 10px",
    color: colors.muted,
    fontSize: "12px",
    fontWeight: 500,
  },
});
