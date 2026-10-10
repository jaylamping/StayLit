import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center font-medium tracking-tight disabled:pointer-events-none disabled:opacity-[0.38]",
  {
    variants: {
      variant: {
        solid: "h-9 rounded-[10px] bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground",
        ghost: "h-[26px] rounded-full border border-border bg-transparent px-2.5 text-xs font-medium",
        quiet: "h-auto bg-transparent p-0 text-[13px] font-medium text-muted",
        icon: "size-7 rounded-md bg-transparent p-0 text-muted [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "solid" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant }), className)} {...props} />;
}
