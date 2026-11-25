/**
 * Verificação física pós-gravação (sem cache de página do Windows) e normalização de atributos
 * FAT32 dos arquivos e pastas críticos do BadAvatar.
 *
 * Problema que este módulo fecha:
 * 1. Leitura comum no Windows (`fs.createReadStream`) acerta o Page Cache em RAM: num pendrive
 *    falsificado (capacidade adulterada que sobrescreve setores anteriores ao gravar centenas de
 *    MB), com células defeituosas ou porta USB com mau contato, o escritor transacional lia de
 *    volta os bytes limpos da RAM e declarava "Pronto!" com o perfil corrompido na flash real.
 *    Abrir cada arquivo crítico com `FILE_FLAG_NO_BUFFERING` (0x20000000) obriga o Windows a
 *    descarregar páginas pendentes e ler direto da mídia física, fora do cache em RAM.
 * 2. Quando o preparo roda sem formatar sobre um pendrive que já tinha a pasta `Content/` (ou
 *    arquivos) marcada com atributos DOS `Hidden` (+H), `System` (+S) ou `ReadOnly` (+R), o
 *    escritor mantinha esses atributos. Limpá-los nas pastas/arquivos críticos garante entradas
 *    FAT32 limpas e legíveis pelo console.
 *
 * Usa `DefinePInvokeMethod` (emissão IL em memória) em vez de `Add-Type`, evitando invocar
 * `csc.exe`, criar DLLs temporárias ou disparar alertas de antivírus. Roda uma única vez no fim
 * do preparo (nunca em polling) e não exige elevação de administrador.
 */

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { isExploitProfilePath } from "./exploitProfile";
import { hashFileSha256 } from "./secureComponentStaging";
import { appendAppEvent } from "./serverLog";
import { powerShellExe } from "./windowsSystemExecutables";

