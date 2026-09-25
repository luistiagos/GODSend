import http from "http";
import { getConfiguredServerPort } from "../services/settingsService";
import type { BackendResponse } from "./backendFailure";

// The Go backend listens on IPv4. Resolving localhost to ::1 can refuse a
// connection even while the backend is running normally on 127.0.0.1.
const BACKEND_HOST = "127.0.0.1";

function networkError(err: NodeJS.ErrnoException, url: string, port: number): Error {
  const source = err as NodeJS.ErrnoException & { address?: string; port?: number };
  return Object.assign(new Error(
    `${err.code || err.name || "Erro de rede"} ao contatar o servidor local em ${url}` +
    (err.message ? ` (${err.message})` : ""),
    { cause: err },
  ), {
    code: err.code,
    errno: err.errno,
    syscall: err.syscall,
    address: source.address ?? BACKEND_HOST,
    port: source.port ?? port,
  });
}

function timeoutError(url: string, port: number, timeoutMs: number): Error {
  return Object.assign(new Error(
    `ETIMEDOUT: o servidor local nao respondeu em ${timeoutMs / 1000}s (${url})`,
  ), { code: "ETIMEDOUT", address: BACKEND_HOST, port, timeoutMs });
}

/**
 * Fire a GET request to the local Go backend and resolve with the status code
 * and the raw response body. Rejects on network error or 120-second timeout.
 *
 * Callers that must distinguish a real answer from a rejection need the status:
 * the backend signals failure with a 4xx/5xx plus a JSON body, so a caller that
 * only looks at the body silently treats every failure as a success.
 */
export function backendGetWithStatus(urlPath: string): Promise<BackendResponse> {
  const port = getConfiguredServerPort();
  const url  = `http://${BACKEND_HOST}:${port}${urlPath}`;
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c; });
      res.on("end",  () => resolve({ status: res.statusCode ?? 0, body: data }));
      res.on("error", (err: NodeJS.ErrnoException) => reject(networkError(err, url, port)));
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      reject(networkError(err, url, port));
    });
    req.setTimeout(120000, () => {
      reject(timeoutError(url, port, 120000));
      req.destroy();
    });
  });
}

/**
 * Fire a GET request to the local Go backend and resolve with the raw response
 * body text. Rejects on network error or 120-second timeout.
 */
export function backendGet(urlPath: string): Promise<string> {
  return backendGetWithStatus(urlPath).then((res) => res.body);
}

/**
 * Fire a POST request with a JSON body to the local Go backend and resolve
 * with the parsed JSON response. Rejects on network error or timeout.
 */
export function backendPost(urlPath: string, body: object, timeoutMs = 600000): Promise<any> {
  const port    = getConfiguredServerPort();
  const url     = `http://${BACKEND_HOST}:${port}${urlPath}`;
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      hostname: BACKEND_HOST,
      port,
      path:     urlPath,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c; });
      res.on("end",  () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: data }); }
      });
      res.on("error", (err: NodeJS.ErrnoException) => reject(networkError(err, url, port)));
    });
    req.on("error", (err: NodeJS.ErrnoException) => reject(networkError(err, url, port)));
    req.setTimeout(timeoutMs, () => {
      reject(timeoutError(url, port, timeoutMs));
      req.destroy();
    });
    req.write(payload);
    req.end();
  });
}
