import * as stylex from "@stylexjs/stylex";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../../../i18n/react";
import { colors, motion, typography } from "../../../styles/tokens.stylex";

const noticeIn = stylex.keyframes({
  from: {
    opacity: 0,
    transform: "translateY(-6px)",
  },
  to: {
    opacity: 1,
    transform: "none",
  },
});

const styles = stylex.create({
  notice: {
    alignItems: "flex-start",
    animationDuration: "180ms",
    animationName: {
      default: noticeIn,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationTimingFunction: motion.ease,
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow:
      "0 10px 15px -3px rgb(0 0 0 / 10%), 0 4px 6px -4px rgb(0 0 0 / 10%)",
    color: colors.text,
    display: "flex",
    fontFamily: typography.uiFont,
    fontSize: 12,
    gap: 12,
    maxWidth: 448,
    paddingBlock: 8,
    paddingInline: 12,
    position: "fixed",
    right: 16,
    top: 16,
    zIndex: 40,
  },
  danger: {
    borderColor: `color-mix(in srgb, ${colors.danger} 40%, transparent)`,
    color: colors.danger,
  },
  content: {
    lineHeight: "20px",
  },
  dismiss: {
    appearance: "none",
    alignItems: "center",
    backgroundColor: "transparent",
    borderWidth: 0,
    color: "inherit",
    cursor: "pointer",
    display: "inline-flex",
    justifyContent: "center",
    margin: 0,
    padding: 0,
  },
  icon: {
    height: 14,
    width: 14,
  },
});

export function StatusNotice({
  children,
  danger,
  onDismiss,
}: {
  children: ReactNode;
  danger?: boolean;
  onDismiss?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role={danger ? "alert" : "status"}
      {...stylex.props(styles.notice, danger && styles.danger)}
    >
      <span {...stylex.props(styles.content)}>{children}</span>
      {onDismiss && (
        <button
          {...stylex.props(styles.dismiss)}
          aria-label={t("common.closeNotice")}
          onClick={onDismiss}
          type="button"
        >
          <X {...stylex.props(styles.icon)} />
        </button>
      )}
    </div>
  );
}
