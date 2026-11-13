/**
 * refresh-etf-holdings must reject GET with 405 and reject unauthenticated
 * POSTs — same gating as the price refresh (see refresh-prices.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedOptions: {
  server?: {
    handlers?: Record<string, (ctx: { request: Request }) => Promise<Response>>;
  };
} | null = null;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: typeof capturedOptions) => {
    capturedOptions = opts;
    return {};
  },
}));

describe("refresh-etf-holdings method gating", () => {
  beforeEach(() => {
    capturedOptions = null;
    vi.resetModules();
    vi.stubEnv("LOVABLE_CRON_SECRET", "test-secret");
    delete process.env["PRICE_REFRESH_CRON_KEY"];
  });

  it("GET returns 405 and never runs the job", async () => {
    await import("./refresh-etf-holdings");
    const get = capturedOptions?.server?.handlers?.["GET"];
    expect(get).toBeDefined();
    const res = await get!({
      request: new Request("https://example.com/api/public/refresh-etf-holdings"),
    });
    expect(res.status).toBe(405);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("POST without auth is rejected (not 405)", async () => {
    await import("./refresh-etf-holdings");
    const post = capturedOptions?.server?.handlers?.["POST"];
    expect(post).toBeDefined();
    const res = await post!({
      request: new Request("https://example.com/api/public/refresh-etf-holdings", {
        method: "POST",
      }),
    });
    // No bearer token → 401 from the cron auth check.
    expect(res.status).toBe(401);
  });
});
