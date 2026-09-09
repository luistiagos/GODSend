/**
 * Resolves the Windows system executables this app shells out to: %PATH% first,
 * `%SystemRoot%\System32` as fallback.
 *
 * `spawn("powershell.exe", ...)` resolves the bare name through %PATH% and
 * nothing else. On installs whose PATH lost
 * `%SystemRoot%\System32\WindowsPowerShell\v1.0` — hand-edited, truncated past
 * the 2047-character limit, or stripped by a "debloated" Windows image — every
 * one of those calls fails with `spawn powershell.exe ENOENT`, and the USB
 * screens surfaced that string verbatim as the device list error.
 *
 * The order here keeps %PATH% authoritative, so an admin who points the machine
 * at a different install still wins, and only falls back to the canonical
 * System32 location when the lookup comes up empty. The PowerShell scripts in
 * this repo resolve `diskpart.exe`, `mountvol.exe` and `format.com` through
 * `$env:SystemRoot` for the same reason; this covers the interpreter itself and
 * the other System32 tools we spawn directly.
 */

import { existsSync } from "fs";
import path from "path";

const POWERSHELL_RELATIVE_PATH = "WindowsPowerShell\\v1.0\\powershell.exe";

/** `%SystemRoot%`, falling back to the Windows default when unset. */
export function windowsSystemRoot(): string {
  return process.env.SystemRoot || process.env.windir || "C:\\Windows";
}

/**
 * First match for `name` in %PATH% — the same lookup `spawn` would do, minus the
 * current directory, and without paying a failed spawn to find out. Returns the
 * resolved absolute path so callers and logs can see which one was picked.
 */
function resolveOnPath(name: string): string | null {
  const raw = process.env.PATH || process.env.Path || "";
  for (const entry of raw.split(";")) {
    // PATH entries may be quoted, and unexpanded ones simply will not exist.
    const dir = entry.trim().replace(/^"+|"+$/g, "");
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolves a System32 executable: %PATH% first, then the canonical
 * `%SystemRoot%\System32` location, then `fallbackName` so the OS still gets its
 * own attempt (it also searches the app and current directories, which the PATH
 * scan above deliberately does not).
 */
export function system32Exe(relativePath: string, fallbackName: string): string {
  if (process.platform !== "win32") return fallbackName;
  const onPath = resolveOnPath(path.basename(relativePath));
  if (onPath) return onPath;
  const absolute = path.join(windowsSystemRoot(), "System32", relativePath);
  return existsSync(absolute) ? absolute : fallbackName;
}

/** Windows PowerShell 5.1 interpreter. */
export function powerShellExe(): string {
  return system32Exe(POWERSHELL_RELATIVE_PATH, "powershell.exe");
}

/** True when a spawn failure means the executable itself was not found. */
export function isExecutableNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

/**
 * Replaces the user profile folder with `%USERPROFILE%`. The PATH almost always
 * names it, and the Windows account name is usually the person's real name.
 */
function maskUserProfile(value: string): string {
  const profile = process.env.USERPROFILE;
  if (!profile) return value;
  const escaped = profile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "gi"), "%USERPROFILE%");
}

/**
 * What the OS actually exposes to `spawn`, for triaging the ENOENT class of
 * failure. It separates the two causes that need opposite fixes: the file is
 * gone (Windows "debloatado" — `powershellNoDisco=false`) versus the file is
 * there and the %PATH% lost the folder (`pathTemWindowsPowerShell=false`), with
 * `pathChars` near 1024 or 2047 apontando truncamento em vez de edição manual.
 *
 * Goes to the session log, whose tail telemetry ships — por isso o PATH vai com
 * a pasta do perfil mascarada.
 */
export function describeWindowsExecutableEnvironment(): string {
  if (process.platform !== "win32") {
    return `plataforma=${process.platform} (a checagem de PATH só se aplica ao Windows)`;
  }
  const expected = path.join(windowsSystemRoot(), "System32", POWERSHELL_RELATIVE_PATH);
  const raw = process.env.PATH || process.env.Path || "";
  const entries = raw.split(";").filter((entry) => entry.trim());
  const pathHas = (needle: string) =>
    entries.some((entry) => entry.toLowerCase().includes(needle));
  return [
    `arch=${process.arch}`,
    `systemRoot=${windowsSystemRoot()}`,
    `powershellNoDisco=${existsSync(expected)}`,
    `pathTemSystem32=${pathHas("\\system32")}`,
    `pathTemWindowsPowerShell=${pathHas("windowspowershell")}`,
    `pathEntradas=${entries.length}`,
    `pathChars=${raw.length}`,
    `path=${maskUserProfile(raw)}`,
  ].join(" ");
}

/** User-facing explanation for a PowerShell that could not be launched. */
export function powerShellMissingMessage(): string {
  const expected = path.join(windowsSystemRoot(), "System32", POWERSHELL_RELATIVE_PATH);
  return (
    "O Windows PowerShell não foi encontrado neste computador " +
    `(procurado em ${expected}). ` +
    "Ele é necessário para listar e preparar pendrives e HDs com segurança. " +
    "Verifique se a variável PATH inclui %SystemRoot%\\System32\\WindowsPowerShell\\v1.0 " +
    "ou restaure o PowerShell do Windows."
  );
}
