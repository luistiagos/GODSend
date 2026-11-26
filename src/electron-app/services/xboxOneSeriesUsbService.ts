import { app } from "electron";
import { spawn } from "child_process";
import fs from "fs";
import {
  executeWindowsNtfsXeniaSetup,
  type NtfsXeniaTarget,
} from "../infrastructure/ntfsXboxFormat";
import {
  verifyXboxOneSeriesAclAndProbe,
  type XeniaAclVerificationResult,
} from "../infrastructure/ntfsAclVerifier";
import {
  assessXboxOneSeriesLayout,
} from "../infrastructure/xboxOneSeriesDiskLayoutPolicy";
import {
  buildXeniaPreparationReceipt,
  writeXeniaMarkerAndReceipt,
  type XeniaDiskLayoutReceipt,
  type XeniaPreparationReceipt,
} from "../infrastructure/xeniaPreparationReceipt";
import {
  readWindowsUsbDiskLayout,
  requireSafeWindowsUsbTarget,
} from "../infrastructure/windowsUsbDeviceService";
import { powerShellExe } from "../infrastructure/windowsSystemExecutables";
import { appendAppEvent } from "../infrastructure/serverLog";
import {
  invalidateUsbDriveListCache,
  listFat32UsbDrives,
  type UsbDriveInfo,
} from "./badAvatarUsbService";

export interface UnassignedXboxUsbDisk {
  diskNumber: number;
  friendlyName: string;
  manufacturer: string;
  sizeBytes: number;
  partitionStyle: string;
  diskUniqueId: string;
  serialNumber: string;
  operationalStatus: string;
  isOffline: boolean;
  isReadOnly: boolean;
}

export interface XboxOneSeriesPrepareRequest {
  targetKind?: "volume" | "unassigned-disk";
  /** Obrigatório quando targetKind === "volume" (padrão). */
  driveRoot?: string;
  expectedDeviceFingerprint?: string;
  /** Obrigatório quando targetKind === "unassigned-disk" (HD formatado pelo Xbox / sem letra). */
  diskNumber?: number;
  expectedDiskBytes?: number;
  expectedDiskUniqueId?: string;
  expectedSerialNumber?: string;
  /** Quando true, formata em NTFS (MBR <= 2 TiB / GPT > 2 TiB). Quando false, preserva arquivos e reaplica ACLs. */
  formatDrive: boolean;
  label?: string;
}

export interface XboxOneSeriesPrepareProgress {
  status: string;
  percent: number;
  detail?: string;
}

export type XboxOneSeriesProgressCallback = (progress: XboxOneSeriesPrepareProgress) => void;

export interface XboxOneSeriesPrepareResult {
  driveRoot: string;
  formatted: boolean;
  partitionStyle: string;
  partitionBytes?: number;
  aclVerification: XeniaAclVerificationResult;
  receipt: XeniaPreparationReceipt;
}

