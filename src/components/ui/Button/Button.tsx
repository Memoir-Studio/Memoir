import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../cn";

const buttonVariants = cva(
  "memoir-button inline-flex items-center justify-center gap-1.5 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "memoir-button-primary",
        secondary: "memoir-button-secondary",
        ghost: "memoir-button-ghost",
        danger: "memoir-button-danger",
      },
      size: {
        sm: "memoir-button-sm",
        md: "memoir-button-md",
        icon: "memoir-button-icon",
      },
      active: {
        true: "is-active",
        false: "",
      },
    },
    defaultVariants: { variant: "secondary", size: "md", active: false },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { active, className, variant, size, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ active, variant, size }), className)}
      type={type}
      {...props}
    />
  );
});
