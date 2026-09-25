import { newEditToken } from "./ids";
import {
  markLocalDocumentDirty,
  recordDocumentChange,
} from "./sync.server";
import type { QueryRunner } from "./db.server";

export type ClaimResult =
  | { kind: "claimed"; editToken: string }
  | { kind: "owned" }
  | { kind: "forbidden" }
  | { kind: "not-found" };

export async function claimDocument(
  runQuery: QueryRunner,
  docId: string,
  editToken: string,
  userId: string,
): Promise<ClaimResult> {
  const current = await runQuery<{
    owner_user_id: string | null;
    edit_token: string;
  }>(
    `SELECT owner_user_id, edit_token
       FROM docs
      WHERE id = $1 AND deleted_at IS NULL
      FOR UPDATE`,
    [docId],
  );
  if (!current.rows.length) return { kind: "not-found" };

  const doc = current.rows[0];
  if (doc.owner_user_id) return { kind: "owned" };
  if (doc.edit_token !== editToken) return { kind: "forbidden" };

  const nextEditToken = newEditToken();
  await runQuery(
    `UPDATE docs
        SET owner_user_id = $1, edit_token = $2, last_activity_at = now()
      WHERE id = $3`,
    [userId, nextEditToken, docId],
  );
  await recordDocumentChange(runQuery, docId, userId);
  await markLocalDocumentDirty(docId, false, runQuery);
  return { kind: "claimed", editToken: nextEditToken };
}
