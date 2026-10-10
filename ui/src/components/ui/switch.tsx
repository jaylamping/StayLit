import { cn } from "@/lib/utils";

type SwitchProps = {
  checked: boolean;
  mixed?: boolean;
  bulb?: string;
  group?: boolean;
  label: string;
  onCheckedChange: (on: boolean) => void;
};

export function Switch({ checked, mixed = false, bulb, group = false, label, onCheckedChange }: SwitchProps) {
  const on = checked && !mixed;
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={mixed ? "mixed" : checked}
      onClick={(event) => {
        event.stopPropagation();
        onCheckedChange(mixed || checked ? false : true);
      }}
      className="relative h-5 w-[34px] shrink-0 rounded-full bg-(--track)"
      style={{
        background: on
          ? group
            ? "color-mix(in srgb, var(--foreground) 22%, var(--track))"
            : `color-mix(in srgb, ${bulb ?? "#e39a45"} 55%, var(--track))`
          : undefined,
      }}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-4 rounded-full bg-[#f6f1ea] shadow-sm",
          mixed ? "translate-x-[7px]" : on ? "translate-x-[14px]" : "",
        )}
      />
    </button>
  );
}
