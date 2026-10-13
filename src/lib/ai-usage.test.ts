import { describe, expect, it, vi } from "vitest";
import {
  AI_PAGES_PER_MONTH,
  countPdfPages,
  currentMonthKey,
  nextResetLabel,
  quotaExhaustedMessage,
} from "./ai-usage";
import {
  checkAndConsumeAiQuota,
  type AiUsageDb,
} from "./ai-usage.functions";

/** Minimal two-page PDF, base64 data URL. */
function twoPagePdfDataUrl(): string {
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj
3 0 obj<</Type/Page/Parent 2 0 R>>endobj
4 0 obj<</Type/Page/Parent 2 0 R>>endobj
trailer<</Root 1 0 R>>`;
  return `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`;
}

/** Fake AiUsageDb backed by a Map; can simulate failures. */
function fakeDb(opts?: {
  failRead?: boolean;
  failWrite?: boolean;
  throwRead?: boolean;
}): { db: AiUsageDb; store: Map<string, number> } {
  const store = new Map<string, number>();
  const db = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_c1: string, _v1: unknown) => ({
          eq: (c2: string, v2: unknown) => ({
            maybeSingle: async () => {
              if (opts?.throwRead) throw new Error("connection reset");
              if (opts?.failRead) return { data: null, error: { message: 'relation "ai_usage" does not exist' } };
              const key = `${_v1}|${v2}`;
              void c2;
              return { data: store.has(key) ? { pages_used: store.get(key)! } : null, error: null };
            },
          }),
        }),
      }),
      upsert: (row: { user_id: string; month: string; pages_used: number }, _o: { onConflict: string }) => {
        void _o;
        if (opts?.failWrite) return Promise.resolve({ error: { message: "permission denied" } });
        store.set(`${row.user_id}|${row.month}`, row.pages_used);
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as AiUsageDb;
  return { db, store };
}

describe("ai-usage helpers", () => {
  it("formats the month key as YYYY-MM", () => {
    expect(currentMonthKey(new Date(2026, 0, 5))).toBe("2026-01");
    expect(currentMonthKey(new Date(2026, 11, 31))).toBe("2026-12");
  });

  it("labels the reset as the first of next month", () => {
    expect(nextResetLabel(new Date(2026, 9, 12))).toBe("November 1");
    expect(nextResetLabel(new Date(2026, 11, 31))).toBe("January 1");
  });

  it("counts PDF pages from a data URL", () => {
    expect(countPdfPages(twoPagePdfDataUrl())).toBe(2);
  });

  it("falls back to 1 page when the count is unknowable", () => {
    expect(countPdfPages("data:image/png;base64,iVBORw0KGgo=")).toBe(1);
    expect(countPdfPages("not-a-data-url")).toBe(1);
  });

  it("names the cap, the reset, and the unlimited CSV path", () => {
    const msg = quotaExhaustedMessage("November 1");
    expect(msg).toContain("50");
    expect(msg).toContain("November 1");
    expect(msg).toContain("CSV import is always unlimited");
  });
});

describe("checkAndConsumeAiQuota", () => {
  it("consumes pages and reports the remainder", async () => {
    const { db } = fakeDb();
    const r1 = await checkAndConsumeAiQuota(db, "u1", 3);
    expect(r1).toEqual({ ok: true, remaining: AI_PAGES_PER_MONTH - 3 });
    const r2 = await checkAndConsumeAiQuota(db, "u1", 7);
    expect(r2).toEqual({ ok: true, remaining: AI_PAGES_PER_MONTH - 10 });
  });

  it("blocks when the request would exceed the cap", async () => {
    const { db, store } = fakeDb();
    store.set(`u1|${currentMonthKey()}`, 49);
    const r = await checkAndConsumeAiQuota(db, "u1", 2);
    expect(r).toEqual({ ok: false, remaining: 0 });
    // Nothing was written.
    expect(store.get(`u1|${currentMonthKey()}`)).toBe(49);
  });

  it("allows exactly filling the cap", async () => {
    const { db, store } = fakeDb();
    store.set(`u1|${currentMonthKey()}`, 48);
    const r = await checkAndConsumeAiQuota(db, "u1", 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.remaining).toBe(0);
  });

  it("fails open when the table is missing (migration not applied)", async () => {
    const { db } = fakeDb({ failRead: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await checkAndConsumeAiQuota(db, "u1", 5);
    expect(r).toEqual({ ok: true, remaining: null });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("fails open when the read throws", async () => {
    const { db } = fakeDb({ throwRead: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await checkAndConsumeAiQuota(db, "u1", 5);
    expect(r).toEqual({ ok: true, remaining: null });
    warn.mockRestore();
  });

  it("fails open when the write fails after a successful read", async () => {
    const { db } = fakeDb({ failWrite: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await checkAndConsumeAiQuota(db, "u1", 5);
    // Allowed: quota must never hard-block on infra trouble.
    expect(r).toEqual({ ok: true, remaining: null });
    warn.mockRestore();
  });
});
