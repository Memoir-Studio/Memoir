import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "memoir-input h-8 w-full px-3 text-[13px] text-text outline-none placeholder:text-muted",
          className,
        )}
        {...props}
      />
    );
  },
);
