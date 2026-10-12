import { useAiQuota } from "@/lib/entitlement";

/**
 * Small "N of 50 AI pages left this month" line shown next to AI buttons.
 * Renders nothing while loading or when the quota is unknown (fail-open).
 */
export function AiQuotaNote({ className = "" }: { className?: string }) {
  const { quota, loading } = useAiQuota();
  if (loading || !quota || quota.unknown) return null;
  return (
    <span className={`text-[11px] text-muted-foreground ${className}`}>
      {quota.remaining} of {quota.limit} AI pages left this month
    </span>
  );
}
