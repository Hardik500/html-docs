import { describe, expect, it } from "vitest";
import { validateSaveTabs } from "~/routes/d.$docId.edit";

function responseFromTabs(tabs: unknown): Response {
  try {
    validateSaveTabs(tabs);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  throw new Error("Expected save validation to reject the payload");
}

describe("edit save validation", () => {
  it("accepts a normal tab payload", () => {
    expect(
      validateSaveTabs([
        {
          id: "tab123",
          slug: "tab-1",
          name: "Tab 1",
          position: 0,
          html: "<p>Hello</p>",
          content_type: "html",
        },
      ]),
    ).toHaveLength(1);
  });

  it("rejects oversized new and existing tab content", () => {
    const oversized = "x".repeat(500_001);
    expect(
      responseFromTabs([
        {
          slug: "new-tab",
          name: "New tab",
          position: 0,
          html: oversized,
          content_type: "html",
        },
      ]).status,
    ).toBe(413);
    expect(
      responseFromTabs([
        {
          id: "tab123",
          slug: "tab-1",
          name: "Tab 1",
          position: 0,
          html: oversized,
          content_type: "html",
        },
      ]).status,
    ).toBe(413);
  });

  it("rejects empty documents, excess tabs, and duplicate metadata", () => {
    expect(responseFromTabs([]).status).toBe(400);
    expect(
      responseFromTabs(
        Array.from({ length: 21 }, (_, index) => ({
          slug: `tab-${index}`,
          name: `Tab ${index}`,
          position: index,
          html: "<p>Tab</p>",
          content_type: "html",
        })),
      ).status,
    ).toBe(400);
    expect(
      responseFromTabs([
        {
          id: "tab123",
          slug: "same",
          name: "One",
          position: 0,
          html: "<p>One</p>",
        },
        {
          id: "tab456",
          slug: "same",
          name: "Two",
          position: 1,
          html: "<p>Two</p>",
        },
      ]).status,
    ).toBe(400);
  });
});
