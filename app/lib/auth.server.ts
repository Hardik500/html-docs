import { redirect } from "react-router";
import { createSupabaseServerClient } from "./supabase.server";

export async function getUser(
  request: Request
): Promise<{ id: string; email: string } | null> {
  const { supabase } = createSupabaseServerClient(request);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { id: user.id, email: user.email ?? "" };
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
