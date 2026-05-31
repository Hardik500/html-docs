import { redirect } from "react-router";
import { createSupabaseServerClient } from "./supabase.server";

export async function getUser(
  request: Request
): Promise<{ id: string; email: string } | null> {
  const { supabase } = createSupabaseServerClient(request);
  // Verify the JWT locally via cached JWKS (asymmetric signing keys) instead of
  // a network round trip to the Auth server. Session refresh/persistence is
  // handled once per request by the root loader.
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) return null;
  const email = data.claims.email;
  return { id: sub, email: typeof email === "string" ? email : "" };
}

export async function getUserId(request: Request): Promise<string | null> {
  const user = await getUser(request);
  return user?.id ?? null;
}

export async function requireUserId(request: Request): Promise<string> {
  const userId = await getUserId(request);
  if (!userId) throw redirect("/");
  return userId;
}
