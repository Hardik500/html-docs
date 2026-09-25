import { describe, expect, it } from "vitest";
import { validateDocument } from "~/routes/sync.push";

const document = {
  id: "doc123",
  title: "Document",
  baseRevision: 4,
  tabs: [
    {
      id: "tab123",
      slug: "tab-1",
      name: "Tab 1",
      position: 0,
      html: "<p>Hello</p>",
      content_type: "html",
    },
  ],
};

function rejected(body: unknown): Response {
  try {
    validateDocument(body);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  throw new Error("Expected sync document validation to reject the payload");
}

describe("hosted sync push validation", () => {
  it("requires an exact force revision for conflict resolution", () => {
    expect(
      validateDocument({ document: { ...document, force: true, forceRevision: 4 } }),
    ).toMatchObject({ force: true, forceRevision: 4 });
    expect(rejected({ document: { ...document, force: true } }).status).toBe(400);
  });

  it("rejects a force revision without force", () => {
    expect(rejected({ document: { ...document, forceRevision: 4 } }).status).toBe(400);
  });

  it("rejects invalid force revisions", () => {
    expect(
      rejected({ document: { ...document, force: true, forceRevision: -1 } }).status,
    ).toBe(400);
    expect(
      rejected({ document: { ...document, force: true, forceRevision: 1.5 } }).status,
    ).toBe(400);
  });
});
