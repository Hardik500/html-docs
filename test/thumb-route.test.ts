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

  it("does not ship the document's head in the thumbnail", async () => {
    // The query used to be LEFT(t.html, POSITION('<body' ...) + 8000), which
    // capped the body at 8000 bytes but shipped the entire head on top of it. A
    // document with a large inline <style> — which is what a Google Docs export
    // arrives with — then served 271,333 bytes for a "thumbnail", and a dozen of
    // those is megabytes on every dashboard visit in every browser. Measured:
    // 271,333 -> 11,280 bytes after slicing from <body> instead.
    //
    // Asserted on the query text itself, because the truncation happens in SQL:
    // a test that only fed the route a short document could never see this, and
    // the response for a short document is byte-identical either way.
    mocks.getUser.mockResolvedValue({ id: OWNER, email: "o@x.test" });
    mocks.query.mockResolvedValue(rowsFor({ html: HTML_TAB, content_type: "html" }));

    await call("http://x/thumb/d1/main?dark=0", { docId: "d1", tabSlug: "main" });
    const sql = mocks.query.mock.calls[0][0] as string;

    // Slice from the body onwards for a bounded length, rather than taking a
    // prefix of the whole document.
    expect(sql).toMatch(/SUBSTRING\(\s*t\.html\s+FROM\s+GREATEST\(\s*POSITION\('<body'\s+IN\s+lower\(t\.html\)\)\s*,\s*1\s*\)\s+FOR\s+\$\d+\s*\)/i);
    // The old form returned the whole head, so it must be gone.
    expect(sql).not.toMatch(/LEFT\s*\(\s*t\.html/i);
  });

  it("serves the raw-CSP policy with a sandbox, so the frame is an opaque origin", async () => {
    mocks.getUser.mockResolvedValue({ id: OWNER, email: "o@x.test" });
    mocks.query.mockResolvedValue(rowsFor({ html: HTML_TAB, content_type: "html" }));

    const response = await call("http://x/thumb/d1/main?dark=0", { docId: "d1", tabSlug: "main" });
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Content-Security-Policy")).toBe(RAW_CSP);
    expect(RAW_CSP).toContain("sandbox allow-scripts");
    // The isolation headers /raw relies on must survive the caching change.
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("lets the owner's own browser cache it, but never a shared cache", async () => {
    mocks.getUser.mockResolvedValue({ id: OWNER, email: "o@x.test" });
    mocks.query.mockResolvedValue(rowsFor({ html: HTML_TAB, content_type: "html" }));

    const response = await call("http://x/thumb/d1/main?dark=0", { docId: "d1", tabSlug: "main" });
    const cacheControl = response.headers.get("Cache-Control") ?? "";

    // The regression this replaces: /thumb inherited `no-store` from
    // rawResponseHeaders(), which forbids the browser's cache too, so every
    // dashboard visit discarded and re-fetched each visible card.
    expect(cacheControl).not.toBe("no-store");
    expect(cacheControl).not.toMatch(/no-store/);

    // What `no-store` was standing in for: this is owner-only content reached
    // through an authenticated request, so `private` must keep it out of shared
    // caches and CDNs.
    expect(cacheControl).toMatch(/(^|[\s,])private($|[\s,])/);

    // A freshness lifetime is what makes a return visit a cache hit, and
    // stale-while-revalidate is what keeps the frame from flashing empty.
    expect(cacheControl).toMatch(/max-age=\d+/);
    expect(cacheControl).toMatch(/stale-while-revalidate=\d+/);
  });

  it("keeps the thumbnail fresh for an hour, so a return visit is a cache hit", async () => {
    mocks.getUser.mockResolvedValue({ id: OWNER, email: "o@x.test" });
    mocks.query.mockResolvedValue(rowsFor({ html: HTML_TAB, content_type: "html" }));

    const response = await call("http://x/thumb/d1/main?dark=0", { docId: "d1", tabSlug: "main" });
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("Cache-Control") ?? "")?.[1]);

    // Measured, not chosen for looks. With max-age=60 the browser re-fetched the
    // thumbnail on a return visit at 75s — Network.responseReceived reported
    // fromDiskCache=false — which is exactly the "images keep loading" report.
    // Opening a document and coming back takes longer than a minute, so a
    // one-minute window made the cache almost useless. An hour makes the
    // reported round trip a reliable hit. Asserted concretely because the
    // failure mode is invisible to a test that only checks "a max-age exists".
    expect(maxAge).toBe(3600);
  });

  it("varies on Cookie so a cached thumbnail cannot outlive the session that fetched it", async () => {
    mocks.getUser.mockResolvedValue({ id: OWNER, email: "o@x.test" });
    mocks.query.mockResolvedValue(rowsFor({ html: HTML_TAB, content_type: "html" }));

    const response = await call("http://x/thumb/d1/main?dark=0", { docId: "d1", tabSlug: "main" });
    // The body is chosen by an ownership check. Without Vary: Cookie, signing
    // out and into another account on the same browser could let the cache
    // answer a /thumb URL before the loader re-checks ownership.
    expect(response.headers.get("Vary")).toMatch(/Cookie/i);
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
