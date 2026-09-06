import * as stylex from "@stylexjs/stylex";
import type { HTMLAttributes } from "react";
import { colors } from "../../../styles/tokens.stylex";

const styles = stylex.create({
  surface: {
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow:
      "0 1px 3px 0 rgb(0 0 0 / 10%), 0 1px 2px -1px rgb(0 0 0 / 10%)",
  },
});

export type SurfaceProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "className" | "style"
> & {
  style?: stylex.StyleXStyles;
};

export function Surface({ style, ...props }: SurfaceProps) {
  return <div {...props} {...stylex.props(styles.surface, style)} />;
}
