export type AppRuntime = "hosted" | "desktop";

/**
 * The hosted app is the default. The desktop runtime is selected only by the
 * Electron-launched local server, so normal web builds and deployments keep
 * using PostgreSQL and Supabase.
 */
export function getRuntime(): AppRuntime {
  return process.env.HTML_DOCS_RUNTIME === "desktop" ? "desktop" : "hosted";
}

export function isDesktopRuntime(): boolean {
  return getRuntime() === "desktop";
}

export const LOCAL_USER_ID = "00000000-0000-0000-0000-000000000001";
