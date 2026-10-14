import { describe, expect, it, beforeEach, vi } from "vitest";
import { unitsHeldBeforeDate, type Transaction } from "./finance";
import {
  dismissedKeyFor,
  loadDismissed,
  LEGACY_DISMISSED_KEY,
} from "./dividends";

function tx(
  id: string,
  date: string,
  type: string,
  units: number,
  holdingId = "h1",
): Transaction {
  return {
    id,
    account_id: "a1",
    holding_id: holdingId,
    transaction_type: type,
    units,
    price_per_unit: 10,
    amount: null,
    currency: "CAD",
    fx_rate: 1,
    fee: 0,
    transaction_date: date,
  };
}

describe("#22 unitsHeldBeforeDate — same-day buy covers same-day sell", () => {
  it("counts a same-day buy when validating a new sell", () => {
    const transactions = [tx("t1", "2026-01-15", "BUY", 10)];
    // New sell on the same date: the buy (recorded earlier) covers it.
    expect(unitsHeldBeforeDate("h1", transactions, "2026-01-15")).toBe(10);
  });

  it("still excludes later dates", () => {
    const transactions = [tx("t1", "2026-01-16", "BUY", 10)];
    expect(unitsHeldBeforeDate("h1", transactions, "2026-01-15")).toBe(0);
  });

  it("nets same-day sells against same-day buys in id order", () => {
    const transactions = [
      tx("t1", "2026-01-15", "BUY", 10),
      tx("t2", "2026-01-15", "SELL", 4),
    ];
    expect(unitsHeldBeforeDate("h1", transactions, "2026-01-15")).toBe(6);
  });

  it("when editing, only same-day entries ordered before the edited one count", () => {
    const transactions = [
      tx("t1", "2026-01-15", "BUY", 10),
      tx("t2", "2026-01-15", "SELL", 4), // being edited
      tx("t3", "2026-01-15", "BUY", 100), // ordered after t2 — must not count
    ];
    expect(unitsHeldBeforeDate("h1", transactions, "2026-01-15", "t2")).toBe(10);
  });

  it("excludes the edited transaction itself", () => {
    const transactions = [tx("t1", "2026-01-15", "BUY", 10)];
    expect(unitsHeldBeforeDate("h1", transactions, "2026-01-15", "t1")).toBe(0);
  });
});

describe("#26 dismissedKeyFor — per-user keys", () => {
  it("scopes the key to the user id", () => {
    expect(dismissedKeyFor("user-123")).toBe("apis.dismissedDividends.user-123");
    expect(dismissedKeyFor("user-456")).toBe("apis.dismissedDividends.user-456");
  });

  it("falls back to a device key when logged out", () => {
    expect(dismissedKeyFor(null)).toBe("apis.dismissedDividends.device");
  });

  it("never uses the old maplewealth brand", () => {
    expect(dismissedKeyFor("u1")).not.toContain("maplewealth");
    expect(LEGACY_DISMISSED_KEY).toContain("maplewealth");
  });
});

describe("#26 loadDismissed — migration from the legacy shared key", () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
        clear: () => {
          store = {};
        },
      },
    });
  });

  it("migrates the legacy key once and removes it", () => {
    window.localStorage.setItem(LEGACY_DISMISSED_KEY, JSON.stringify(["k1", "k2"]));
    const key = dismissedKeyFor("user-1");
    expect(loadDismissed(key)).toEqual(["k1", "k2"]);
    // Migrated value is now under the per-user key; legacy key is gone.
    expect(window.localStorage.getItem(key)).toBe(JSON.stringify(["k1", "k2"]));
    expect(window.localStorage.getItem(LEGACY_DISMISSED_KEY)).toBeNull();
    // Second load reads the per-user key directly.
    expect(loadDismissed(key)).toEqual(["k1", "k2"]);
  });

  it("returns empty when nothing is stored", () => {
    expect(loadDismissed(dismissedKeyFor("user-9"))).toEqual([]);
  });

  it("keeps per-user dismissals separate", () => {
    window.localStorage.setItem(
      dismissedKeyFor("user-a"),
      JSON.stringify(["ka"]),
    );
    expect(loadDismissed(dismissedKeyFor("user-a"))).toEqual(["ka"]);
    expect(loadDismissed(dismissedKeyFor("user-b"))).toEqual([]);
  });
});
