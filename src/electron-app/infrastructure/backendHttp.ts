import http from "http";
import { getConfiguredServerPort } from "../services/settingsService";
import type { BackendResponse } from "./backendFailure";

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
  const url  = `http://localhost:${port}${urlPath}`;
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c; });
      res.on("end",  () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      reject(new Error(
        `${err.code || err.name || "Erro de rede"} ao contatar o servidor local em ${url}` +
        (err.message ? ` (${err.message})` : "")
      ));
    });
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error(`O servidor local nao respondeu em 120s (${url})`));
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
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      hostname: "localhost",
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
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(payload);
    req.end();
  });
}
