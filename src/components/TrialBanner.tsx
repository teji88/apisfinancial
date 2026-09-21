import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEntitlement, formatDate } from "@/lib/entitlement";

const KEY = "apis_trial_banner_dismissed";

/** Tells members their 30-day trial of everything is running. */
export function TrialBanner() {
  const { entitlement, onTrial } = useEntitlement();
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    setHidden(window.localStorage.getItem(KEY) === entitlement.trialEndsAt);
  }, [entitlement.trialEndsAt]);

  if (!onTrial || hidden || !entitlement.trialEndsAt) return null;

  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(entitlement.trialEndsAt).getTime() - Date.now()) / 86_400_000),
  );

  return (
    <div className="relative rounded-lg border border-accent/50 bg-accent/10 p-4 pr-10">
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles className="h-5 w-5 text-primary" />
        <p className="text-sm">
          <span className="font-medium">Your 30-day free trial is running.</span> Every feature is
          unlocked for {daysLeft} more {daysLeft === 1 ? "day" : "days"}, until{" "}
          {formatDate(entitlement.trialEndsAt)}. No card needed.
        </p>
        <Button asChild size="sm" variant="outline" className="ml-auto border-accent/50">
          <Link to="/plan">See plans</Link>
        </Button>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
        onClick={() => {
          window.localStorage.setItem(KEY, entitlement.trialEndsAt ?? "");
          setHidden(true);
        }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
