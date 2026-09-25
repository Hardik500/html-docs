import { redirect } from "react-router";
import type { Route } from "./+types/auth.claim";
import { withTransaction } from "~/lib/db.server";
import { requireUserId } from "~/lib/auth.server";
import { claimDocument } from "~/lib/claim.server";

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  // editToken comes from the page's loader data (JS heap) — never from a URL.
  const body = await request.json() as { docId: string; editToken: string };
  const { docId, editToken } = body;

  if (!docId || !editToken) {
    throw new Response("docId and editToken are required", { status: 400 });
  }

  const result = await withTransaction((runQuery) =>
    claimDocument(runQuery, docId, editToken, userId),
  );

  if (result.kind === "not-found") {
    throw new Response("Document not found", { status: 404 });
  }
  if (result.kind === "owned") {
    throw new Response("Document already has an owner", { status: 409 });
  }
  if (result.kind === "forbidden") {
    throw new Response("Invalid edit token", { status: 403 });
  }

  return { ok: true, editToken: result.editToken };
}

// No GET — only POST
export function loader() {
  return redirect("/");
}
