import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  FX_CACHE_KEY,
  getCachedFxRate,
  isValidFxDate,
  loadFxCache,
  resolveFxRates,
  setCachedFxRates,
} from "./fxCache";

beforeEach(() => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  });
  // Expose the store for tests that write corrupt content directly.
  (globalThis as unknown as { __fxTestStore: Record<string, string> }).__fxTestStore = store;
});

describe("isValidFxDate", () => {
  it("accepts ISO dates only", () => {
    expect(isValidFxDate("2024-01-15")).toBe(true);
    expect(isValidFxDate("2024-1-15")).toBe(false);
    expect(isValidFxDate("not-a-date")).toBe(false);
    expect(isValidFxDate("")).toBe(false);
  });
});

describe("fx cache persistence", () => {
  it("round-trips rates through localStorage", () => {
    setCachedFxRates({ "2024-01-15": 1.3421, "2024-01-16": 1.3502 });
    expect(getCachedFxRate("2024-01-15")).toBe(1.3421);
    expect(getCachedFxRate("2024-01-16")).toBe(1.3502);
    expect(getCachedFxRate("2024-01-17")).toBeUndefined();
  });

  it("ignores invalid entries on write and read", () => {
    setCachedFxRates({
      "2024-01-15": 1.3421,
      "bad-date": 1.5,
      "2024-01-16": NaN,
      "2024-01-17": -2,
      "2024-01-18": 0,
    } as Record<string, number>);
    expect(loadFxCache()).toEqual({ "2024-01-15": 1.3421 });
  });

  it("tolerates corrupt localStorage content", () => {
    const store = (globalThis as unknown as { __fxTestStore: Record<string, string> }).__fxTestStore;
    store[FX_CACHE_KEY] = "{not json";
    expect(loadFxCache()).toEqual({});
    expect(getCachedFxRate("2024-01-15")).toBeUndefined();
    // Writing after corruption recovers cleanly.
    setCachedFxRates({ "2024-01-15": 1.3 });
    expect(getCachedFxRate("2024-01-15")).toBe(1.3);
  });

  it("merges with existing entries instead of replacing", () => {
    setCachedFxRates({ "2024-01-15": 1.3 });
    setCachedFxRates({ "2024-01-16": 1.4 });
    expect(loadFxCache()).toEqual({ "2024-01-15": 1.3, "2024-01-16": 1.4 });
  });
});

describe("resolveFxRates", () => {
  it("uses the cache and never calls fetch for known dates", async () => {
    setCachedFxRates({ "2024-01-15": 1.3 });
    const fetchRate = vi.fn(async () => 9.99);
    const out = await resolveFxRates(["2024-01-15"], fetchRate);
    expect(fetchRate).not.toHaveBeenCalled();
    expect(out.get("2024-01-15")).toBe(1.3);
  });

  it("fetches missing dates in parallel and caches them", async () => {
    const seen: string[] = [];
    const fetchRate = vi.fn(async (date: string) => {
      seen.push(date);
      await new Promise((r) => setTimeout(r, 5));
      return 1.25;
    });
    const out = await resolveFxRates(["2024-01-15", "2024-01-16", "2024-01-15"], fetchRate);
    // Duplicate date fetched once.
    expect(fetchRate).toHaveBeenCalledTimes(2);
    expect(out.get("2024-01-15")).toBe(1.25);
    expect(out.get("2024-01-16")).toBe(1.25);
    // Second call is fully cached — no fetch.
    fetchRate.mockClear();
    const out2 = await resolveFxRates(["2024-01-15", "2024-01-16"], fetchRate);
    expect(fetchRate).not.toHaveBeenCalled();
    expect(out2.get("2024-01-16")).toBe(1.25);
  });

  it("falls back to 1 on fetch failure without caching the failure", async () => {
    const fetchRate = vi.fn(async (date: string) => {
      if (date === "2024-01-16") throw new Error("network down");
      return 1.3;
    });
    const out = await resolveFxRates(["2024-01-15", "2024-01-16"], fetchRate);
    expect(out.get("2024-01-15")).toBe(1.3);
    expect(out.get("2024-01-16")).toBe(1);
    expect(getCachedFxRate("2024-01-16")).toBeUndefined();
    expect(getCachedFxRate("2024-01-15")).toBe(1.3);
  });

  it("skips invalid dates without calling fetch", async () => {
    const fetchRate = vi.fn(async () => 1.3);
    const out = await resolveFxRates(["2024-01-15", "junk"], fetchRate);
    expect(fetchRate).toHaveBeenCalledTimes(1);
    expect(out.has("junk")).toBe(false);
  });

  it("bounds concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchRate = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return 1.3;
    };
    const dates = Array.from({ length: 50 }, (_, i) => `2024-02-${String((i % 27) + 1).padStart(2, "0")}`);
    await resolveFxRates(dates, fetchRate, 5);
    expect(maxInFlight).toBeLessThanOrEqual(5);
  });
});
