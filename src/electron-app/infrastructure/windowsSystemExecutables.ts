/**
 * Resolves the Windows system executables this app shells out to, from the
 * canonical `%SystemRoot%\System32` location.
 *
 * `spawn("powershell.exe", ...)` resolves the bare name through %PATH% and
 * nothing else. On installs whose PATH lost
 * `%SystemRoot%\System32\WindowsPowerShell\v1.0` — hand-edited, truncated past
 * the 2047-character limit, or stripped by a "debloated" Windows image — every
 * one of those calls fails with `spawn powershell.exe ENOENT`, and the USB
 * screens surfaced that string verbatim as the device list error.
 *
 * %PATH% must NOT win over the canonical location, and an earlier version of
 * this file let it. These names — `powershell.exe`, `cmd.exe`, `net.exe`,
 * `chkdsk.exe` — are spawned to format and repair drives, and `fat32Format.ts`
 * hands the resolved interpreter to `Start-Process -Verb RunAs`. A
 * user-writable directory that appears in %PATH% (`%LOCALAPPDATA%\Microsoft\
 * WindowsApps` and per-user tool installs are the usual ones) would let
 * anything named `powershell.exe` there run **with administrator rights**,
 * under the UAC prompt the user approves believing it is the disk format.
 * Reading `%SystemRoot%\System32` directly fixes the ENOENT bug just as well —
 * those machines still have the file on disk, it is only the PATH entry that
 * went missing — without handing a planted binary the elevation.
 *
 * The PowerShell scripts in this repo resolve `diskpart.exe`, `mountvol.exe`
 * and `format.com` through `$env:SystemRoot` for the same reason; this covers
 * the interpreter itself and the other System32 tools we spawn directly.
 */

import { existsSync } from "fs";
import path from "path";

const POWERSHELL_RELATIVE_PATH = "WindowsPowerShell\\v1.0\\powershell.exe";

/** `%SystemRoot%`, falling back to the Windows default when unset. */
export function windowsSystemRoot(): string {
  return process.env.SystemRoot || process.env.windir || "C:\\Windows";
}

/**
 * Resolves a System32 executable to its absolute `%SystemRoot%\System32` path,
 * falling back to `fallbackName` only when the file is not there at all — a
 * machine genuinely missing the tool, which then fails with the ENOENT that
 * `powerShellMissingMessage` explains.
 *
 * On a 32-bit build running on 64-bit Windows, WOW64 redirects this path to
 * `SysWOW64`, which carries the same tools — the same binary the bare-name
 * spawn would have reached.
 */
export function system32Exe(relativePath: string, fallbackName: string): string {
  if (process.platform !== "win32") return fallbackName;
  const absolute = path.join(windowsSystemRoot(), "System32", relativePath);
  return existsSync(absolute) ? absolute : fallbackName;
}

/**
 * True when `exe` is a verified absolute path rather than a bare name left to
 * %PATH%. Callers that elevate must check this: `Start-Process -Verb RunAs` on
 * a bare name repeats the %PATH% lookup inside the elevated child, which is the
 * one place a planted binary would gain administrator rights.
 */
export function isResolvedSystemExe(exe: string): boolean {
  return path.isAbsolute(exe) && existsSync(exe);
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
 * failure. Resolution no longer depends on %PATH%, so `powershellNoDisco=false`
 * is now the whole diagnosis (Windows "debloatado" — the file is gone); the
 * PATH fields stay because they tell the *user's* story: a machine that reached
 * support with `pathTemWindowsPowerShell=false` and the file present is one this
 * version already fixed, and `pathChars` near 1024 or 2047 aponta truncamento em
 * vez de edição manual.
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
    "Restaure o PowerShell do Windows — por segurança o aplicativo só usa a " +
    "cópia oficial em System32 e não procura o interpretador no PATH."
  );
}
