const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "htmlDocsDesktop",
  Object.freeze({
    isDesktop: true,
    platform: process.platform,
    startSignIn: (email) => ipcRenderer.invoke("desktop:start-sign-in", email),
    getSyncStatus: () => ipcRenderer.invoke("desktop:get-sync-status"),
    syncNow: () => ipcRenderer.invoke("desktop:sync-now"),
    signOut: () => ipcRenderer.invoke("desktop:sign-out"),
    openFiles: () => ipcRenderer.invoke("desktop:open-files"),
    onSyncStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on("desktop:sync-status", listener);
      return () => ipcRenderer.removeListener("desktop:sync-status", listener);
    },
  }),
);
