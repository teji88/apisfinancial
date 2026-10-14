/**
 * #3 — refresh-prices must reject GET with 405.
 *
 * The price refresh is a state-changing, expensive job. GET requests can be
 * triggered by link prefetchers, crawlers, and CSRF-style attacks, and a
 * bearer token in a URL can be replayed from logs. Only POST may run it.
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

describe("refresh-prices method gating", () => {
  beforeEach(() => {
    capturedOptions = null;
    vi.resetModules();
    vi.stubEnv("LOVABLE_CRON_SECRET", "test-secret");
    delete process.env["PRICE_REFRESH_CRON_KEY"];
  });

  it("GET returns 405 and never runs the job", async () => {
    await import("./refresh-prices");
    const get = capturedOptions?.server?.handlers?.["GET"];
    expect(get).toBeDefined();
    const res = await get!({
      request: new Request("https://example.com/api/public/refresh-prices"),
    });
    expect(res.status).toBe(405);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("POST without auth is rejected (not 405)", async () => {
    await import("./refresh-prices");
    const post = capturedOptions?.server?.handlers?.["POST"];
    expect(post).toBeDefined();
    const res = await post!({
      request: new Request("https://example.com/api/public/refresh-prices", {
        method: "POST",
      }),
    });
    // No bearer token → 401 from the cron auth check.
    expect(res.status).toBe(401);
  });
});
