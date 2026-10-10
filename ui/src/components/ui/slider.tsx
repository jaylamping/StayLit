import * as SliderPrimitive from "@radix-ui/react-slider";

type SliderProps = {
  label: string;
  value: number;
  min?: number;
  max?: number;
  color: string;
  display: string;
  onValueChange: (value: number) => void;
};

export function Slider({ label, value, min = 0, max = 100, color, display, onValueChange }: SliderProps) {
  return (
    <label className="grid gap-1.5">
      <span className="flex justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted tabular-nums">{display}</span>
      </span>
      <SliderPrimitive.Root
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={(next) => onValueChange(next[0] ?? value)}
        className="relative flex h-4 w-full touch-none items-center"
      >
        <SliderPrimitive.Track className="relative h-2 grow rounded-full bg-(--track)">
          <SliderPrimitive.Range className="absolute h-full rounded-full" style={{ background: color }} />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className="block size-4 rounded-full border-2 border-[#f6f1ea]"
          style={{ background: color }}
          aria-label={label}
        />
      </SliderPrimitive.Root>
    </label>
  );
}
