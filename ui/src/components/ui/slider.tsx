import * as SliderPrimitive from "@radix-ui/react-slider";

type SliderProps = {
  label: string;
  value: number;
  min?: number;
  max?: number;
  color: string;
  track?: string;
  live?: boolean;
  display: string;
  onValueChange: (value: number) => void;
};

export function Slider({ label, value, min = 0, max = 100, color, track, live = false, display, onValueChange }: SliderProps) {
  return (
    <label className="mt-[13px] block">
      <span className="mb-[7px] flex justify-between text-xs font-medium">
        <span>{label}</span>
        <span className="text-muted tabular-nums">{display}</span>
      </span>
      <SliderPrimitive.Root
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={(next) => onValueChange(next[0] ?? value)}
        className={live ? "fx-slide relative flex h-2 w-full touch-none items-center" : "relative flex h-2 w-full touch-none items-center"}
      >
        <SliderPrimitive.Track className="relative h-2 grow rounded-[4px] bg-(--rail)" style={track ? { background: track } : undefined}>
          {track ? null : <SliderPrimitive.Range className="fx-range absolute h-full rounded-[4px]" style={{ background: color }} />}
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className="block size-4 rounded-full border-[2.5px] border-cream outline-none"
          style={{ background: color }}
          aria-label={label}
        />
      </SliderPrimitive.Root>
    </label>
  );
}
