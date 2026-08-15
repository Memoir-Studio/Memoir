import type { HTMLAttributes } from "react";
import { cn } from "../cn";

export function Tag({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex min-h-5 items-center rounded bg-panel px-1.5 text-[11px] text-muted",
        className,
      )}
      {...props}
    />
  );
}