function appVersion(): string {
  try {
    return app?.getVersion?.() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function runPowerShell(script: string, timeoutMs = 12_000): Promise<{ code: number; stdout: string; stderr: string }> {
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

/**
 * Descobre discos USB externos conectados que NÃO têm nenhuma partição montada com letra no Windows
 * — caso típico de HDs que o cliente plugou no Xbox One/Series e clicou em "Formatar para Jogos e
 * Aplicativos" (formato proprietário XboxFS) ou discos novos/RAW não inicializados.
 *
 * Nunca chamada no polling automático de 5 s da Home: usada apenas sob demanda na tela de preparo
 * do Xbox One / Series.
 */
export async function listUnassignedXboxUsbDisks(): Promise<UnassignedXboxUsbDisk[]> {
  if (process.platform !== "win32") return [];
  const script = String.raw`$ErrorActionPreference = 'SilentlyContinue'
$rows = @()
$disks = @(Get-Disk | Where-Object {
  $_.BusType -eq 'USB' -and $_.Number -ne 0 -and -not $_.IsBoot -and -not $_.IsSystem -and $_.Size -ge 1073741824
})
foreach ($d in $disks) {
  $parts = @(Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue)
  $mounted = @($parts | Where-Object { $_.DriveLetter })
  if ($mounted.Count -gt 0) { continue }
  $rows += [PSCustomObject]@{
    diskNumber = [int]$d.Number
    friendlyName = [string]$d.FriendlyName
    manufacturer = [string]$d.Manufacturer
    sizeBytes = [int64]$d.Size
    partitionStyle = [string]$d.PartitionStyle
    diskUniqueId = [string]$d.UniqueId
    serialNumber = [string]$d.SerialNumber
    operationalStatus = [string]$d.OperationalStatus
    isOffline = [bool]$d.IsOffline
    isReadOnly = [bool]$d.IsReadOnly
  }
}
ConvertTo-Json -InputObject @($rows) -Compress -Depth 3`;

  try {
    const res = await runPowerShell(script, 12_000);
    if (res.code !== 0 || !res.stdout.trim()) return [];
    const parsed = JSON.parse(res.stdout.trim());
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter((item) => item && Number.isInteger(Number(item.diskNumber)) && Number(item.diskNumber) > 0)
      .filter((item) => Boolean(String(item.diskUniqueId || "").trim() || String(item.serialNumber || "").trim()))
      .map((item) => ({
        diskNumber: Number(item.diskNumber),
        friendlyName: String(item.friendlyName || "HD/Pendrive USB sem letra").trim(),
        manufacturer: String(item.manufacturer || "").trim(),
        sizeBytes: Number(item.sizeBytes) || 0,
        partitionStyle: String(item.partitionStyle || "RAW").trim(),
        diskUniqueId: String(item.diskUniqueId || "").trim(),
        serialNumber: String(item.serialNumber || "").trim(),
        operationalStatus: String(item.operationalStatus || "").trim(),
        isOffline: Boolean(item.isOffline),
        isReadOnly: Boolean(item.isReadOnly),
      }));
  } catch (err: any) {
    appendAppEvent("xenia-usb", `falha ao listar discos USB sem letra: ${err?.message || String(err)}`);
    return [];
  }
}

export async function listXboxOneSeriesDevices(fresh = false): Promise<{
  drives: UsbDriveInfo[];
  unassignedDisks: UnassignedXboxUsbDisk[];
}> {
  const [drives, unassignedDisks] = await Promise.all([
    listFat32UsbDrives(fresh),
    listUnassignedXboxUsbDisks(),
  ]);
  return { drives, unassignedDisks };
}

async function waitForDriveAccessible(driveRoot: string, timeoutMs = 12_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.promises.access(driveRoot, fs.constants.R_OK | fs.constants.W_OK);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  throw new Error(`O Windows ainda não liberou o acesso à unidade ${driveRoot}. Reconecte o dispositivo e tente novamente.`);
}

/**
 * Orquestrador completo da preparação de pendrive/HD para Xbox One e Xbox Series X|S (Xenia).
 *
 * Fluxo:
 * 1. Valida segurança do dispositivo USB selecionado.
 * 2. Executa script elevado (UAC): formata em NTFS (MBR <= 2 TiB / GPT > 2 TiB) se solicitado,
 *    cria `Games/` e `Content/0000000000000000/`, e aplica permissões NTFS via SIDs universais.
 * 3. Aguarda o volume acessível e valida layout físico (`assessXboxOneSeriesLayout`).
 * 4. Executa verificação REAL de ACL + teste de arquivo probe (`verifyXboxOneSeriesAclAndProbe`).
 * 5. Somente se todas as verificações passarem, grava `.xbox-downloader/xenia-devmode-v1.marker`
 *    e `.xbox-downloader/preparo-xenia.json`, e invalida o cache de drives USB.
 */
export async function prepareXboxOneSeriesDevice(
  request: XboxOneSeriesPrepareRequest,
  onProgress: XboxOneSeriesProgressCallback = () => {},
): Promise<XboxOneSeriesPrepareResult> {
  if (process.platform !== "win32") {
    throw new Error("A preparação para Xbox One / Series está disponível somente no Windows.");
  }

  const targetKind = request.targetKind === "unassigned-disk" ? "unassigned-disk" : "volume";
  const formatDrive = targetKind === "unassigned-disk" ? true : request.formatDrive === true;
  let target: NtfsXeniaTarget;
  let deviceModel = "";
  let deviceManufacturer = "";

  onProgress({ status: "Validando dispositivo USB selecionado…", percent: 10 });

  if (targetKind === "volume") {
    const driveRoot = String(request.driveRoot || "").trim();
    const expectedFingerprint = String(request.expectedDeviceFingerprint || "").trim();
    if (!driveRoot || !expectedFingerprint) {
      throw new Error("Atualize a lista e selecione novamente o pendrive ou HD USB.");
    }
    const safeDevice = await requireSafeWindowsUsbTarget(driveRoot, expectedFingerprint);
    if (!safeDevice.volumeGuid) {
      throw new Error("A identidade estável do volume não está disponível. Atualize a lista e tente novamente.");
    }
    const letterMatch = safeDevice.rootPath.match(/^([A-Za-z]):/);
    if (!letterMatch) {
      throw new Error(`Unidade inválida: ${safeDevice.rootPath}`);
    }
    deviceModel = safeDevice.friendlyName || safeDevice.label || "";
    deviceManufacturer = safeDevice.manufacturer || "";

    target = {
      kind: "volume",
      driveLetter: letterMatch[1].toUpperCase(),
      guard: {
        expectedVolumeGuid: safeDevice.volumeGuid,
        expectedVolumeBytes: safeDevice.partitionSizeBytes || safeDevice.sizeBytes,
      },
    };
  } else {
    const disks = await listUnassignedXboxUsbDisks();
    const match = disks.find((d) => d.diskNumber === Number(request.diskNumber));
    if (!match) {
      throw new Error("O HD/pendrive sem letra selecionado não foi encontrado. Clique em Atualizar e selecione novamente.");
    }
    if (
      (request.expectedDiskUniqueId && match.diskUniqueId.toLowerCase() !== request.expectedDiskUniqueId.toLowerCase()) ||
      (request.expectedSerialNumber && match.serialNumber.toLowerCase() !== request.expectedSerialNumber.toLowerCase())
    ) {
      throw new Error("O disco USB sem letra mudou desde a seleção. Clique em Atualizar e tente novamente.");
    }
    deviceModel = match.friendlyName;
    deviceManufacturer = match.manufacturer;
    target = {
      kind: "unassigned-disk",
      guard: {
        diskNumber: match.diskNumber,
        expectedDiskBytes: match.sizeBytes,
        expectedDiskUniqueId: match.diskUniqueId,
        expectedSerialNumber: match.serialNumber,
      },
    };
  }

  onProgress({
    status: formatDrive
      ? "Formatando em NTFS e aplicando permissões do Xbox (aceite a permissão do Windows)…"
      : "Aplicando permissões do Xbox Modo Desenvolvedor (aceite a permissão do Windows)…",
    percent: 30,
  });

  const execResult = await executeWindowsNtfsXeniaSetup({
    target,
    formatDrive,
    label: request.label || "XENIA_USB",
  });

  appendAppEvent(
    "xenia-usb",
    `script elevado concluido em ${execResult.driveRoot} (format=${formatDrive}, estilo=${execResult.partitionStyle || "?"}, bytes=${execResult.partitionBytes || 0})`,
  );

  onProgress({ status: "Aguardando o Windows liberar o dispositivo…", percent: 65 });
  await waitForDriveAccessible(execResult.driveRoot);

  onProgress({ status: "Conferindo formato NTFS e partição do disco…", percent: 75 });
  const physicalLayout = await readWindowsUsbDiskLayout(execResult.driveRoot).catch(() => null);
  let layoutReceipt: XeniaDiskLayoutReceipt | undefined;
  if (physicalLayout) {
    const assessment = assessXboxOneSeriesLayout({
      partitionStyle: physicalLayout.partitionStyle,
      partitionCount: physicalLayout.partitionCount,
      partitionOffsetBytes: physicalLayout.partitionOffsetBytes,
      logicalSectorSize: physicalLayout.logicalSectorSize,
      fileSystem: physicalLayout.fileSystem,
      diskSizeBytes: physicalLayout.sizeBytes,
      partitionSizeBytes: physicalLayout.partitionSizeBytes || physicalLayout.sizeBytes,
    });
    if (assessment.verdict === "rejected") {
      const detail = assessment.reasons.join(" ");
      appendAppEvent("xenia-usb", `layout reprovado apos preparo em ${execResult.driveRoot}: ${detail}`);
      throw new Error(
        `O dispositivo não ficou no formato NTFS esperado para o Xbox One / Series: ${detail}`,
      );
    }
    layoutReceipt = {
      verdict: assessment.verdict === "ok" ? "ok" : "unknown",
      formatted: formatDrive,
      partitionStyle: physicalLayout.partitionStyle || execResult.partitionStyle || "",
      partitionCount: physicalLayout.partitionCount,
      logicalSectorSize: physicalLayout.logicalSectorSize,
      physicalSectorSize: physicalLayout.physicalSectorSize,
      fileSystem: physicalLayout.fileSystem || "NTFS",
      partitionSizeBytes: physicalLayout.partitionSizeBytes || execResult.partitionBytes || 0,
      allocationUnitBytes: physicalLayout.allocationUnitBytes || 0,
      model: physicalLayout.friendlyName || deviceModel,
      manufacturer: physicalLayout.manufacturer || deviceManufacturer,
    };
  }

  onProgress({
    status: "Testando permissões do Xbox (ALL APPLICATION PACKAGES) e herança na pasta Games…",
    percent: 88,
  });

  const aclVerification = await verifyXboxOneSeriesAclAndProbe(execResult.driveRoot);
  if (!aclVerification.verified) {
    const reason = aclVerification.reasons.join(" ");
    appendAppEvent("xenia-usb", `verificacao de ACL reprovada em ${execResult.driveRoot}: ${reason}`);
    throw new Error(
      `As permissões do Xbox Modo Desenvolvedor não puderam ser confirmadas no dispositivo. ${reason}`,
    );
  }

  onProgress({ status: "Gravando confirmação do preparo no dispositivo…", percent: 95 });
  const receipt = buildXeniaPreparationReceipt({
    appVersion: appVersion(),
    formatted: formatDrive,
    aclVerification: {
      verified: aclVerification.verified,
      allApplicationPackagesPresent: aclVerification.allApplicationPackagesPresent,
      restrictedPackagesPresent: aclVerification.restrictedPackagesPresent,
      everyonePresent: aclVerification.everyonePresent,
      hasDenyRule: aclVerification.hasDenyRule,
      inheritanceActive: aclVerification.inheritanceActive,
      probeInherited: aclVerification.probeInherited,
    },
    diskLayout: layoutReceipt,
  });

  await writeXeniaMarkerAndReceipt(execResult.driveRoot, receipt);
  invalidateUsbDriveListCache();

  onProgress({
    status: "Pronto! Pendrive/HD preparado para Xbox One / Series (Xenia).",
    percent: 100,
  });

  return {
    driveRoot: execResult.driveRoot,
    formatted: formatDrive,
    partitionStyle: layoutReceipt?.partitionStyle || execResult.partitionStyle || "MBR",
    partitionBytes: layoutReceipt?.partitionSizeBytes || execResult.partitionBytes,
    aclVerification,
    receipt,
  };
}
