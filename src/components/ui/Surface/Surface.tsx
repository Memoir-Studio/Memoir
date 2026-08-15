import type { HTMLAttributes } from "react";
import { cn } from "../cn";

export function Surface({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-elevated shadow-sm", className)}
      {...props}
    />
  );
}
