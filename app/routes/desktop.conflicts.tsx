import { Form, Link, useLoaderData } from "react-router";
import type { Route } from "./+types/desktop.conflicts";
import { query } from "~/lib/db.server";
import { isDesktopRuntime } from "~/lib/runtime.server";

export async function loader(_args: Route.LoaderArgs) {
  if (!isDesktopRuntime()) {
    throw new Response("Not found", { status: 404 });
  }

  const result = await query<{
    doc_id: string;
    remote_payload: string;
    local_payload: string;
    created_at: string;
  }>(
    `SELECT doc_id, remote_payload, local_payload, created_at
       FROM sync_conflicts
      ORDER BY created_at DESC`,
  );

  const conflicts = result.rows.map((row) => {
    let remoteTitle = row.doc_id;
    let localTitle = row.doc_id;
    try {
      const remote = JSON.parse(row.remote_payload) as { title?: string };
      const local = JSON.parse(row.local_payload) as {
        document?: { title?: string };
      };
      remoteTitle = remote.title || remoteTitle;
      localTitle = local.document?.title || localTitle;
    } catch {
      // Keep IDs visible if an older payload cannot be parsed.
    }
    return {
      docId: row.doc_id,
      remoteTitle,
      localTitle,
    };
  });

  return { conflicts };
}

export default function DesktopConflicts() {
  const data = useLoaderData<typeof loader>();
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-hairline bg-canvas/90 px-6 py-4">
        <Link to="/dashboard" className="text-sm font-semibold text-primary">
          ← Back to documents
        </Link>
        <h1 className="mt-6 text-2xl font-bold">Sync conflicts</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Both this device and the hosted app changed the same document. Choose
          which version should be kept. Nothing is deleted until you choose.
        </p>
      </header>

      <div className="mx-auto max-w-4xl space-y-4 px-6 py-8">
        {data.conflicts.length === 0 ? (
          <div className="rounded-xl border border-hairline bg-surface p-8 text-center text-sm text-muted">
            No unresolved conflicts.
          </div>
        ) : (
          data.conflicts.map((conflict) => (
            <section key={conflict.docId} className="rounded-xl border border-hairline bg-paper p-5 shadow-sm">
              <p className="font-mono text-xs text-subtle">{conflict.docId}</p>
              <h2 className="mt-2 text-lg font-semibold">{conflict.localTitle}</h2>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg border border-hairline bg-surface p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-subtle">This device</p>
                  <p className="mt-1">{conflict.localTitle}</p>
                </div>
                <div className="rounded-lg border border-hairline bg-surface p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Hosted app</p>
                  <p className="mt-1">{conflict.remoteTitle}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Form method="post" action="/__desktop/sync?mode=resolve">
                  <input type="hidden" name="docId" value={conflict.docId} />
                  <input type="hidden" name="choice" value="local" />
                  <button className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark">
                    Keep this device
                  </button>
                </Form>
                <Form method="post" action="/__desktop/sync?mode=resolve">
                  <input type="hidden" name="docId" value={conflict.docId} />
                  <input type="hidden" name="choice" value="remote" />
                  <button className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-body hover:bg-strong">
                    Keep hosted version
                  </button>
                </Form>
              </div>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
