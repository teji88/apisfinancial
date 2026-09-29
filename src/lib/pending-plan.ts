export const PENDING_PLAN_KEY = "apis_pending_retirement_plan";

export function hasPendingPlan(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.localStorage.getItem(PENDING_PLAN_KEY);
}

/** Where to send someone right after they sign in. */
export function postLoginPath(): "/retirement" | "/dashboard" {
  return hasPendingPlan() ? "/retirement" : "/dashboard";
}
