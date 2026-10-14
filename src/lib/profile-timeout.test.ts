import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the Supabase client before importing profile.ts, so
// getOrCreateProfile uses our controllable fakes. vi.hoisted is required
// because the mock factory runs before the module body.
const { getUserMock, maybeSingleMock, upsertMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("../integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => getUserMock(...args) },
    from: () => ({
      select: () => ({ maybeSingle: (...args: unknown[]) => maybeSingleMock(...args) }),
      upsert: (...args: unknown[]) => upsertMock(...args),
    }),
  },
}));

import { getOrCreateProfile, withTimeout, PROFILE_REQUEST_TIMEOUT_MS } from "./profile";

describe("withTimeout", () => {
  it("resolves with the value when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "test")).resolves.toBe(42);
  });

  it("passes through rejections from the wrapped promise", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 1000, "test"),
    ).rejects.toThrow("boom");
  });

  it("rejects when the promise never settles (hung-request scenario)", async () => {
    const hanging = new Promise<never>(() => {
      // Never resolves, never rejects — exactly what a stalled Supabase
      // request looks like to TanStack Query.
    });
    await expect(withTimeout(hanging, 50, "Profile request")).rejects.toThrow(
      "Profile request timed out after 0.05s",
    );
  });

  it("profile timeout is 12 seconds", () => {
    expect(PROFILE_REQUEST_TIMEOUT_MS).toBe(12_000);
  });
});

describe("getOrCreateProfile timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when auth.getUser never settles", async () => {
    getUserMock.mockReturnValue(new Promise<never>(() => {}));
    await expect(getOrCreateProfile(50)).rejects.toThrow("Profile request timed out");
    expect(getUserMock).toHaveBeenCalled();
  });

  it("rejects when the profiles select never settles", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "u1", email: "a@b.c", user_metadata: {} } },
      error: null,
    });
    maybeSingleMock.mockReturnValue(new Promise<never>(() => {}));
    await expect(getOrCreateProfile(50)).rejects.toThrow("Profile request timed out");
  });

  it("still returns the profile when the request succeeds", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "u1", email: "a@b.c", user_metadata: {} } },
      error: null,
    });
    maybeSingleMock.mockResolvedValue({
      data: { id: "u1", display_name: "Test", province: "AB" },
      error: null,
    });
    const profile = await getOrCreateProfile(1000);
    expect(profile?.id).toBe("u1");
    expect(profile?.display_name).toBe("Test");
  });

  it("returns null when there is no signed-in user", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    await expect(getOrCreateProfile(1000)).resolves.toBeNull();
  });
});
