// Whether the backend we spawned has opened its port yet.
//
// The Go backend clears stale processing scratch before it listens, and with a
// leftover extraction of ~20k files that took 78 s. A request sent in that gap
// got ECONNREFUSED and the catalog showed "Falha ao carregar o catálogo" for a
// healthy backend (docs/bugs/open/electron-main-catalogo-falha-com-econnrefused-
// enquanto-o-backend-ainda-limpa-o-temp-antes-de-abrir-a-porta_2026-10-09T18-46.md).
// No imports on purpose: backendClient sets the state, backendHttp waits on it.

let starting = false;
let waiters: Array<() => void> = [];

function releaseWaiters(): void {
  const pending = waiters;
  waiters = [];
  for (const release of pending) release();
}

export function markBackendStarting(): void {
  starting = true;
}

// Called on the GODSEND_LISTEN_PORT line and when the process is gone: either
// way a waiting request should go out and see the real outcome.
export function markBackendListening(): void {
  starting = false;
  releaseWaiters();
}

export function markBackendStopped(): void {
  starting = false;
  releaseWaiters();
}

// Resolves at once when no spawned backend is starting (already listening, run
// outside the app, unit tests). Never rejects: past the deadline the request is
// sent anyway and fails with its real error.
export function waitForBackendListening(timeoutMs = 120000): Promise<void> {
  if (!starting) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters = waiters.filter((w) => w !== release);
      resolve();
    }, timeoutMs);
    const release = () => {
      clearTimeout(timer);
      resolve();
    };
    waiters.push(release);
  });
}
