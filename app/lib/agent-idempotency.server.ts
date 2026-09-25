import { query } from "./db.server";
import { AgentWriteError } from "./document-input";

/**
 * Replay protection for agent writes.
 *
 * A retried MCP tool call (network retry, client restart, model re-emission)
 * must not create a duplicate document or apply the same edit twice. The first
 * call for a given (token, key) pair runs `run`; later calls replay the stored
 * response instead of executing again.
 */
export async function withIdempotency<T>(
  identity: { tokenId: string; userId: string },
  idempotencyKey: string | null,
  toolName: string,
  run: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  if (!idempotencyKey) {
    return { result: await run(), replayed: false };
  }

  const key = idempotencyKey.trim().slice(0, 200);
  if (!key) return { result: await run(), replayed: false };

  const claimed = await query<{ id: string }>(
    `INSERT INTO agent_idempotency_keys
       (token_id, user_id, idempotency_key, tool_name, status)
     VALUES ($1, $2, $3, $4, 'in_progress')
     ON CONFLICT (token_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [identity.tokenId, identity.userId, key, toolName],
  );

  if (!claimed.rows.length) {
    const existing = await query<{ status: string; response: unknown }>(
      `SELECT status, response
         FROM agent_idempotency_keys
        WHERE token_id = $1 AND idempotency_key = $2`,
      [identity.tokenId, key],
    );
    const row = existing.rows[0];
    if (!row) {
      // The claim was released between the insert and this read; treat the
      // operation as new rather than silently dropping it.
      return { result: await run(), replayed: false };
    }
    if (row.status !== "completed" || row.response === null) {
      throw new AgentWriteError(
        `An identical ${toolName} call (idempotencyKey "${key}") is still in progress`,
        409,
      );
    }
    return { result: row.response as T, replayed: true };
  }

  try {
    const result = await run();
    await query(
      `UPDATE agent_idempotency_keys
          SET status = 'completed', response = $2::jsonb, completed_at = now()
        WHERE id = $1`,
      [claimed.rows[0].id, JSON.stringify(result)],
    );
    return { result, replayed: false };
  } catch (error) {
    // A failed call must stay retryable, so release the claim.
    await query(
      "DELETE FROM agent_idempotency_keys WHERE id = $1 AND status = 'in_progress'",
      [claimed.rows[0].id],
    )
      .catch(() => undefined);
    throw error;
  }
}
