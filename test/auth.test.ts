import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  query: vi.fn(),
  getUser: vi.fn(),
  getClaims: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ query: mocks.query }));
vi.mock("~/lib/supabase.server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("~/lib/runtime.server", () => ({
  isDesktopRuntime: () => false,
  LOCAL_USER_ID: "00000000-0000-0000-0000-000000000001",
}));

import { getUser, hashDesktopToken } from "~/lib/auth.server";
import { loader as desktopAuthCallback } from "~/routes/desktop.auth.callback";

const supabase = {
  auth: {
    exchangeCodeForSession: mocks.exchangeCodeForSession,
    getClaims: mocks.getClaims,
    getUser: mocks.getUser,
  },
};

function request(authorization?: string): Request {
  return new Request("https://html-docs.example/sync/pull", {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

describe("desktop authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockReturnValue({ supabase });
  });

  it("hashes desktop bearer tokens deterministically", () => {
    const hash = hashDesktopToken("dhd_opaque-token");

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashDesktopToken("dhd_opaque-token")).toBe(hash);
    expect(hashDesktopToken("dhd_other-token")).not.toBe(hash);
  });

  it("resolves an active dhd_ token from desktop_sessions", async () => {
    mocks.query.mockResolvedValue({
      rows: [{ user_id: "desktop-user", email: "person@example.com" }],
    });

    const user = await getUser(request("Bearer dhd_opaque-token"));

    expect(user).toEqual({
      id: "desktop-user",
      email: "person@example.com",
    });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE desktop_sessions"),
      [hashDesktopToken("dhd_opaque-token")],
    );
    const lookup = mocks.query.mock.calls[0][0] as string;
    expect(lookup).toContain("session.expires_at > now()");
    expect(lookup).toContain("session.revoked_at IS NULL");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("rejects a dhd_ token without an active session row", async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await expect(getUser(request("Bearer dhd_expired-token"))).resolves.toBeNull();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("exchanges a PKCE code and returns a new opaque desktop token", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "desktop-user", email: "person@example.com" } },
      error: null,
    });
    mocks.query.mockResolvedValue({ rows: [] });

    const response = await desktopAuthCallback({
      request: new Request(
        "https://html-docs.example/desktop/auth/callback?code=pkce-code",
      ),
      params: {},
      context: {},
      url: new URL(
        "https://html-docs.example/desktop/auth/callback?code=pkce-code"
      ),
      pattern: "/desktop/auth/callback",
    } as Parameters<typeof desktopAuthCallback>[0]);

    expect(response.status).toBe(302);
    const location = response.headers.get("Location");
    expect(location).toMatch(/^html-docs:\/\/auth\/callback\?token=dhd_/);
    const token = new URL(location!).searchParams.get("token")!;
    expect(token).toMatch(/^dhd_[A-Za-z0-9_-]{43}$/);
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO desktop_sessions"),
      [
        "desktop-user",
        hashDesktopToken(token),
        expect.any(String),
      ],
    );
  });

  it("preserves Supabase bearer authentication for non-desktop tokens", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user", email: "web@example.com" } },
      error: null,
    });

    await expect(getUser(request("Bearer jwt-token"))).resolves.toEqual({
      id: "supabase-user",
      email: "web@example.com",
    });
    expect(mocks.getUser).toHaveBeenCalledWith("jwt-token");
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
