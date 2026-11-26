import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { powerShellExe } from "./windowsSystemExecutables";
import {
  XENIA_CONTENT_DIR,
  XENIA_GAMES_DIR,
  XENIA_MARKER_DIRECTORY,
  type XeniaAclVerificationReceipt,
} from "./xeniaPreparationReceipt";

export const SID_ALL_APPLICATION_PACKAGES = "S-1-15-2-1";
export const SID_ALL_RESTRICTED_APPLICATION_PACKAGES = "S-1-15-2-2";
export const SID_EVERYONE = "S-1-1-0";

export interface NtfsAclPathAudit {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  inheritanceProtected: boolean;
  hasAllAppPackages: boolean;
  hasRestrictedPackages: boolean;
  hasEveryone: boolean;
  hasDenyRule: boolean;
  error?: string;
}

export interface XeniaAclVerificationResult extends XeniaAclVerificationReceipt {
  audits: NtfsAclPathAudit[];
  reasons: string[];
}

function normalizeDriveRoot(driveRoot: string): string {
  const root = String(driveRoot || "").trim();
  if (!root) return "";
  if (process.platform === "win32") return root.endsWith("\\") ? root : `${root}\\`;
  return root.endsWith("/") ? root : `${root}/`;
}

function escapePsSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Monta o script PowerShell (sem Add-Type / sem csc.exe) que inspeciona as ACLs reais via
 * `[System.IO.Directory]::GetAccessControl` / `[System.IO.File]::GetAccessControl` e traduz
 * cada IdentityReference para SID (`SecurityIdentifier`), garantindo funcionamento idêntico
 * em qualquer idioma do Windows (PT-BR, EN, ES etc.).
 */
export function buildNtfsAclAuditScript(pathsToCheck: readonly string[]): string {
  const psPaths = pathsToCheck.map((p) => `'${escapePsSingleQuoted(p)}'`).join(", ");
  return String.raw`$ErrorActionPreference = 'Stop'
$targets = @(${psPaths})
$fullMask = [System.Security.AccessControl.FileSystemRights]::FullControl
$needInherit = [System.Security.AccessControl.InheritanceFlags]([int][System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [int][System.Security.AccessControl.InheritanceFlags]::ObjectInherit)
$results = @()

foreach ($t in $targets) {
  $row = [ordered]@{
    path = $t
    exists = $false
    isDirectory = $false
    inheritanceProtected = $false
    hasAllAppPackages = $false
    hasRestrictedPackages = $false
    hasEveryone = $false
    hasDenyRule = $false
    error = ''
  }
  try {
    if (-not (Test-Path -LiteralPath $t)) {
      $results += [PSCustomObject]$row
      continue
    }
    $item = Get-Item -LiteralPath $t -Force
    $row.exists = $true
    $row.isDirectory = [bool]$item.PSIsContainer
    $acl = if ($item.PSIsContainer) {
      [System.IO.Directory]::GetAccessControl($t)
    } else {
      [System.IO.File]::GetAccessControl($t)
    }
    $row.inheritanceProtected = [bool]$acl.AreAccessRulesProtected
    $rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules) {
      $sid = [string]$rule.IdentityReference.Value
      $isAllow = ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow)
      $isDeny = ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny)
      if ($isDeny -and ($sid -eq '${SID_ALL_APPLICATION_PACKAGES}' -or $sid -eq '${SID_ALL_RESTRICTED_APPLICATION_PACKAGES}' -or $sid -eq '${SID_EVERYONE}')) {
        $row.hasDenyRule = $true
        continue
      }
      if (-not $isAllow) { continue }
      $hasFull = (([int]$rule.FileSystemRights -band [int]$fullMask) -eq [int]$fullMask)
      if (-not $hasFull) { continue }
      # Para diretórios exigimos herança OI+CI (exceto regras herdadas em arquivos).
      if ($item.PSIsContainer) {
        $inheritOk = (([int]$rule.InheritanceFlags -band [int]$needInherit) -eq [int]$needInherit)
        if (-not $inheritOk) { continue }
      }
      if ($sid -eq '${SID_ALL_APPLICATION_PACKAGES}') { $row.hasAllAppPackages = $true }
      elseif ($sid -eq '${SID_ALL_RESTRICTED_APPLICATION_PACKAGES}') { $row.hasRestrictedPackages = $true }
      elseif ($sid -eq '${SID_EVERYONE}') { $row.hasEveryone = $true }
    }
  } catch {
    $row.error = [string]$_.Exception.Message
  }
  $results += [PSCustomObject]$row
}

ConvertTo-Json -InputObject @($results) -Compress -Depth 4`;
}

