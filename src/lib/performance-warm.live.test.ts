import { describe, expect, it } from "vitest";

/**
 * Live-database coverage for the performance snapshot warm-up server function
 * (PR #35). The underlying snapshot/finance logic is unit-tested elsewhere;
 * this exercises the server-function wrapper's core (`warm`) against the real
 * database: paged reads of accounts/holdings/transactions/snapshots.
 *
 * Runs only when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (service
 * role bypasses RLS, same as production). Uses the nil UUID so no real user
 * is touched — with zero transactions `warm` returns `{ warmed: 0 }` before
 * any price-history fetch or snapshot write.
 */
const hasLiveDb = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

describe.skipIf(!hasLiveDb)("warmPerformanceSnapshots (live DB)", () => {
  it("reads an empty user scope without writing", async () => {
    const { warm } = await import("./performance-warm.functions");
    const result = await warm("all", "00000000-0000-0000-0000-000000000000");
    expect(result.error).toBeUndefined();
    expect(result.warmed).toBe(0);
  }, 30_000);

  it("a scoped read also short-circuits on empty transactions", async () => {
    const { warm } = await import("./performance-warm.functions");
    const result = await warm("some-account-id", "00000000-0000-0000-0000-000000000000");
    expect(result.error).toBeUndefined();
    expect(result.warmed).toBe(0);
  }, 30_000);
});
