import { afterEach, describe, it, expect, vi } from "vitest";
import { supabaseConfig } from "../server/lib/supabase-config";
import { userClient } from "../server/lib/db";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Supabase key configuration", () => {
  it("prefers modern keys while preserving legacy aliases", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_modern");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "legacy-secret");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_modern");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "legacy-anon");
    expect(supabaseConfig().secretKey).toBe("sb_secret_modern");
    expect(supabaseConfig().publishableKey).toBe("sb_publishable_modern");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    expect(supabaseConfig().secretKey).toBe("legacy-secret");
    expect(supabaseConfig().publishableKey).toBe("legacy-anon");
  });
  it("creates workspaces using the public key and user token, never the elevated key", async () => {
    vi.stubEnv("SUPABASE_URL", "https://fixture.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_private");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_public");
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify("workspace-id"), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await userClient("Bearer user-session-token").rpc("create_workspace", {
      workspace_name: "Fixture",
    });
    const headers = new Headers(fetch.mock.calls[0][1].headers);
    expect(headers.get("apikey")).toBe("sb_publishable_public");
    expect(headers.get("authorization")).toBe("Bearer user-session-token");
  });
});
