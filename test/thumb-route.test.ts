import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({
  query: mocks.query,
  withTransaction: vi.fn(),
  getPostgresPool: vi.fn(),
  getLocalDatabase: vi.fn(),
}));

vi.mock("~/lib/auth.server", () => ({
  getUser: mocks.getUser,
  getUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { loader } from "~/routes/thumb.$docId.$tabSlug";
import { RAW_CSP } from "~/lib/csp.server";

const OWNER = "11111111-1111-1111-1111-111111111111";
const HTML_TAB = "<!DOCTYPE html><html><head><title>Doc</title></head><body><h1>Hi</h1></body></html>";

type LoaderArgs = Parameters<typeof loader>[0];

function call(url: string, params: { docId: string; tabSlug: string }) {
  return loader({ request: new Request(url), params, context: {} } as unknown as LoaderArgs);
}

function rowsFor(tab: { html: string; content_type: string } | null) {
  return { rows: tab ? [tab] : [] };
}

beforeEach(() => {
  mocks.query.mockReset();
  mocks.getUser.mockReset();
});

describe("GET /thumb/:docId/:tabSlug", () => {
  it("refuses an unauthenticated request", async () => {
    mocks.getUser.mockResolvedValue(null);
    // Must not even reach the database: an anonymous caller learns nothing.
    expect(mocks.query).not.toHaveBeenCalled();
    await expect(call("http://x/thumb/d1/main", { docId: "d1", tabSlug: "main" })).rejects.toMatchObject({
      status: 401,
    });
  });

  it("scopes the query to the authenticated owner", async () => {
    mocks.getUser.mockResolvedValue({ id: OWNER, email: "o@x.test" });
    mocks.query.mockResolvedValue(rowsFor({ html: HTML_TAB, content_type: "html" }));

    await call("http://x/thumb/d1/main", { docId: "d1", tabSlug: "main" });

    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain("d.owner_user_id = $4");
    expect(params).toEqual(["d1", "main", 8000, OWNER]);
  });

  it("returns 404 for a document the caller does not own", async () => {
    mocks.getUser.mockResolvedValue({ id: OWNER, email: "o@x.test" });
    // The owner filter is in the SQL, so another user's document yields no rows.
    mocks.query.mockResolvedValue({ rows: [] });
    await expect(call("http://x/thumb/other/main", { docId: "other", tabSlug: "main" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("returns 404 for a PDF tab, which the dashboard renders as an icon", async () => {
    mocks.getUser.mockResolvedValue({ id: OWNER, email: "o@x.test" });
    mocks.query.mockResolvedValue(rowsFor({ html: "JVBERi0=", content_type: "pdf" }));
    await expect(call("http://x/thumb/d1/scan", { docId: "d1", tabSlug: "scan" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("returns 404 for an empty tab", async () => {
    mocks.getUser.mockResolvedValue({ id: OWNER, email: "o@x.test" });
    mocks.query.mockResolvedValue(rowsFor({ html: "", content_type: "html" }));
    await expect(call("http://x/thumb/d1/main", { docId: "d1", tabSlug: "main" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("serves the raw-CSP policy with a sandbox, so the frame is an opaque origin", async () => {
    mocks.getUser.mockResolvedValue({ id: OWNER, email: "o@x.test" });
    mocks.query.mockResolvedValue(rowsFor({ html: HTML_TAB, content_type: "html" }));

    const response = await call("http://x/thumb/d1/main?dark=0", { docId: "d1", tabSlug: "main" });
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Content-Security-Policy")).toBe(RAW_CSP);
    expect(RAW_CSP).toContain("sandbox allow-scripts");
    // Owner-specific content must not be cached by a shared cache.
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("converts markdown and doc tabs the same way the public viewer does", async () => {
    mocks.getUser.mockResolvedValue({ id: OWNER, email: "o@x.test" });

    mocks.query.mockResolvedValue(rowsFor({ html: "# Title\n\nBody", content_type: "markdown" }));
    const md = await call("http://x/thumb/d1/notes?dark=0", { docId: "d1", tabSlug: "notes" });
    expect(await md.text()).toContain("<h1 id=\"title\">Title</h1>");

    mocks.query.mockResolvedValue(rowsFor({ html: "<h1>Rich</h1>", content_type: "doc" }));
    const doc = await call("http://x/thumb/d1/rich?dark=0", { docId: "d1", tabSlug: "rich" });
    const body = await doc.text();
    expect(body).toContain("<h1>Rich</h1>");
    // A doc tab is a fragment, so it must be wrapped into a full document.
    expect(body).toContain("<!DOCTYPE html>");
  });

  it("passes the resolved theme through, and falls back to script detection when absent", async () => {
    mocks.getUser.mockResolvedValue({ id: OWNER, email: "o@x.test" });
    mocks.query.mockResolvedValue(rowsFor({ html: HTML_TAB, content_type: "html" }));

    const dark = await call("http://x/thumb/d1/main?dark=1", { docId: "d1", tabSlug: "main" });
    expect(await dark.text()).toContain(":root{color-scheme:dark}");

    const light = await call("http://x/thumb/d1/main?dark=0", { docId: "d1", tabSlug: "main" });
    expect(await light.text()).toContain(":root{color-scheme:light}");

    // No ?dark → no inline color-scheme rule, so the injected script uses
    // prefers-color-scheme, exactly as a direct /raw visit does. Assert on the
    // rule rather than the bare substring: the script itself contains
    // "prefers-color-scheme:dark", which would match a naive check.
    const auto = await call("http://x/thumb/d1/main", { docId: "d1", tabSlug: "main" });
    const body = await auto.text();
    expect(body).not.toContain(":root{color-scheme:");
    expect(body).toContain("prefers-color-scheme:dark");
  });

  it("injects the in-document CSP meta as well as the header", async () => {
    mocks.getUser.mockResolvedValue({ id: OWNER, email: "o@x.test" });
    mocks.query.mockResolvedValue(rowsFor({ html: HTML_TAB, content_type: "html" }));
    const response = await call("http://x/thumb/d1/main?dark=0", { docId: "d1", tabSlug: "main" });
    expect(await response.text()).toContain('http-equiv="Content-Security-Policy"');
  });
});