export function parseNtfsAclAuditJson(stdout: string): NtfsAclPathAudit[] {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((r: any) => ({
      path: String(r?.path || ""),
      exists: Boolean(r?.exists),
      isDirectory: Boolean(r?.isDirectory),
      inheritanceProtected: Boolean(r?.inheritanceProtected),
      hasAllAppPackages: Boolean(r?.hasAllAppPackages),
      hasRestrictedPackages: Boolean(r?.hasRestrictedPackages),
      hasEveryone: Boolean(r?.hasEveryone),
      hasDenyRule: Boolean(r?.hasDenyRule),
      ...(r?.error ? { error: String(r.error) } : {}),
    }));
  } catch {
    return [];
  }
}

function runPowerShell(script: string, timeoutMs = 10_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      powerShellExe(),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      resolve({ code: -1, stdout, stderr: "timeout" });
    }, timeoutMs);
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

export function evaluateNtfsAclAudits(
  audits: readonly NtfsAclPathAudit[],
  probePath?: string,
): XeniaAclVerificationResult {
  const reasons: string[] = [];
  if (audits.length === 0) {
    return {
      verified: false,
      allApplicationPackagesPresent: false,
      restrictedPackagesPresent: false,
      everyonePresent: false,
      hasDenyRule: false,
      inheritanceActive: false,
      probeInherited: false,
      audits: [],
      reasons: ["Não foi possível ler as permissões NTFS do dispositivo."],
    };
  }

  const rootAudit = audits[0];
  const probeAudit = probePath
    ? audits.find((a) => a.path.toLowerCase() === probePath.toLowerCase())
    : undefined;
  const dirAudits = audits.filter((a) => a !== probeAudit);

  const allDirsExist = dirAudits.every((a) => a.exists && !a.error);
  const allAppOk = dirAudits.every((a) => a.exists && a.hasAllAppPackages && !a.hasDenyRule);
  const restrictedOk = dirAudits.every((a) => a.exists && a.hasRestrictedPackages);
  const everyoneOk = dirAudits.every((a) => a.exists && a.hasEveryone);
  const hasDenyRule = audits.some((a) => a.hasDenyRule);
  // Na raiz do volume, AreAccessRulesProtected pode ser true/false dependendo do Windows;
  // nas subpastas (Games, Content, .xbox-downloader) a herança precisa estar ativa.
  const subDirAudits = dirAudits.slice(1);
  const inheritanceActive = subDirAudits.every((a) => a.exists && !a.inheritanceProtected);
  const probeInherited = probeAudit
    ? Boolean(probeAudit.exists && probeAudit.hasAllAppPackages && !probeAudit.hasDenyRule && !probeAudit.error)
    : true;

  if (!allDirsExist) {
    const missing = dirAudits.filter((a) => !a.exists || a.error).map((a) => a.path);
    reasons.push(`Pastas obrigatórias ausentes ou inacessíveis: ${missing.join(", ")}`);
  }
  if (!rootAudit?.hasAllAppPackages) {
    reasons.push("A raiz do dispositivo não recebeu permissão Controle Total para ALL APPLICATION PACKAGES (S-1-15-2-1).");
  } else if (!allAppOk) {
    reasons.push("Uma ou mais pastas do Xenia (Games/Content) não possuem permissão Controle Total herdável para ALL APPLICATION PACKAGES (S-1-15-2-1).");
  }
  if (hasDenyRule) {
    reasons.push("Existe uma regra de negação (Deny) bloqueando o acesso do Xbox nas permissões NTFS do dispositivo.");
  }
  if (!inheritanceActive) {
    reasons.push("A herança de permissões está bloqueada em uma ou mais pastas do Xenia.");
  }
  if (probeAudit && !probeInherited) {
    reasons.push("Um arquivo de teste criado dentro da pasta Games não herdou automaticamente a permissão do Xbox (S-1-15-2-1).");
  }

  const verified = allDirsExist && allAppOk && !hasDenyRule && inheritanceActive && probeInherited;
  return {
    verified,
    allApplicationPackagesPresent: allAppOk,
    restrictedPackagesPresent: restrictedOk,
    everyonePresent: everyoneOk,
    hasDenyRule,
    inheritanceActive,
    probeInherited,
    audits: [...audits],
    reasons,
  };
}

