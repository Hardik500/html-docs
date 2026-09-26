import { describe, expect, it, vi } from "vitest";
import { claimDocument } from "~/lib/claim.server";

describe("anonymous document claim", () => {
  it("claims an unowned document and records the hosted change", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ owner_user_id: null, edit_token: "edit-token" }],
      })
      .mockResolvedValueOnce({ rows: [] })
      // recordDocumentChange bumps the revision and appends to sync_changes in
      // one statement, so the claim path issues three queries in total.
      .mockResolvedValueOnce({ rows: [{ revision: 2 }] });

    const result = await claimDocument(
      query,
      "doc123",
      "edit-token",
      "11111111-1111-4111-8111-111111111111",
    );

    expect(result.kind).toBe("claimed");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE docs"),
      expect.arrayContaining([
        "11111111-1111-4111-8111-111111111111",
        expect.any(String),
        "doc123",
      ]),
    );
    // One statement carries both the revision bump and the sync feed row.
    const changeCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO sync_changes")
    );
    expect(changeCall).toBeDefined();
    expect(String(changeCall?.[0])).toContain("UPDATE docs");
    expect(changeCall?.[1]).toEqual([
      "doc123",
      "11111111-1111-4111-8111-111111111111",
      null,
    ]);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("does not claim an already owned document", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ owner_user_id: "another-user", edit_token: "edit-token" }],
    });

    await expect(
      claimDocument(query, "doc123", "edit-token", "current-user"),
    ).resolves.toEqual({ kind: "owned" });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
