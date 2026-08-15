import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "../Button";

export function IconButton({
  label,
  active,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      active={active}
      aria-label={label}
      aria-pressed={active}
      className={className}
      size="icon"
      title={label}
      variant="ghost"
      {...props}
    >
      {children}
    </Button>
  );
}
