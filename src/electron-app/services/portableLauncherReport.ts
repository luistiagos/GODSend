import fs from "fs";
import path from "path";
import { appendAppEvent } from "../infrastructure/serverLog";
import { reportError } from "../infrastructure/telemetry";
import { getDefaultAppDataDir, isPortable } from "./appDataPath";

/**
 * Written by the portable launcher (build/portable.nsi, launcherFailed) each
 * time it could not open the app, one line per attempt:
 * `<date time>\t<launcher version>\t<reason> <details>`.
 *
 * The launcher fails before any Electron process exists, so this file is the
 * only trace of a customer who clicked and got no app.
 */
export const LAUNCHER_FAILURE_LOG = "launcher-failures.log";

/** Reads and deletes the launcher's failure log. Returns its lines, oldest first. */
export function consumeLauncherFailures(dir: string): string[] {
  const file = path.join(dir, LAUNCHER_FAILURE_LOG);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "latin1");
  } catch {
    return [];
  }
  try {
    fs.unlinkSync(file);
  } catch {}
  return raw.split(/\r?\n/).filter((line) => line.trim());
}

/** The reason code of a line: `sem-espaco`, `extracao-incompleta`, `nao-iniciou`, `pacote-nao-gravado`. */
export function launcherFailureReason(line: string): string {
  return (line.split("\t")[2] || "").trim().split(" ")[0] || "desconhecido";
}

/** Boot hook: reports the launches that failed before this one. */
export function reportLauncherFailures(): void {
  if (!isPortable()) return;
  const failures = consumeLauncherFailures(getDefaultAppDataDir());
  if (failures.length === 0) return;

  // The reason alone in the message, so the panel groups by cause.
  const msg = `o portátil não abriu antes desta execução: ${launcherFailureReason(failures[failures.length - 1])}`;
  appendAppEvent("LAUNCHER", `${msg} (${failures.length} tentativa(s)): ${failures.join(" | ")}`);
  reportError("portable-launcher", "build/portable.nsi", "launcherFailed", msg, "", [failures.join("\n")]);
}
