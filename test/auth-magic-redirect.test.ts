import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  signInWithOtp: vi.fn(),
  checkMagicEmailRate: vi.fn(),
  checkMagicIpRate: vi.fn(),
}));

vi.mock("~/lib/supabase.server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("~/lib/ratelimit.server", () => ({
  checkMagicEmailRate: mocks.checkMagicEmailRate,
  checkMagicIpRate: mocks.checkMagicIpRate,
}));

import { action } from "~/routes/auth.magic";

/**
 * The OAuth authorization endpoint round-trips the user through this form, so
 * the `redirect` field decides where they land after signing in. It must stay
 * a same-origin path.
 */
function post(fields: Record<string, string>) {
  return action({
    request: new Request("https://html-docs.example/auth/magic", {
      method: "POST",
      body: new URLSearchParams(fields).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }) as never,
    params: {},
    context: {},
  } as never);
}

describe("magic link return path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkMagicEmailRate.mockResolvedValue(true);
    mocks.checkMagicIpRate.mockResolvedValue(true);
    mocks.signInWithOtp.mockResolvedValue({ error: null });
    mocks.createSupabaseServerClient.mockReturnValue({
      supabase: { auth: { signInWithOtp: mocks.signInWithOtp } },
    });
  });

  it("forwards a same-origin relative return path to the callback", async () => {
    await post({ email: "person@example.com", redirect: "/oauth/authorize?client_id=abc" });
    const call = mocks.signInWithOtp.mock.calls[0][0];
    const redirect = new URL(call.options.emailRedirectTo);
    expect(redirect.pathname).toBe("/auth/callback");
    expect(redirect.searchParams.get("redirect")).toBe("/oauth/authorize?client_id=abc");
  });

  it.each([
    ["//evil.example/steal", "protocol-relative"],
    ["/\\evil.example", "backslash normalized to //"],
    ["https://evil.example/steal", "absolute cross-origin"],
    ["oauth/authorize", "missing leading slash"],
    ["/path\nSet-Cookie: x", "header injection"],
  ])("refuses to sign in with an unsafe return path: %s (%s)", async (redirect) => {
    const result = await post({ email: "person@example.com", redirect });
    expect(result).toEqual({ error: "Invalid sign-in return path." });
    // No magic link is sent at all, so the attacker never gets a token either.
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("signs in normally when no return path is supplied", async () => {
    await post({ email: "person@example.com" });
    const redirect = new URL(mocks.signInWithOtp.mock.calls[0][0].options.emailRedirectTo);
    expect(redirect.searchParams.get("redirect")).toBeNull();
  });

  it("keeps the claim flow working alongside a return path", async () => {
    await post({
      email: "person@example.com",
      redirect: "/dashboard",
      claimDocId: "abc123",
      claimEditToken: "t".repeat(24),
    });
    const redirect = new URL(mocks.signInWithOtp.mock.calls[0][0].options.emailRedirectTo);
    expect(redirect.searchParams.get("claimDocId")).toBe("abc123");
    expect(redirect.searchParams.get("redirect")).toBe("/dashboard");
  });
});
