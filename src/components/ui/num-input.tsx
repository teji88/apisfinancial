import { useState } from "react";
import { Input } from "@/components/ui/input";

function num(t: string, fallback: number): number {
  const n = Number(String(t).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

/** Number input that commits on every valid keystroke. */
export function NumInput({
  value,
  onCommit,
  step,
  min,
  max,
  placeholder,
}: {
  value: number | null | undefined;
  onCommit: (n: number) => void;
  step?: string;
  min?: string;
  max?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const display = text ?? (value ?? "");

  return (
    <Input
      type="number"
      value={display}
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = num(t, NaN);
        if (Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => setText(null)}
    />
  );
}