/**
 * Verificação rápida de ACL usada na detecção de dispositivos NTFS com marcador Xenia
 * (sem criar arquivos no disco). Só deve rodar na mudança de volume ou `fresh: true` — nunca
 * em polling repetitivo sem mudança de assinatura.
 */
export async function quickCheckXeniaDriveAcl(driveRoot: string): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const root = normalizeDriveRoot(driveRoot);
  if (!root) return false;
  const targets = [
    root,
    path.join(root, XENIA_GAMES_DIR),
    path.join(root, ...XENIA_CONTENT_DIR.split("/")),
  ];
  try {
    const res = await runPowerShell(buildNtfsAclAuditScript(targets), 8_000);
    if (res.code !== 0) return false;
    const audits = parseNtfsAclAuditJson(res.stdout);
    return evaluateNtfsAclAudits(audits).verified;
  } catch {
    return false;
  }
}

/**
 * Verificação completa pós-preparo (portão obrigatório antes de declarar "Pronto!"):
 * 1. Cria um arquivo temporário real dentro de `Games/`, grava bytes e faz flush (`sync()`).
 * 2. Audita as ACLs reais de `X:\`, `X:\Games`, `X:\Content\0000000000000000`, `X:\.xbox-downloader`
 *    e do arquivo temporário recém-criado (provando que arquivos futuros e arquivos movidos de
 *    `.xbox-downloader/copy-staging` herdam `S-1-15-2-1` FullControl).
 * 3. Remove o arquivo temporário.
 */
export async function verifyXboxOneSeriesAclAndProbe(
  driveRoot: string,
): Promise<XeniaAclVerificationResult> {
  const root = normalizeDriveRoot(driveRoot);
  if (process.platform !== "win32" || !root) {
    return {
      verified: false,
      allApplicationPackagesPresent: false,
      restrictedPackagesPresent: false,
      everyonePresent: false,
      hasDenyRule: false,
      inheritanceActive: false,
      probeInherited: false,
      audits: [],
      reasons: ["A verificação de permissões NTFS do Xbox One / Series está disponível apenas no Windows."],
    };
  }

  const gamesDir = path.join(root, XENIA_GAMES_DIR);
  const contentDir = path.join(root, ...XENIA_CONTENT_DIR.split("/"));
  const metaDir = path.join(root, XENIA_MARKER_DIRECTORY);
  const probeFile = path.join(gamesDir, `.xbox-companion-acl-probe-${Date.now()}.tmp`);

  try {
    const handle = await fs.open(probeFile, "w");
    try {
      await handle.writeFile("xbox-one-series-acl-probe\r\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    const targets = [root, gamesDir, contentDir, metaDir, probeFile];
    const res = await runPowerShell(buildNtfsAclAuditScript(targets), 12_000);
    if (res.code !== 0) {
      return {
        verified: false,
        allApplicationPackagesPresent: false,
        restrictedPackagesPresent: false,
        everyonePresent: false,
        hasDenyRule: false,
        inheritanceActive: false,
        probeInherited: false,
        audits: [],
        reasons: [res.stderr.trim() || "Falha ao ler as permissões NTFS após a preparação."],
      };
    }

    const audits = parseNtfsAclAuditJson(res.stdout);
    return evaluateNtfsAclAudits(audits, probeFile);
  } catch (error: any) {
    return {
      verified: false,
      allApplicationPackagesPresent: false,
      restrictedPackagesPresent: false,
      everyonePresent: false,
      hasDenyRule: false,
      inheritanceActive: false,
      probeInherited: false,
      audits: [],
      reasons: [`Não foi possível gravar o arquivo de teste na pasta Games: ${error?.message || String(error)}`],
    };
  } finally {
    try { await fs.unlink(probeFile); } catch { /* best-effort cleanup */ }
  }
}
