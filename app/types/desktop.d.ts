interface DesktopSyncStatus {
  state: "signed_out" | "awaiting_auth" | "signed_in" | "syncing" | "synced" | "partial" | "conflict" | "error";
  pending: number;
  conflicts: number;
  lastSyncedAt: string | null;
  message: string;
  hasToken: boolean;
  remoteConfigured: boolean;
  persistent: boolean;
}

interface Window {
  htmlDocsDesktop?: {
    isDesktop: boolean;
    platform: string;
    startSignIn: (email?: string) => Promise<DesktopSyncStatus>;
    getSyncStatus: () => Promise<DesktopSyncStatus | undefined>;
    syncNow: () => Promise<DesktopSyncStatus | undefined>;
    signOut: () => Promise<DesktopSyncStatus | undefined>;
    openFiles: () => Promise<Array<{ name: string; dataBase64: string }>>;
    onSyncStatus: (callback: (status: DesktopSyncStatus) => void) => () => void;
  };
}
