import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg" | "xl";
type Variant = "full" | "stacked" | "icon-only";

const MARK_SIZE: Record<Size, string> = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
  lg: "h-14 w-14",
  xl: "h-20 w-20",
};

const TITLE_SIZE: Record<Size, string> = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-2xl",
  xl: "text-4xl",
};

const SUB_SIZE: Record<Size, string> = {
  sm: "text-[8px]",
  md: "text-[10px]",
  lg: "text-xs",
  xl: "text-sm",
};

/** Honeycomb mark: navy cells around a golden honey core, with a geometric bee. */
export function ApisMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="apis-honey" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F0C070" />
          <stop offset="55%" stopColor="#E0A96D" />
          <stop offset="100%" stopColor="#C68A35" />
        </linearGradient>
        <linearGradient id="apis-bee" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E9C27A" />
          <stop offset="100%" stopColor="#C68A35" />
        </linearGradient>
      </defs>

      {/* surrounding cells */}
      <g
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinejoin="round"
        fill="none"
        className="text-[#0D1B2A] dark:text-[#E8EDF5]"
      >
        <path d="M14 14.5 22 10l8 4.5v9L22 28l-8-4.5z" />
        <path d="M14 34.5 22 30l8 4.5v9L22 48l-8-4.5z" />
        <path d="M34 34.5 42 30l8 4.5v9L42 48l-8-4.5z" />
        <path d="M34 44.5 42 40l8 4.5v9L42 58l-8-4.5z" opacity="0.35" />
      </g>

      {/* honey core */}
      <path d="M24 24.5 32 20l8 4.5v9L32 38l-8-4.5z" fill="url(#apis-honey)" />

      {/* bee */}
      <g fill="url(#apis-bee)">
        <ellipse cx="46" cy="18" rx="4.6" ry="3.2" transform="rotate(-28 46 18)" />
        <path d="M47.5 10.5c4.6-4 10-5.6 11.4-4.2 1.4 1.4-.5 6.4-5 10.2-1.8 1.5-3.4-4.6-6.4-6z" />
        <path d="M43.5 12c1.6-4.6 5-8.3 6.8-7.8 1.8.6 1.6 5.6-.6 9.9-.9 1.7-4.9-.4-6.2-2.1z" opacity="0.75" />
      </g>
    </svg>
  );
}

export function ApisLogo({
  variant = "full",
  size = "md",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
}) {
  if (variant === "icon-only") {
    return <ApisMark className={cn(MARK_SIZE[size], className)} />;
  }

  const stacked = variant === "stacked";

  return (
    <span
      className={cn(
        "flex select-none",
        stacked ? "flex-col items-center gap-2 text-center" : "flex-row items-center gap-2.5",
        className,
      )}
    >
      <ApisMark className={MARK_SIZE[size]} />
      <span className={cn("flex flex-col", stacked ? "items-center" : "items-start")}>
        <span
          className={cn(
            "font-display font-extrabold uppercase leading-none tracking-[0.12em] text-foreground",
            TITLE_SIZE[size],
          )}
        >
          Apis
        </span>
        <span
          className={cn(
            "mt-1 font-semibold uppercase leading-none tracking-[0.25em] text-muted-foreground",
            SUB_SIZE[size],
          )}
        >
          Financial
        </span>
      </span>
    </span>
  );
}

export default ApisLogo;
