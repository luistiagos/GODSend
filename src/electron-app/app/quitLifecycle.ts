export interface BeforeQuitDeps {
  setIsQuitting: (quitting: boolean) => void;
  hasRunningBackend: () => boolean;
  stopSync: () => void;
  stopAndWait: () => Promise<void>;
  retriggerQuit: () => void;
  logEvent: (category: string, message: string) => void;
}

/**
 * Intercepts the first `before-quit` pass when the Go backend is still running
 * so Electron stays alive until godsend-backend.exe exits and releases
 * `.godsend.lock` ([[electron-main-quit-deixa-backend-vivo-travando-runtime-na-reabertura_2026-11-12T20-35]]).
 */
export function createBeforeQuitHandler(deps: BeforeQuitDeps): (event: { preventDefault: () => void }) => void {
  let quitCleanupDone = false;
  let quitCleanupInFlight = false;

  return (event) => {
    deps.setIsQuitting(true);
    if (quitCleanupDone || !deps.hasRunningBackend()) {
      deps.stopSync();
      deps.logEvent("LIFECYCLE", "application before-quit");
      return;
    }

    event.preventDefault();
    if (quitCleanupInFlight) return;
    quitCleanupInFlight = true;
    deps.logEvent("LIFECYCLE", "application before-quit (waiting for backend stop)");

    void deps.stopAndWait()
      .catch(() => {})
      .finally(() => {
        quitCleanupDone = true;
        quitCleanupInFlight = false;
        deps.retriggerQuit();
      });
  };
}
