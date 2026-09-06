import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, motion, typography } from "../../../styles/tokens.stylex";

const styles = stylex.create({
  root: {
    display: "inline-flex",
    position: "relative",
  },
  content: {
    backgroundColor: colors.text,
    borderRadius: 4,
    color: colors.canvas,
    fontFamily: typography.uiFont,
    fontSize: 10,
    left: "50%",
    marginTop: 4,
    opacity: {
      default: 0,
      ":is([data-memoir-tooltip]:hover *)": 1,
      ":is([data-memoir-tooltip]:focus-within *)": 1,
    },
    paddingBlock: 4,
    paddingInline: 8,
    pointerEvents: "none",
    position: "absolute",
    top: "100%",
    transform: "translateX(-50%)",
    transitionDuration: "150ms",
    transitionProperty: "opacity",
    transitionTimingFunction: motion.ease,
    whiteSpace: "nowrap",
    zIndex: 20,
  },
});

export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span data-memoir-tooltip="" {...stylex.props(styles.root)}>
      {children}
      <span {...stylex.props(styles.content)}>
        {label}
      </span>
    </span>
  );
}
