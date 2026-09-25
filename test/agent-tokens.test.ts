import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("~/lib/db.server", () => ({ query: mocks.query }));

import {
  authenticateAgentToken,
  createAgentToken,
  hashAgentToken,
  normalizeAgentScopes,
} from "~/lib/agent-tokens.server";

describe("agent access tokens", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hashes tokens deterministically without storing plaintext", () => {
    const hash = hashAgentToken("hdo_secret-token");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashAgentToken("hdo_secret-token")).toBe(hash);
    expect(hash).not.toContain("hdo_secret-token");
  });

  it("defaults unknown scopes to read-only access", () => {
    expect(normalizeAgentScopes(["unknown", "docs:read"])).toEqual(["docs:read"]);
    expect(normalizeAgentScopes([])).toEqual(["docs:read"]);
  });

  it("creates a token and returns its one-time plaintext value", async () => {
    mocks.query.mockResolvedValue({
      rows: [{
        id: "token-1",
        name: "Agent",
        token_prefix: "hdo_abc12345",
        scopes: ["docs:read"],
        created_at: "2026-01-01T00:00:00Z",
        last_used_at: null,
        expires_at: null,
        revoked_at: null,
      }],
    });

    const result = await createAgentToken("user-1", "Agent", ["docs:read"]);
    expect(result.token).toMatch(/^hdo_[A-Za-z0-9_-]{43}$/);
    expect(result.summary.id).toBe("token-1");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_access_tokens"),
      expect.arrayContaining(["user-1", "Agent", hashAgentToken(result.token)]),
    );
  });

  it("rejects revoked or expired credentials", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{
        token_id: "token-1",
        user_id: "user-1",
        email: "person@example.com",
        scopes: ["docs:read"],
        expires_at: "2000-01-01T00:00:00Z",
      }],
    });
    await expect(authenticateAgentToken("hdo_expired-token")).resolves.toBeNull();

    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(authenticateAgentToken("hdo_revoked-token")).resolves.toBeNull();
  });
});
