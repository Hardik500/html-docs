import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("~/lib/db.server", () => ({ query: mocks.query }));

import { withIdempotency } from "~/lib/agent-idempotency.server";

const identity = { tokenId: "token-1", userId: "user-1" };

describe("agent write idempotency", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs the operation once when no key is supplied", async () => {
    const run = vi.fn().mockResolvedValue({ id: "doc-1" });
    const { result, replayed } = await withIdempotency(identity, null, "create_document", run);
    expect(result).toEqual({ id: "doc-1" });
    expect(replayed).toBe(false);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("claims the key, runs once, and stores the response", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: "claim-1" }] })
      .mockResolvedValueOnce({ rows: [] });
    const run = vi.fn().mockResolvedValue({ id: "doc-1", revision: 2 });

    const { result, replayed } = await withIdempotency(identity, "key-1", "create_document", run);

    expect(result).toEqual({ id: "doc-1", revision: 2 });
    expect(replayed).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("ON CONFLICT (token_id, idempotency_key) DO NOTHING"),
      ["token-1", "user-1", "key-1", "create_document"],
    );
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("status = 'completed'"),
      ["claim-1", JSON.stringify({ id: "doc-1", revision: 2 })],
    );
  });

  it("replays the stored response instead of writing again", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: "completed", response: { id: "doc-1", revision: 2 } }] });
    const run = vi.fn();

    const { result, replayed } = await withIdempotency(identity, "key-1", "create_document", run);

    expect(result).toEqual({ id: "doc-1", revision: 2 });
    expect(replayed).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a concurrent duplicate while the first call is in flight", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: "in_progress", response: null }] });

    await expect(
      withIdempotency(identity, "key-1", "create_document", vi.fn()),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("releases the claim when the operation fails so it stays retryable", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: "claim-1" }] })
      .mockResolvedValueOnce({ rows: [] });
    const run = vi.fn().mockRejectedValue(new Error("write failed"));

    await expect(
      withIdempotency(identity, "key-1", "create_document", run),
    ).rejects.toThrow("write failed");

    expect(mocks.query).toHaveBeenLastCalledWith(
      expect.stringContaining("DELETE FROM agent_idempotency_keys"),
      ["claim-1"],
    );
  });

  it("scopes keys per token", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: "claim-1" }] })
      .mockResolvedValueOnce({ rows: [] });

    await withIdempotency(identity, "shared-key", "create_document", vi.fn().mockResolvedValue({}));

    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO agent_idempotency_keys"),
      ["token-1", "user-1", "shared-key", "create_document"],
    );
  });
});
