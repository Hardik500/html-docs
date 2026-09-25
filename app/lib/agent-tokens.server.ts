import { createHash, randomBytes } from "node:crypto";
import { query } from "./db.server";

export const AGENT_SCOPES = ["docs:read", "docs:write", "docs:delete"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export interface AgentIdentity {
  tokenId: string;
  userId: string;
  email: string;
  scopes: AgentScope[];
  expiresAt?: number;
}

export interface AgentTokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: AgentScope[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeAgentScopes(value: unknown): AgentScope[] {
  const requested = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const scopes = [...new Set(requested.filter((scope): scope is AgentScope =>
    typeof scope === "string" && (AGENT_SCOPES as readonly string[]).includes(scope),
  ))];
  return scopes.length ? scopes : ["docs:read"];
}

export async function createAgentToken(
  userId: string,
  name: string,
  scopes: AgentScope[],
  expiresAt: string | null = null,
): Promise<{ token: string; summary: AgentTokenSummary }> {
  const cleanName = name.trim().slice(0, 100);
  if (!cleanName) throw new Response("Agent name is required", { status: 400 });

  const active = await query<{ count: string | number }>(
    `SELECT COUNT(*)::int AS count
       FROM agent_access_tokens
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())`,
    [userId],
  );
  if (Number(active.rows[0]?.count ?? 0) >= 20) {
    throw new Response("Agent token limit reached. Revoke an unused token first.", {
      status: 409,
    });
  }

  const token = `hdo_${randomBytes(32).toString("base64url")}`;
  const tokenHash = hashAgentToken(token);
  const tokenPrefix = token.slice(0, 12);
  const normalizedScopes = normalizeAgentScopes(scopes);
  const result = await query<{
    id: string;
    name: string;
    token_prefix: string;
    scopes: string[];
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
  }>(
    `INSERT INTO agent_access_tokens
       (user_id, name, token_hash, token_prefix, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, token_prefix, scopes, created_at, last_used_at, expires_at, revoked_at`,
    [userId, cleanName, tokenHash, tokenPrefix, normalizedScopes, expiresAt],
  );

  return {
    token,
    summary: toAgentTokenSummary(result.rows[0]),
  };
}

export async function listAgentTokens(userId: string): Promise<AgentTokenSummary[]> {
  const result = await query<{
    id: string;
    name: string;
    token_prefix: string;
    scopes: string[];
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
  }>(
    `SELECT id, name, token_prefix, scopes, created_at, last_used_at, expires_at, revoked_at
       FROM agent_access_tokens
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map(toAgentTokenSummary);
}

export async function revokeAgentToken(userId: string, tokenId: string): Promise<boolean> {
  const result = await query(
    `UPDATE agent_access_tokens
        SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tokenId, userId],
  );
  return result.rows.length > 0;
}

export async function authenticateAgentToken(token: string): Promise<AgentIdentity | null> {
  if (!token.startsWith("hdo_")) return null;
  const result = await query<{
    token_id: string;
    user_id: string;
    email: string | null;
    scopes: string[];
    expires_at: string | null;
  }>(
    `SELECT t.id AS token_id, t.user_id, u.email, t.scopes, t.expires_at
       FROM agent_access_tokens t
       JOIN auth.users u ON u.id = t.user_id
      WHERE t.token_hash = $1
        AND t.revoked_at IS NULL`,
    [hashAgentToken(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;

  void query(
    "UPDATE agent_access_tokens SET last_used_at = now() WHERE id = $1",
    [row.token_id],
  ).catch(() => undefined);

  return {
    tokenId: row.token_id,
    userId: row.user_id,
    email: row.email ?? "",
    scopes: normalizeAgentScopes(row.scopes),
    ...(row.expires_at ? { expiresAt: Math.floor(new Date(row.expires_at).getTime() / 1000) } : {}),
  };
}

export async function recordAgentEvent(
  identity: AgentIdentity,
  toolName: string,
  documentId: string | null,
  status: "ok" | "error",
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await query(
      `INSERT INTO agent_audit_events
         (user_id, token_id, tool_name, document_id, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        identity.userId,
        identity.tokenId,
        toolName,
        documentId,
        status,
        JSON.stringify(metadata),
      ],
    );
  } catch {
    // Audit failures must not fail the agent operation.
  }
}

function toAgentTokenSummary(row: {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}): AgentTokenSummary {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: normalizeAgentScopes(row.scopes),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}
