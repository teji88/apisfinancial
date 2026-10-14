/**
 * Phase 1 security regression tests.
 *
 * #2 — vite.config.ts must not contain hardcoded Supabase fallbacks that
 * could silently point a dev/staging build at production. It must fail fast
 * when the env vars are missing.
 *
 * #1 — .gitignore must cover .env* so env files (which may carry keys)
 * are never tracked. (.env.development, which carried a live publishable
 * key, was deleted from the repo.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

describe("security config guardrails", () => {
  it("vite.config.ts has no hardcoded Supabase URL or publishable key", () => {
    const config = readFileSync(
      path.join(repoRoot, "vite.config.ts"),
      "utf8",
    );
    expect(config).not.toContain("izmrxsvzxctzswrameng");
    expect(config).not.toContain("sb_publishable_");
    expect(config).not.toContain("supabase.co\"");
  });

  it("vite.config.ts fails fast when Supabase env vars are missing", () => {
    const config = readFileSync(
      path.join(repoRoot, "vite.config.ts"),
      "utf8",
    );
    expect(config).toContain("Missing Supabase URL");
    expect(config).toContain("Missing Supabase publishable key");
    expect(config).toContain("throw new Error");
  });

  it(".gitignore covers .env* files", () => {
    const gitignore = readFileSync(
      path.join(repoRoot, ".gitignore"),
      "utf8",
    );
    expect(gitignore).toContain(".env*");
  });

  it("no tracked .env file carries VITE_PAYMENTS_CLIENT_TOKEN", () => {
    // The committed .env.development that defined this (unused) variable
    // was deleted; no .env file should remain in the repo at all.
    const candidates = [".env", ".env.development", ".env.production"];
    for (const name of candidates) {
      const full = path.join(repoRoot, name);
      if (existsSync(full)) {
        const content = readFileSync(full, "utf8");
        expect(content).not.toContain("VITE_PAYMENTS_CLIENT_TOKEN");
      }
    }
  });
});
