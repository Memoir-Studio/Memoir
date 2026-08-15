import { cn } from "../cn";

export function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-[3px] shadow-[inset_0_1px_2px_rgb(43_38_31_/_12%)] transition-colors",
        checked ? "bg-accent" : "bg-border",
      )}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-elevated shadow-sm transition-transform duration-200 ease-out",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}
