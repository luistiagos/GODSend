/**
 * Interpretation of replies from the local Go backend.
 *
 * Kept free of Electron imports so it can be unit tested directly.
 */

export interface BackendResponse {
  status: number;   // HTTP status code returned by the Go backend
  body:   string;   // raw response body text
}

/**
 * Turn any thrown value into non-empty text. `err.message` alone is not enough:
 * a rejection carrying no message renders as an empty string and the user is
 * left with an error that explains nothing.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object") {
    const anyErr = err as any;
    if (anyErr.message) return String(anyErr.message);
    if (anyErr.code)    return String(anyErr.code);
    try { return JSON.stringify(err); } catch { /* falls through */ }
  }
  return `falha sem mensagem (${Object.prototype.toString.call(err)})`;
}

/**
 * Describe why a backend reply is a failure, or return null when it is a real
 * success. The Go backend reports failures three different ways:
 *   - jsonError():  4xx/5xx + {"state":"Error","message":"..."}
 *   - a few routes: 200 + {"ok":false,"error":"..."}
 *   - soft misses:  200 + {"status":"<x>_unavailable","message":"..."}
 * Only the second shape carries an `error` key, so a caller that checks `error`
 * alone lets the other two through as successes.
 */
export function backendFailureReason(res: BackendResponse): string | null {
  const body = res.body.trim();

  let parsed: any = null;
  try { parsed = JSON.parse(body); } catch { /* not JSON */ }

  if (parsed && typeof parsed === "object") {
    if (parsed.error) return String(parsed.error);
    if (parsed.state === "Error" && parsed.message) return String(parsed.message);
    if (typeof parsed.status === "string" && parsed.status.endsWith("_unavailable")) {
      return String(parsed.message || `o servidor respondeu "${parsed.status}"`);
    }
  }

  if (res.status < 200 || res.status >= 300) {
    return body
      ? `HTTP ${res.status} do servidor local: ${body.slice(0, 300)}`
      : `HTTP ${res.status} do servidor local, sem detalhes`;
  }

  if (!body) return "o servidor local respondeu com um corpo vazio";
  if (parsed === null) {
    return `resposta inesperada do servidor local: ${body.slice(0, 300)}`;
  }
  return null;
}
