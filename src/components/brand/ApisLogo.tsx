import { cn } from "@/lib/utils";

const logoLight = { url: "/brand/apis-logo.png" };
const logoDark = { url: "/brand/apis-logo-dark.png" };
const markLight = { url: "/brand/apis-mark.png" };
const markDark = { url: "/brand/apis-mark-dark.png" };

type Size = "sm" | "md" | "lg" | "xl";
type Variant = "full" | "stacked" | "icon-only";

const MARK_SIZE: Record<Size, string> = {
  sm: "h-10 w-10",
  md: "h-14 w-14",
  lg: "h-20 w-20",
  xl: "h-28 w-28",
};

const FULL_SIZE: Record<Size, string> = {
  sm: "h-10",
  md: "h-14",
  lg: "h-20",
  xl: "h-28",
};

/** Honeycomb mark with the golden bee, from the Apis Financial brand artwork. */
export function ApisMark({ className }: { className?: string }) {
  return (
    <>
      <img
        src={markLight.url}
        alt=""
        aria-hidden
        className={cn("shrink-0 object-contain dark:hidden", className)}
      />
      <img
        src={markDark.url}
        alt=""
        aria-hidden
        className={cn("hidden shrink-0 object-contain dark:block", className)}
      />
    </>
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

  if (variant === "stacked") {
    return (
      <span className={cn("flex select-none flex-col items-center", className)}>
        <ApisMark className={MARK_SIZE[size]} />
        <img
          src={logoLight.url}
          alt="Apis Financial"
          className={cn("mt-2 w-auto object-contain dark:hidden", FULL_SIZE[size])}
        />
        <img
          src={logoDark.url}
          alt="Apis Financial"
          className={cn("mt-2 hidden w-auto object-contain dark:block", FULL_SIZE[size])}
        />
      </span>
    );
  }

  return (
    <span className={cn("flex select-none items-center", className)}>
      <img
        src={logoLight.url}
        alt="Apis Financial"
        className={cn("w-auto object-contain dark:hidden", FULL_SIZE[size])}
      />
      <img
        src={logoDark.url}
        alt="Apis Financial"
        className={cn("hidden w-auto object-contain dark:block", FULL_SIZE[size])}
      />
    </span>
  );
}
