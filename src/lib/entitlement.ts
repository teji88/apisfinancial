import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEntitlement, type Entitlement } from "./entitlement.functions";
import { getStripeEnvironment } from "./stripe";

export { FREE_ACCOUNT_LIMIT, FREE_HOLDING_LIMIT } from "./entitlement.functions";
export type { Entitlement };

const FREE_FALLBACK: Entitlement = {
  tier: "free",
  readOnly: false,
  readOnlyReason: null,
  graceUntil: null,
  accessEndsAt: null,
  cancelAtPeriodEnd: false,
  plan: null,
  accountLimit: null,
  holdingLimit: null,
  isAdmin: false,
  trialEndsAt: null,
};


export function useEntitlement() {
  const fetchEntitlement = useServerFn(getEntitlement);
  const query = useQuery({
    queryKey: ["entitlement"],
    staleTime: 60 * 1000,
    queryFn: async () => fetchEntitlement({ data: { environment: getStripeEnvironment() } }),
  });
  const entitlement = query.data ?? FREE_FALLBACK;
  return {
    entitlement,
    /** The only paid feature: AI reading of PDFs and screenshots. */
    hasStatementAi: entitlement.tier !== "free",
    /** Everything else in Apis Financial is free for everyone. */
    hasPro: true,
    hasProPlus: true,
    /** True while the free 30-day trial of everything is running. */
    onTrial: entitlement.tier === "trial",
    loading: query.isLoading,
    refetch: query.refetch,
  };
}


export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
