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
 * For the same reason the default install location is hardcoded and tried ahead
 * of `%SystemRoot%` — see `systemRootCandidates`. Both levers that decide which
 * binary gets elevated are environment variables a standard user can seed, and
 * neither is worth trusting for that decision.
 *
 * The PowerShell scripts in this repo resolve `diskpart.exe`, `mountvol.exe`
 * and `format.com` through `$env:SystemRoot`; this covers the interpreter
 * itself and the other System32 tools we spawn directly.
 */

import { existsSync } from "fs";
import path from "path";

const POWERSHELL_RELATIVE_PATH = "WindowsPowerShell\\v1.0\\powershell.exe";

/** Where Windows lives on all but a rebuilt-to-another-drive install. */
const DEFAULT_WINDOWS_ROOT = "C:\\Windows";

/** `%SystemRoot%`, falling back to the Windows default when unset. */
export function windowsSystemRoot(): string {
  return process.env.SystemRoot || process.env.windir || DEFAULT_WINDOWS_ROOT;
}

/**
 * Windows directories to search, most trustworthy first.
 *
 * `%SystemRoot%` and `%windir%` are the only sources Node exposes, and both are
 * environment variables — the clean primitive, `GetSystemDirectoryW`, needs a
 * native module this app does not carry. An environment variable is a weaker
 * input than it looks: a standard user can seed one for their own future
 * processes, and the value picked here decides which binary
 * `Start-Process -Verb RunAs` elevates. So the default install location is
 * hardcoded and tried first, which puts the elevated binary out of reach of the
 * variable on any machine that keeps Windows where Windows puts it.
 *
 * A machine whose Windows genuinely lives elsewhere has no `C:\Windows` to find
 * and falls through to the variable, so those installs keep working. The one
 * odd case is such a machine that also carries a leftover `C:\Windows` from a
 * previous install: we would run that copy's tool instead. It is still a
 * Microsoft-signed System32 binary — a staleness risk, not a security one.
 */
function systemRootCandidates(): string[] {
  const fromEnv = windowsSystemRoot();
  const sameAsDefault =
    path.resolve(fromEnv).toLowerCase() === path.resolve(DEFAULT_WINDOWS_ROOT).toLowerCase();
  return sameAsDefault ? [DEFAULT_WINDOWS_ROOT] : [DEFAULT_WINDOWS_ROOT, fromEnv];
}

/** Absolute candidate paths for a System32 executable, in search order. */
function system32Candidates(relativePath: string): string[] {
  return systemRootCandidates().map((root) => path.join(root, "System32", relativePath));
}

/**
 * Resolves a System32 executable to an absolute path, falling back to
 * `fallbackName` only when no candidate exists — a machine genuinely missing
 * the tool, which then fails with the ENOENT that `powerShellMissingMessage`
 * explains.
 *
 * On a 32-bit build running on 64-bit Windows, WOW64 redirects this path to
 * `SysWOW64`, which carries the same tools — the same binary the bare-name
 * spawn would have reached.
 */
export function system32Exe(relativePath: string, fallbackName: string): string {
  if (process.platform !== "win32") return fallbackName;
  return system32Candidates(relativePath).find(existsSync) ?? fallbackName;
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
  const candidates = system32Candidates(POWERSHELL_RELATIVE_PATH);
  const resolved = candidates.find(existsSync);
  const raw = process.env.PATH || process.env.Path || "";
  const entries = raw.split(";").filter((entry) => entry.trim());
  const pathHas = (needle: string) =>
    entries.some((entry) => entry.toLowerCase().includes(needle));
  return [
    `arch=${process.arch}`,
    `systemRoot=${windowsSystemRoot()}`,
    // Qual candidato venceu: "padrao" quando o C:\Windows fixo resolveu, "env"
    // quando so o %SystemRoot% tinha o arquivo — a segunda merece um olhar,
    // porque e a instalacao fora do lugar padrao (ou a variavel adulterada).
    `system32Fonte=${resolved === undefined ? "nenhum" : resolved === candidates[0] ? "padrao" : "env"}`,
    `powershellNoDisco=${resolved !== undefined}`,
    `pathTemSystem32=${pathHas("\\system32")}`,
    `pathTemWindowsPowerShell=${pathHas("windowspowershell")}`,
    `pathEntradas=${entries.length}`,
    `pathChars=${raw.length}`,
    `path=${maskUserProfile(raw)}`,
  ].join(" ");
}

/** User-facing explanation for a PowerShell that could not be launched. */
export function powerShellMissingMessage(): string {
  const expected = system32Candidates(POWERSHELL_RELATIVE_PATH).join(" e em ");
  return (
    "O Windows PowerShell não foi encontrado neste computador " +
    `(procurado em ${expected}). ` +
    "Ele é necessário para listar e preparar pendrives e HDs com segurança. " +
    "Restaure o PowerShell do Windows — por segurança o aplicativo só usa a " +
    "cópia oficial em System32 e não procura o interpretador no PATH."
  );
}
