// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Load all env vars into process.env for server-side code (server routes need
// non-VITE_ vars like SUPABASE_SERVICE_ROLE_KEY). Never expose these via
// envDefine — that would leak secrets into the client bundle.
Object.assign(process.env, loadEnv(process.env["NODE_ENV"] ?? "development", process.cwd(), ""));

// The client (src/integrations/supabase/client.ts) reads the VITE_-prefixed
// names so Vite inlines them into the browser bundle. This project only ships
// the non-prefixed SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY, so mirror them into
// the VITE_ names when the prefixed ones are absent. Both values are public
// client credentials (anon/publishable), so exposing them to the client is safe
// — the SERVICE_ROLE key is never mirrored here.
if (!process.env["VITE_SUPABASE_URL"] && process.env["SUPABASE_URL"]) {
  process.env["VITE_SUPABASE_URL"] = process.env["SUPABASE_URL"];
}
if (!process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] && process.env["SUPABASE_PUBLISHABLE_KEY"]) {
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] = process.env["SUPABASE_PUBLISHABLE_KEY"];
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: {
        // Force the hoisted entities v4.5.0 copy; nested v7 breaks SSR.
        "entities/lib/decode.js": path.resolve(__dirname, "node_modules/entities/lib/decode.js"),
        "entities/lib/encode.js": path.resolve(__dirname, "node_modules/entities/lib/encode.js"),
        entities: path.resolve(__dirname, "node_modules/entities"),
      },
    },
  },
});
