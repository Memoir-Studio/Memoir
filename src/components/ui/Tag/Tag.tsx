import * as stylex from "@stylexjs/stylex";
import type { HTMLAttributes } from "react";
import { colors, typography } from "../../../styles/tokens.stylex";

const styles = stylex.create({
  tag: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderRadius: 4,
    color: colors.muted,
    display: "inline-flex",
    fontFamily: typography.uiFont,
    fontSize: 11,
    minHeight: 20,
    paddingInline: 6,
  },
});

export type TagProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  "className" | "style"
> & {
  style?: stylex.StyleXStyles;
};

export function Tag({ style, ...props }: TagProps) {
  return <span {...props} {...stylex.props(styles.tag, style)} />;
}
