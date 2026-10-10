import { switchFill } from "@/lib/paint";
import { cn } from "@/lib/utils";

type SwitchProps = {
  checked: boolean;
  mixed?: boolean;
  bulb?: string | null;
  vivid?: boolean;
  label: string;
  onCheckedChange: (on: boolean) => void;
};

export function Switch({ checked, mixed = false, bulb, vivid = false, label, onCheckedChange }: SwitchProps) {
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
      className="relative h-5 w-[34px] shrink-0 rounded-[10px] bg-(--track)"
      style={{ background: switchFill({ checked, mixed, bulb, vivid }) }}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-4 rounded-full bg-cream transition-transform duration-150",
          mixed ? "translate-x-[7px]" : on ? "translate-x-[14px]" : "",
        )}
      />
    </button>
  );
}