export interface CriticalFileExpectation {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

export interface PhysicalReadbackFileFailure {
  path: string;
  reason: "missing" | "size-mismatch" | "hash-mismatch" | "open-failed" | "read-error";
  expectedSize?: number;
  actualSize?: number;
  expectedSha256?: string;
  actualSha256?: string;
  win32Error?: number;
}

export interface PhysicalReadbackResult {
  ok: boolean;
  bypassedCache: boolean;
  checkedCount: number;
  clearedAttributeCount: number;
  failures: PhysicalReadbackFileFailure[];
  diagnosticError?: string;
}

const VERIFIER_TIMEOUT_MS = 45_000;

/**
 * Seleciona os arquivos críticos para o console reconhecer o perfil ABadAvatar e disparar o
 * exploit/Aurora: o perfil do exploit, todo o `BadUpdatePayload/`, `launch.ini` e `Aurora/default.xex`.
 */
export function selectCriticalBootFiles<T extends CriticalFileExpectation>(
  entries: readonly T[],
): T[] {
  return entries.filter((entry) => {
    const key = String(entry.relativePath || "").toLowerCase();
    return (
      isExploitProfilePath(entry.relativePath) ||
      key.startsWith("badupdatepayload/") ||
      key === "launch.ini" ||
      key === "aurora/default.xex"
    );
  });
}

/**
 * Lista caminhos (diretórios ancestrais + arquivos críticos) cujos atributos DOS Hidden/System/ReadOnly
 * devem estar limpos na raiz FAT32 para o Xbox 360 enumerar `Content/` e o perfil sem bloqueio.
 */
export function collectCriticalAttributePaths(
  driveRoot: string,
  criticalFiles: readonly CriticalFileExpectation[],
): string[] {
  const root = path.resolve(driveRoot);
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (fullPath: string) => {
    const norm = process.platform === "win32" ? fullPath.toLowerCase() : fullPath;
    if (!seen.has(norm)) {
      seen.add(norm);
      ordered.push(fullPath);
    }
  };

  for (const file of criticalFiles) {
    const segments = file.relativePath.split("/").filter(Boolean);
    let current = root;
    for (const seg of segments) {
      current = path.join(current, seg);
      push(current);
    }
  }
  return ordered;
}

/**
 * Script PowerShell que normaliza atributos DOS (limpa Hidden/System/ReadOnly) e faz leitura
 * física sem cache (`FILE_FLAG_NO_BUFFERING`) usando buffer alinhado de página (`VirtualAlloc`).
 */
export function buildPhysicalFlashVerifyScript(): string {
  return String.raw`param([Parameter(Mandatory = $true)][string]$SpecPath)
$ErrorActionPreference = 'Stop'

$spec = Get-Content -LiteralPath $SpecPath -Raw -Encoding UTF8 | ConvertFrom-Json

$ab = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
  (New-Object System.Reflection.AssemblyName('GodsendPhysicalFlashIO')),
  [System.Reflection.Emit.AssemblyBuilderAccess]::Run
)
$mb = $ab.DefineDynamicModule('M')
$tb = $mb.DefineType('K32', 'Public,Class')

function Add-Win32PInvoke([string]$name, [type]$ret, [type[]]$paramTypes, [System.Runtime.InteropServices.CharSet]$cs) {
  $m = $tb.DefinePInvokeMethod(
    $name,
    'kernel32.dll',
    'Public,Static',
    [System.Reflection.CallingConventions]::Standard,
    $ret,
    $paramTypes,
    [System.Runtime.InteropServices.CallingConvention]::Winapi,
    $cs
  )
  $m.SetImplementationFlags([System.Reflection.MethodImplAttributes]::PreserveSig)
}

Add-Win32PInvoke 'CreateFileW' ([IntPtr]) @([string],[uint32],[uint32],[IntPtr],[uint32],[uint32],[IntPtr]) ([System.Runtime.InteropServices.CharSet]::Unicode)
Add-Win32PInvoke 'ReadFile' ([bool]) @([IntPtr],[IntPtr],[uint32],[uint32].MakeByRefType(),[IntPtr]) ([System.Runtime.InteropServices.CharSet]::Auto)
Add-Win32PInvoke 'CloseHandle' ([bool]) @([IntPtr]) ([System.Runtime.InteropServices.CharSet]::Auto)
Add-Win32PInvoke 'VirtualAlloc' ([IntPtr]) @([IntPtr],[UIntPtr],[uint32],[uint32]) ([System.Runtime.InteropServices.CharSet]::Auto)
Add-Win32PInvoke 'VirtualFree' ([bool]) @([IntPtr],[UIntPtr],[uint32]) ([System.Runtime.InteropServices.CharSet]::Auto)
Add-Win32PInvoke 'GetFileAttributesW' ([uint32]) @([string]) ([System.Runtime.InteropServices.CharSet]::Unicode)
Add-Win32PInvoke 'SetFileAttributesW' ([bool]) @([string],[uint32]) ([System.Runtime.InteropServices.CharSet]::Unicode)
$k32 = $tb.CreateType()

$GENERIC_READ = [uint32]2147483648
$FILE_SHARE_RW = [uint32]3
$OPEN_EXISTING = [uint32]3
$FILE_FLAG_NO_BUFFERING = [uint32]0x20000000
$INVALID_HANDLE = [IntPtr](-1)
$INVALID_ATTRS = [uint32]4294967295
$ATTR_MASK_CLEAR = [uint32]7   # READONLY (1) | HIDDEN (2) | SYSTEM (4)
$ATTR_NORMAL = [uint32]128

$cleared = 0
foreach ($attrPath in @($spec.clearAttrPaths)) {
  if (-not $attrPath) { continue }
  $a = $k32::GetFileAttributesW([string]$attrPath)
  if ($a -ne $INVALID_ATTRS) {
    $clean = $a -band (-bnot $ATTR_MASK_CLEAR)
    if ($clean -ne $a) {
      if ($clean -eq 0) { $clean = $ATTR_NORMAL }
      if ($k32::SetFileAttributesW([string]$attrPath, $clean)) { $cleared++ }
    }
  }
}

$bufSize = [uint32]65536
$mem = $k32::VirtualAlloc([IntPtr]::Zero, [UIntPtr]::new($bufSize), [uint32]0x3000, [uint32]0x04)
if ($mem -eq [IntPtr]::Zero) {
  throw 'VirtualAlloc falhou ao alocar buffer alinhado para verificacao fisica.'
}
$managed = New-Object byte[] $bufSize
$failures = @()
$checked = 0

try {
  foreach ($item in @($spec.files)) {
    $fp = [string]$item.fullPath
    $rel = [string]$item.relativePath
    $expectedSize = [int64]$item.sizeBytes
    $expectedHash = ([string]$item.sha256).ToLowerInvariant()

    if (-not (Test-Path -LiteralPath $fp -PathType Leaf)) {
      $failures += [pscustomobject]@{
        path = $rel
        reason = 'missing'
        expectedSize = $expectedSize
      }
      continue
    }

    $fi = New-Object System.IO.FileInfo($fp)
    if ($fi.Length -ne $expectedSize) {
      $failures += [pscustomobject]@{
        path = $rel
        reason = 'size-mismatch'
        expectedSize = $expectedSize
        actualSize = [int64]$fi.Length
      }
      continue
    }

    $h = $k32::CreateFileW($fp, $GENERIC_READ, $FILE_SHARE_RW, [IntPtr]::Zero, $OPEN_EXISTING, $FILE_FLAG_NO_BUFFERING, [IntPtr]::Zero)
    if ($h -eq $INVALID_HANDLE) {
      $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
      $failures += [pscustomobject]@{
        path = $rel
        reason = 'open-failed'
        win32Error = $err
      }
      continue
    }

    try {
      $sha = [System.Security.Cryptography.SHA256]::Create()
      try {
        $readTotal = [int64]0
        $ioErr = $false
        $lastErr = 0
        while ($true) {
          [uint32]$br = 0
          $ok = $k32::ReadFile($h, $mem, $bufSize, [ref]$br, [IntPtr]::Zero)
          if (-not $ok) {
            $ioErr = $true
            $lastErr = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
            break
          }
          if ($br -eq 0) { break }
          [System.Runtime.InteropServices.Marshal]::Copy($mem, $managed, 0, [int]$br)
          [void]$sha.TransformBlock($managed, 0, [int]$br, $null, 0)
          $readTotal += [int64]$br
        }
        if ($ioErr) {
          $failures += [pscustomobject]@{
            path = $rel
            reason = 'read-error'
            win32Error = $lastErr
          }
        } else {
          [void]$sha.TransformFinalBlock($managed, 0, 0)
          $actualHash = ([BitConverter]::ToString($sha.Hash) -replace '-', '').ToLowerInvariant()
          if ($readTotal -ne $expectedSize) {
            $failures += [pscustomobject]@{
              path = $rel
              reason = 'size-mismatch'
              expectedSize = $expectedSize
              actualSize = $readTotal
            }
          } elseif ($actualHash -ne $expectedHash) {
            $failures += [pscustomobject]@{
              path = $rel
              reason = 'hash-mismatch'
              expectedSha256 = $expectedHash
              actualSha256 = $actualHash
            }
          } else {
            $checked++
          }
        }
      } finally {
        $sha.Dispose()
      }
    } finally {
      [void]$k32::CloseHandle($h)
    }
  }
} finally {
  [void]$k32::VirtualFree($mem, [UIntPtr]::Zero, [uint32]0x8000)
}

[pscustomobject]@{
  ok = ($failures.Count -eq 0)
  checkedCount = $checked
  clearedAttributeCount = $cleared
  failures = $failures
} | ConvertTo-Json -Compress -Depth 4
`;
}

function runVerifierPowerShell(
  ps1Path: string,
  specPath: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      powerShellExe(),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps1Path,
        "-SpecPath",
        specPath,
      ],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Verificação física excedeu o prazo de ${VERIFIER_TIMEOUT_MS} ms.`));
    }, VERIFIER_TIMEOUT_MS);
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function verifyBufferedFallback(
  driveRoot: string,
  criticalFiles: readonly CriticalFileExpectation[],
  diagnosticError?: string,
): Promise<PhysicalReadbackResult> {
  const failures: PhysicalReadbackFileFailure[] = [];
  let checkedCount = 0;
  for (const file of criticalFiles) {
    const fullPath = path.join(driveRoot, ...file.relativePath.split("/"));
    try {
      const stat = await fs.promises.lstat(fullPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        failures.push({ path: file.relativePath, reason: "missing", expectedSize: file.sizeBytes });
        continue;
      }
      if (stat.size !== file.sizeBytes) {
        failures.push({
          path: file.relativePath,
          reason: "size-mismatch",
          expectedSize: file.sizeBytes,
          actualSize: stat.size,
        });
        continue;
      }
      const actualHash = await hashFileSha256(fullPath);
      if (actualHash !== file.sha256.toLowerCase()) {
        failures.push({
          path: file.relativePath,
          reason: "hash-mismatch",
          expectedSha256: file.sha256.toLowerCase(),
          actualSha256: actualHash,
        });
        continue;
      }
      checkedCount++;
    } catch (err: any) {
      failures.push({
        path: file.relativePath,
        reason: err?.code === "ENOENT" ? "missing" : "read-error",
      });
    }
  }
  return {
    ok: failures.length === 0,
    bypassedCache: false,
    checkedCount,
    clearedAttributeCount: 0,
    failures,
    ...(diagnosticError ? { diagnosticError } : {}),
  };
}

/**
 * Executa a normalização de atributos DOS e a releitura física sem cache (`FILE_FLAG_NO_BUFFERING`)
 * de todos os arquivos críticos de boot/exploit no dispositivo de destino.
 *
 * Se a execução do script PowerShell nativo falhar por restrição do ambiente (fora do Windows,
 * política local), cai para conferência normal e registra o diagnóstico no log — mas qualquer
 * divergência de bytes/tamanho ou ausência de arquivo SEMPRE retorna `ok: false`.
 */
export async function verifyCriticalFilesPhysicalReadback(
  driveRoot: string,
  criticalFiles: readonly CriticalFileExpectation[],
): Promise<PhysicalReadbackResult> {
  if (criticalFiles.length === 0) {
    return { ok: true, bypassedCache: false, checkedCount: 0, clearedAttributeCount: 0, failures: [] };
  }
  if (process.platform !== "win32") {
    return verifyBufferedFallback(driveRoot, criticalFiles);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "godsend-flash-verify-"));
  const ps1Path = path.join(tmpDir, "verify.ps1");
  const specPath = path.join(tmpDir, "spec.json");
  try {
    const root = path.resolve(driveRoot);
    const clearAttrPaths = collectCriticalAttributePaths(root, criticalFiles);
    const spec = {
      clearAttrPaths,
      files: criticalFiles.map((file) => ({
        relativePath: file.relativePath,
        fullPath: path.join(root, ...file.relativePath.split("/")),
        sizeBytes: file.sizeBytes,
        sha256: file.sha256.toLowerCase(),
      })),
    };
    fs.writeFileSync(ps1Path, "\uFEFF" + buildPhysicalFlashVerifyScript(), "utf8");
    fs.writeFileSync(specPath, JSON.stringify(spec), "utf8");

    const { code, stdout, stderr } = await runVerifierPowerShell(ps1Path, specPath);
    if (code !== 0 || !stdout.trim()) {
      const reason = (stderr || stdout || `exit ${code}`).trim();
      appendAppEvent("BADAVATAR", `verificacao fisica sem cache indisponivel (${reason}); usando conferencia padrao`);
      return verifyBufferedFallback(driveRoot, criticalFiles, reason);
    }

    const parsed = JSON.parse(stdout.trim());
    const failures: PhysicalReadbackFileFailure[] = Array.isArray(parsed.failures)
      ? parsed.failures
      : parsed.failures
        ? [parsed.failures]
        : [];
    return {
      ok: parsed.ok === true && failures.length === 0,
      bypassedCache: true,
      checkedCount: Number(parsed.checkedCount) || 0,
      clearedAttributeCount: Number(parsed.clearedAttributeCount) || 0,
      failures,
    };
  } catch (err: any) {
    const reason = err?.message || String(err);
    appendAppEvent("BADAVATAR", `verificacao fisica sem cache falhou (${reason}); usando conferencia padrao`);
    return verifyBufferedFallback(driveRoot, criticalFiles, reason);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Formata um resumo técnico das falhas encontradas na verificação física para log/telemetria e erro bruto.
 */
export function formatPhysicalReadbackFailureSummary(
  failures: readonly PhysicalReadbackFileFailure[],
): string {
  return failures
    .slice(0, 5)
    .map((f) => {
      if (f.reason === "hash-mismatch") return `${f.path} (hash físico divergente)`;
      if (f.reason === "size-mismatch") {
        return `${f.path} (tamanho físico ${f.actualSize} != ${f.expectedSize})`;
      }
      if (f.reason === "missing") return `${f.path} (ausente)`;
      if (f.reason === "open-failed") return `${f.path} (abertura física falhou, Win32=${f.win32Error ?? "?"})`;
      return `${f.path} (erro de leitura física, Win32=${f.win32Error ?? "?"})`;
    })
    .join("; ");
}
