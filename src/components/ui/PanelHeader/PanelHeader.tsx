import * as stylex from "@stylexjs/stylex";
import type { MouseEventHandler, ReactNode } from "react";
import { colors } from "../../../styles/tokens.stylex";

export function PanelHeader({
  actions,
  actionsStyle,
  children,
  dragRegion = false,
  onMouseDown,
  style,
}: {
  actions?: ReactNode;
  actionsStyle?: stylex.StyleXStyles;
  children: ReactNode;
  dragRegion?: boolean;
  onMouseDown?: MouseEventHandler<HTMLElement>;
  style?: stylex.StyleXStyles;
}) {
  return (
    <header
      data-panel-header=""
      data-tauri-drag-region={dragRegion ? "" : undefined}
      onMouseDown={onMouseDown}
      {...stylex.props(styles.root, style)}
    >
      <div {...stylex.props(styles.content)}>{children}</div>
      {actions ? <div {...stylex.props(styles.actions, actionsStyle)}>{actions}</div> : null}
    </header>
  );
}

const styles = stylex.create({
  root: {
    display: "flex",
    width: "100%",
    height: "56px",
    minWidth: 0,
    boxSizing: "border-box",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    paddingInline: "16px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  content: { minWidth: 0 },
  actions: {
    display: "flex",
    minWidth: 0,
    flex: "none",
    alignItems: "center",
    gap: "6px",
  },
});
