import * as stylex from "@stylexjs/stylex";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "../Button";

export function IconButton({
  label,
  active,
  style,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style"> & {
  label: string;
  active?: boolean;
  children: ReactNode;
  style?: stylex.StyleXStyles;
}) {
  return (
    <Button
      active={active}
      aria-label={label}
      aria-pressed={active}
      size="icon"
      style={style}
      title={label}
      variant="ghost"
      {...props}
    >
      {children}
    </Button>
  );
}
