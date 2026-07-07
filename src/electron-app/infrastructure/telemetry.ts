import os from "os";
import fs from "fs";
import { app } from "electron";
import { getConfiguredErrorReporting, getConfiguredErrorReportingEndpoint } from "../services/settingsService";
import { getLogInfo, getAppVersion } from "./serverLog";

const DEFAULT_ENDPOINT = "https://digitalstoregames.pythonanywhere.com/logErr";
const MAX_MESSAGE_CHARS = 4000;
const MAX_LOG_BYTES = 256 * 1024;
const TIMEOUT_MS = 5000;

const seenErrors = new Set<string>();

export interface TelemetryPayload {
  project: string;
  file: string;
  method: string;
  message: string;
  user_agent: string;
  platform: string;
  screen: string;
  page_url: string;
  logs: string[];
}

/**
 * Reads the tail of the current session log file up to MAX_LOG_BYTES.
 */
function readLogTail(): string {
  try {
    const { currentLogFile } = getLogInfo();
    if (fs.existsSync(currentLogFile)) {
      const stats = fs.statSync(currentLogFile);
      const start = Math.max(0, stats.size - MAX_LOG_BYTES);
      const length = stats.size - start;

      const fd = fs.openSync(currentLogFile, "r");
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      fs.closeSync(fd);

      return buffer.toString("utf8");
    }
  } catch (err) {
    console.error("[Telemetry] Failed to read log tail:", err);
  }
  return "";
}

/**
 * Formats a string to stay under the MAX_LOG_BYTES tail limit.
 */
function capLog(log: string): string {
  if (!log) return "";
  if (log.length > MAX_LOG_BYTES) {
    return log.slice(log.length - MAX_LOG_BYTES);
  }
  return log;
}

/**
 * Sends a telemetry payload to the endpoint using POST, falling back to GET on failure.
 */
async function send(payload: TelemetryPayload): Promise<void> {
  const customEndpoint = getConfiguredErrorReportingEndpoint();
  const endpoint = customEndpoint || DEFAULT_ENDPOINT;

  // Try POST
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (res.ok) {
      console.log(`[Telemetry] Error reported successfully via POST to ${endpoint}`);
      return;
    }
    console.warn(`[Telemetry] POST returned status ${res.status}, trying GET fallback`);
  } catch (err: any) {
    console.warn("[Telemetry] POST failed, trying GET fallback:", err.message || String(err));
  }

  // Fallback GET (no logs)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const u = new URL(endpoint);
    u.searchParams.set("project", payload.project);
    u.searchParams.set("file", payload.file);
    u.searchParams.set("method", payload.method);
    u.searchParams.set("message", payload.message);
    u.searchParams.set("user_agent", payload.user_agent);
    u.searchParams.set("platform", payload.platform);
    u.searchParams.set("screen", payload.screen);
    u.searchParams.set("page_url", payload.page_url);

    const res = await fetch(u.toString(), {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (res.ok) {
      console.log("[Telemetry] Error reported successfully via GET fallback");
    } else {
      console.error(`[Telemetry] GET fallback returned status ${res.status}`);
    }
  } catch (err: any) {
    console.error("[Telemetry] GET fallback failed:", err.message || String(err));
  }
}

/**
 * Report an error to the telemetry endpoint.
 * This function is fully safe and will never throw or block the main thread.
 */
export function reportError(
  component: string,
  file: string,
  method: string,
  message: string,
  pageUrl = "",
  extraLogs: string[] = [],
  terminal = false
): void {
  try {
    const enabled = getConfiguredErrorReporting();
    if (!enabled) return;

    const dedupKey = `${component}|${message}`;
    if (seenErrors.has(dedupKey)) return;
    seenErrors.add(dedupKey);

    let msg = message || "";
    if (msg.length > MAX_MESSAGE_CHARS) {
      msg = msg.slice(0, MAX_MESSAGE_CHARS);
    }

    const logs: string[] = [];
    const logTail = readLogTail();
    if (logTail) logs.push(logTail);

    for (const log of extraLogs) {
      if (logs.length >= 20) break;
      logs.push(capLog(log));
    }

    const appVersion = getAppVersion();
    const platform = `${process.platform}/${process.arch}/${os.release()}`;

    const payload: TelemetryPayload = {
      project: `xbox-360-companion/${component}`,
      file: file || "unknown",
      method: method || "unknown",
      message: msg,
      user_agent: `ElectronApp v${appVersion}`,
      platform,
      screen: "",
      page_url: pageUrl || "",
      logs,
    };

    if (terminal) {
      // For terminal errors (e.g. uncaughtExceptions), we use synchornous await
      // to give the network operation a chance to run before exiting.
      send(payload).catch((e) => console.error("[Telemetry] Terminal send failed:", e));
    } else {
      // Standard async fire-and-forget
      setTimeout(() => {
        send(payload).catch((e) => console.error("[Telemetry] Async send failed:", e));
      }, 0);
    }
  } catch (err) {
    console.error("[Telemetry] Error reporting failed in wrapper:", err);
  }
}
