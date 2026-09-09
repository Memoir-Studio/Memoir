import * as stylex from "@stylexjs/stylex";
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { colors, motion } from "../../../styles/tokens.stylex";

export type CollapsibleProps = {
  label: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  style?: stylex.StyleXStyles;
  contentStyle?: stylex.StyleXStyles;
};

export function Collapsible({
  label,
  children,
  ariaLabel,
  defaultOpen = true,
  open,
  onOpenChange,
  style,
  contentStyle,
}: CollapsibleProps) {
  const contentId = `collapsible-${useId().replace(/:/g, "")}`;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = open ?? uncontrolledOpen;

  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div
      aria-label={ariaLabel}
      data-collapsible=""
      role={ariaLabel ? "group" : undefined}
      {...stylex.props(styles.root, style)}
    >
      <button
        aria-controls={contentId}
        aria-expanded={isOpen}
        data-collapsible-trigger=""
        onClick={toggle}
        type="button"
        {...stylex.props(styles.header, !isOpen && styles.headerCollapsed)}
      >
        <ChevronDown
          aria-hidden
          {...stylex.props(styles.chevron, isOpen && styles.chevronOpen)}
        />
        <span {...stylex.props(styles.title)}>{label}</span>
      </button>
      <div
        aria-hidden={!isOpen}
        data-collapsible-content=""
        data-collapsible-expanded={isOpen ? "true" : "false"}
        id={contentId}
        {...stylex.props(styles.content(isOpen), contentStyle)}
      >
        <div {...stylex.props(styles.contentInner)}>{children}</div>
      </div>
    </div>
  );
}

const styles = stylex.create({
  root: {
    padding: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.panel,
  },
  header: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    gap: 4,
    padding: 0,
    paddingBottom: 10,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    backgroundColor: "transparent",
    color: colors.muted,
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    transitionProperty: "padding-bottom, border-color",
    transitionDuration: {
      default: motion.standard,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.ease,
  },
  headerCollapsed: {
    paddingBottom: 0,
    borderBottomWidth: 0,
    borderBottomColor: "transparent",
  },
  chevron: {
    width: 14,
    height: 14,
    flex: "none",
    color: colors.muted,
    transform: "rotate(-90deg)",
    transitionProperty: "transform",
    transitionDuration: {
      default: motion.fast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.ease,
  },
  chevronOpen: { transform: "rotate(0deg)" },
  title: { color: colors.muted, fontSize: 14, fontWeight: 700 },
  content: (isOpen: boolean) => ({
    display: "grid",
    minHeight: 0,
    overflow: "hidden",
    gridTemplateRows: isOpen ? "1fr" : "0fr",
    opacity: isOpen ? 1 : 0,
    transitionProperty: "grid-template-rows, opacity",
    transitionDuration: {
      default: motion.standard,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.ease,
  }),
  contentInner: {
    minHeight: 0,
    overflow: "hidden",
  },
});
