/**
 * Permanent client-side cache for historical USD→CAD FX rates.
 *
 * Historical ECB reference rates never change, so once a rate for a date is
 * known it can be reused forever with no expiry. The cache lives in
 * localStorage under FX_CACHE_KEY, keyed by ISO date (YYYY-MM-DD).
 *
 * Invariants:
 * - Only finite rates > 0 are ever stored. Lookup failures fall back to 1
 *   at call time and are NOT cached (a failure is not a rate).
 * - Reads tolerate a missing, corrupt, or unavailable localStorage.
 * - Writes merge with what's already stored (multi-tab safe enough for a cache).
 * - The store is capped at MAX_ENTRIES; oldest entries are pruned first.
 */

export const FX_CACHE_KEY = "apis.fxCache.v1";
const MAX_ENTRIES = 20000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidFxDate(date: string): boolean {
  return DATE_RE.test(date);
}

type FxCacheShape = Record<string, number>;

function readRaw(): FxCacheShape {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(FX_CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const clean: FxCacheShape = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isValidFxDate(k) && typeof v === "number" && Number.isFinite(v) && v > 0) {
        clean[k] = v;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

/** All cached rates (used by tests and diagnostics). */
export function loadFxCache(): FxCacheShape {
  return readRaw();
}

/** Cached rate for a date, or undefined when unknown. */
export function getCachedFxRate(date: string): number | undefined {
  if (!isValidFxDate(date)) return undefined;
  return readRaw()[date];
}

/** Merge rates into the cache and persist. Invalid entries are ignored. */
export function setCachedFxRates(rates: Record<string, number>): void {
  try {
    if (typeof localStorage === "undefined") return;
    const merged = readRaw();
    for (const [k, v] of Object.entries(rates)) {
      if (isValidFxDate(k) && typeof v === "number" && Number.isFinite(v) && v > 0) {
        merged[k] = v;
      }
    }
    // Prune oldest first (string keys keep insertion order). Cap keeps the
    // store well under localStorage limits (~22 bytes/entry).
    const keys = Object.keys(merged);
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete merged[k];
    }
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify(merged));
  } catch {
    // Cache is best-effort; a full or blocked localStorage must not break imports.
  }
}

/** Run async jobs with at most `concurrency` in flight. Order of results matches input. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Resolve USD→CAD rates for a set of dates.
 *
 * - Dates already in the localStorage cache are used as-is (no network).
 * - Missing dates are fetched with `fetchRate` in parallel (bounded
 *   concurrency), then stored in the cache.
 * - A per-date fetch failure resolves to 1 and is not cached.
 * - `fetchRate` is never called for invalid dates.
 */
export async function resolveFxRates(
  dates: string[],
  fetchRate: (date: string) => Promise<number>,
  concurrency = 20,
): Promise<Map<string, number>> {
  const unique = [...new Set(dates)].filter(isValidFxDate);
  const cached = readRaw();
  const missing = unique.filter((d) => cached[d] === undefined);

  const fetched = await mapWithConcurrency(missing, concurrency, async (date) => {
    try {
      const rate = await fetchRate(date);
      return { date, rate: typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 1, ok: true as const };
    } catch {
      return { date, rate: 1, ok: false as const };
    }
  });

  const toCache: Record<string, number> = {};
  for (const f of fetched) {
    if (f.ok) toCache[f.date] = f.rate;
  }
  if (Object.keys(toCache).length > 0) setCachedFxRates(toCache);

  const out = new Map<string, number>();
  for (const d of unique) out.set(d, cached[d] ?? toCache[d] ?? 1);
  return out;
}
