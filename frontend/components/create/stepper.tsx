"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEPS } from "@/lib/wizard";

interface StepperProps {
  current: number;
  maxVisited: number;
  onStepClick: (index: number) => void;
}

/** Numbered wizard steps with connector lines. Completed and visited steps
 *  are clickable (back-navigation); future ones are inert. */
export function Stepper({ current, maxVisited, onStepClick }: StepperProps) {
  return (
    <ol className="flex items-center" aria-label="Wizard progress">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const reachable = i <= maxVisited;
        return (
          <li key={step.id} className={cn("flex items-center", i > 0 && "flex-1")}>
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "mx-2 h-px flex-1 transition-colors sm:mx-3",
                  i <= current ? "bg-brand" : "bg-border",
                )}
              />
            )}
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onStepClick(i)}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-1 py-0.5 text-sm font-medium transition-colors",
                reachable ? "cursor-pointer" : "cursor-default",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-[13px] tabular-nums transition-colors",
                  done && "border-brand bg-brand text-white",
                  active && !done && "border-brand text-brand",
                  !active && !done && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
