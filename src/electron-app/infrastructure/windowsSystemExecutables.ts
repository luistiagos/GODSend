/**
 * Absolute paths for the Windows system executables this app shells out to.
 *
 * `spawn("powershell.exe", ...)` resolves the bare name through %PATH%. On
 * installs whose PATH lost `%SystemRoot%\System32\WindowsPowerShell\v1.0` —
 * hand-edited, truncated past the 2047-character limit, or stripped by a
 * "debloated" Windows image — every one of those calls fails with
 * `spawn powershell.exe ENOENT`, and the USB screens surfaced that string
 * verbatim as the device list error.
 *
 * The PowerShell scripts in this repo already resolve `diskpart.exe`,
 * `mountvol.exe` and `format.com` through `$env:SystemRoot` for the same
 * reason; this does it for the interpreter itself and for the other System32
 * tools we spawn directly.
 */

import { existsSync } from "fs";
import path from "path";

const POWERSHELL_RELATIVE_PATH = "WindowsPowerShell\\v1.0\\powershell.exe";

/** `%SystemRoot%`, falling back to the Windows default when unset. */
export function windowsSystemRoot(): string {
  return process.env.SystemRoot || process.env.windir || "C:\\Windows";
}

/**
 * Absolute path to a System32 executable. Returns `fallbackName` (the previous
 * %PATH% lookup) off Windows, or when the file really is absent, so a missing
 * file degrades exactly as before instead of failing on a path we invented.
 */
export function system32Exe(relativePath: string, fallbackName: string): string {
  if (process.platform !== "win32") return fallbackName;
  const absolute = path.join(windowsSystemRoot(), "System32", relativePath);
  return existsSync(absolute) ? absolute : fallbackName;
}

/** Windows PowerShell 5.1 interpreter. */
export function powerShellExe(): string {
  return system32Exe(POWERSHELL_RELATIVE_PATH, "powershell.exe");
}

/**
 * PowerShell expression that resolves the interpreter inside a script, for the
 * nested `Start-Process` used to elevate. Same %PATH% exposure as the outer
 * spawn, so it gets the same treatment.
 */
export const POWERSHELL_EXE_PS_EXPRESSION =
  "(Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe')";

/** True when a spawn failure means the executable itself was not found. */
export function isExecutableNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
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
