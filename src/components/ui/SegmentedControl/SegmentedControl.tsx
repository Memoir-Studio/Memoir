import { cn } from "../cn";

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div
      aria-label={label}
      className="inline-flex rounded-md border border-border bg-panel p-0.5"
      role="group"
    >
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={cn(
            "h-7 rounded px-2.5 text-xs text-muted transition-[color,background-color,box-shadow] duration-150 ease-out",
            value === option.value && "bg-elevated font-semibold text-text shadow-sm",
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
