/**
 * usbUserContentBackup.ts — Salvaguarda e restauração preventiva de perfis pessoais e saves de jogos no pendrive.
 *
 * Quando um jogo trava fatalmente no console Xbox 360 durante a execução do BadAvatar, a tabela de
 * alocação de arquivos (FAT32) pode ficar suja ou com entradas corrompidas. Ao repreparar o pendrive,
 * se o usuário optar por "Formatar antes" ou executar o reparo com CHKDSK /F, arquivos pessoais
 * (perfis do jogador sob Content/<XUID>/FFFE07D1/00010000 e saves de jogos sob Content/.../00000001)
 * correm risco de serem apagados ou truncados.
 *
 * Este serviço realiza:
 * 1. Descoberta e backup atômico best-effort de todos os perfis pessoais e saves legíveis antes de qualquer
 *    formatação ou reparo destrutivo, validando cabeçalhos STFS (CON / LIVE / PIRS) para não salvar lixo.
 * 2. Restauração automática dos perfis e saves preservados de volta à unidade após o término da gravação
 *    transacional do BadAvatar.
 */

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { extractDriveLetter } from "../services/driveRepairService";
import { getEffectiveSaveBackupFolder } from "../services/settingsService";
import { isExploitProfilePath, SHARED_CONSOLE_CONTENT_PROFILE_ID } from "./exploitProfile";

export interface DiscoveredUserFile {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  isProfile: boolean;
  isSave: boolean;
}

export interface BackupOptions {
  backupBaseDir?: string;
  exploitFiles?: readonly { path: string }[];
  onProgress?: (status: string) => void;
}

export interface BackupResult {
  backupDir: string;
  totalFiles: number;
  totalBytes: number;
  files: string[];
  skippedUnreadable: string[];
}

export interface RestoreResult {
  restoredFiles: number;
  totalBytes: number;
  restored: string[];
  errors: string[];
}

export interface RecoveryManifest {
  version: 1;
  timestamp: string;
  driveRoot: string;
  files: Array<{
    relativePath: string;
    sizeBytes: number;
    isProfile: boolean;
    isSave: boolean;
  }>;
}

/**
 * Valida se um arquivo no disco é um contêiner STFS íntegro (CON , LIVE ou PIRS) com tamanho
 * mínimo válido (cabeçalho de metadados STFS tem pelo menos 0x370 bytes).
 */
export async function isValidStfsFile(filePath: string): Promise<boolean> {
  let handle: fsPromises.FileHandle | null = null;
  try {
    const stat = await fsPromises.stat(filePath);
    if (!stat.isFile() || stat.size < 0x370) {
      return false;
    }
    handle = await fsPromises.open(filePath, "r");
    const buffer = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buffer, 0, 4, 0);
    if (bytesRead < 4) return false;
    const magic = buffer.toString("utf8");
    return magic === "CON " || magic === "LIVE" || magic === "PIRS";
  } catch {
    return false;
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
  }
}

/**
 * Normaliza um caminho para usar barras normais "/" e sem barra inicial.
 */
function normalizeRelative(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Varre a unidade em busca de perfis pessoais e saves de jogos no pendrive.
 */
export async function discoverUserProfilesAndSaves(
  driveRoot: string,
  exploitFiles?: readonly { path: string }[],
): Promise<{ validFiles: DiscoveredUserFile[]; skippedUnreadable: string[] }> {
  const validFiles: DiscoveredUserFile[] = [];
  const skippedUnreadable: string[] = [];

  let resolvedExploitFiles = exploitFiles;
  if (!resolvedExploitFiles) {
    try {
      // Carrega o perfil do exploit a partir do manifesto ativo (sem constante fixa de XUID).
      const { exploitProfileFiles } = require("../services/fixedBadAvatarPreparationService") as typeof import("../services/fixedBadAvatarPreparationService");
      resolvedExploitFiles = exploitProfileFiles();
    } catch {
      resolvedExploitFiles = [];
    }
  }

  const contentDir = path.join(driveRoot, "Content");
  try {
    const contentStat = await fsPromises.stat(contentDir);
    if (!contentStat.isDirectory()) {
      return { validFiles, skippedUnreadable };
    }
  } catch {
    return { validFiles, skippedUnreadable };
  }

  // Identifica os XUIDs que pertencem ao exploit BadAvatar a partir dos arquivos do pacote.
  const exploitPaths = new Set(resolvedExploitFiles.map((f) => normalizeRelative(f.path).toLowerCase()));
  const exploitXuids = new Set<string>();
  for (const f of resolvedExploitFiles) {
    const segs = normalizeRelative(f.path).split("/");
    if (segs.length >= 2 && segs[0].toLowerCase() === "content" && segs[1] !== SHARED_CONSOLE_CONTENT_PROFILE_ID) {
      exploitXuids.add(segs[1].toUpperCase());
    }
  }

  let topEntries: fs.Dirent[] = [];
  try {
    topEntries = await fsPromises.readdir(contentDir, { withFileTypes: true });
  } catch (err: any) {
    skippedUnreadable.push(`Content: ${err?.message || String(err)}`);
    return { validFiles, skippedUnreadable };
  }

  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue;
    const folderName = entry.name;
    const isShared = folderName === SHARED_CONSOLE_CONTENT_PROFILE_ID;
    const isHex16 = /^[0-9A-Fa-f]{16}$/.test(folderName);

    if (isShared) {
      // Content/0000000000000000/<TitleID>/00000001/* (saves compartilhados apenas, ignorando GOD/DLC/TU)
      const sharedDir = path.join(contentDir, folderName);
      try {
        const titleEntries = await fsPromises.readdir(sharedDir, { withFileTypes: true });
        for (const titleEntry of titleEntries) {
          if (!titleEntry.isDirectory()) continue;
          const savesDir = path.join(sharedDir, titleEntry.name, "00000001");
          try {
            const saveFiles = await fsPromises.readdir(savesDir, { withFileTypes: true });
            for (const file of saveFiles) {
              if (!file.isFile()) continue;
              const absPath = path.join(savesDir, file.name);
              const relPath = normalizeRelative(path.relative(driveRoot, absPath));
              const valid = await isValidStfsFile(absPath);
              if (valid) {
                const stat = await fsPromises.stat(absPath);
                validFiles.push({
                  relativePath: relPath,
                  absolutePath: absPath,
                  sizeBytes: stat.size,
                  isProfile: false,
                  isSave: true,
                });
              } else {
                skippedUnreadable.push(relPath);
              }
            }
          } catch {
            // Se a pasta 00000001 não existe para esse TitleID, ignora silenciosamente.
          }
        }
      } catch (err: any) {
        skippedUnreadable.push(`Content/${folderName}: ${err?.message || String(err)}`);
      }
      continue;
    }

    if (!isHex16) continue;

    // Se é o perfil do exploit BadAvatar, ignora (será reescrito pelo pacote do BadAvatar).
    if (exploitXuids.has(folderName.toUpperCase())) {
      continue;
    }

    // Perfil pessoal do jogador! Varre toda a subárvore Content/<ProfileID>/...
    const profileRootDir = path.join(contentDir, folderName);
    async function walkProfileDir(currentDir: string): Promise<void> {
      let subEntries: fs.Dirent[] = [];
      try {
        subEntries = await fsPromises.readdir(currentDir, { withFileTypes: true });
      } catch (err: any) {
        skippedUnreadable.push(`${normalizeRelative(path.relative(driveRoot, currentDir))}: ${err?.message || String(err)}`);
        return;
      }
      for (const item of subEntries) {
        const absPath = path.join(currentDir, item.name);
        const relPath = normalizeRelative(path.relative(driveRoot, absPath));

        if (item.isDirectory()) {
          // Ignora subpastas de DLC/GOD caso existam acidentalmente dentro do perfil
          if (item.name === "00000002" || item.name === "00007000") continue;
          await walkProfileDir(absPath);
        } else if (item.isFile()) {
          if (exploitPaths.has(relPath.toLowerCase())) continue;
          const isProfilePackage = relPath.includes("/00010000/");
          const isSave = relPath.includes("/00000001/");

          const valid = await isValidStfsFile(absPath);
          if (valid) {
            const stat = await fsPromises.stat(absPath);
            validFiles.push({
              relativePath: relPath,
              absolutePath: absPath,
              sizeBytes: stat.size,
              isProfile: isProfilePackage,
              isSave: isSave || !isProfilePackage,
            });
          } else {
            skippedUnreadable.push(relPath);
          }
        }
      }
    }

    await walkProfileDir(profileRootDir);
  }

  return { validFiles, skippedUnreadable };
}

/**
 * Salva uma cópia de segurança preventiva dos perfis e saves pessoais encontrados na unidade.
 */
export async function backupUsbUserProfilesAndSaves(
  driveRoot: string,
  options: BackupOptions = {},
): Promise<BackupResult> {
  const { validFiles, skippedUnreadable } = await discoverUserProfilesAndSaves(
    driveRoot,
    options.exploitFiles,
  );

  const driveLetter = extractDriveLetter(driveRoot);
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const baseDir = options.backupBaseDir || getEffectiveSaveBackupFolder();
  const backupDir = path.join(baseDir, "usb-recovery", `${timestamp}-${driveLetter}`);

  if (validFiles.length === 0) {
    return {
      backupDir,
      totalFiles: 0,
      totalBytes: 0,
      files: [],
      skippedUnreadable,
    };
  }

  options.onProgress?.(`Salvando backup de ${validFiles.length} perfil(is)/save(s)…`);
  await fsPromises.mkdir(backupDir, { recursive: true });

  const copiedFiles: string[] = [];
  let totalBytes = 0;

  for (const file of validFiles) {
    const destPath = path.join(backupDir, ...file.relativePath.split("/"));
    try {
      await fsPromises.mkdir(path.dirname(destPath), { recursive: true });
      await fsPromises.copyFile(file.absolutePath, destPath);
      copiedFiles.push(file.relativePath);
      totalBytes += file.sizeBytes;
    } catch (err: any) {
      skippedUnreadable.push(`${file.relativePath}: ${err?.message || String(err)}`);
    }
  }

  const manifest: RecoveryManifest = {
    version: 1,
    timestamp: now.toISOString(),
    driveRoot,
    files: validFiles
      .filter((f) => copiedFiles.includes(f.relativePath))
      .map((f) => ({
        relativePath: f.relativePath,
        sizeBytes: f.sizeBytes,
        isProfile: f.isProfile,
        isSave: f.isSave,
      })),
  };

  try {
    await fsPromises.writeFile(
      path.join(backupDir, "recovery-manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
  } catch {
    // Escrita do manifesto é best-effort.
  }

  return {
    backupDir,
    totalFiles: copiedFiles.length,
    totalBytes,
    files: copiedFiles,
    skippedUnreadable,
  };
}

/**
 * Restaura arquivos de perfis pessoais e saves de volta para a raiz do dispositivo USB.
 * Utiliza escrita com .tmp + rename atômico.
 */
export async function restoreUsbUserProfilesAndSaves(
  backupDir: string,
  targetDriveRoot: string,
): Promise<RestoreResult> {
  const result: RestoreResult = {
    restoredFiles: 0,
    totalBytes: 0,
    restored: [],
    errors: [],
  };

  const manifestPath = path.join(backupDir, "recovery-manifest.json");
  let relativePaths: string[] = [];

  try {
    if (fs.existsSync(manifestPath)) {
      const manifest: RecoveryManifest = JSON.parse(await fsPromises.readFile(manifestPath, "utf8"));
      if (Array.isArray(manifest.files)) {
        relativePaths = manifest.files.map((f) => f.relativePath).filter(Boolean);
      }
    }
  } catch {
    // Se o manifesto falhar na leitura, tentamos varrer recursivamente a pasta Content/
  }

  if (relativePaths.length === 0) {
    const contentDir = path.join(backupDir, "Content");
    if (fs.existsSync(contentDir)) {
      async function walkContent(dir: string): Promise<void> {
        const entries = await fsPromises.readdir(dir, { withFileTypes: true });
        for (const item of entries) {
          const full = path.join(dir, item.name);
          if (item.isDirectory()) {
            await walkContent(full);
          } else if (item.isFile()) {
            relativePaths.push(normalizeRelative(path.relative(backupDir, full)));
          }
        }
      }
      try {
        await walkContent(contentDir);
      } catch {
        // Ignora
      }
    }
  }

  for (const rel of relativePaths) {
    const src = path.join(backupDir, ...rel.split("/"));
    const dst = path.join(targetDriveRoot, ...rel.split("/"));
    try {
      await fsPromises.mkdir(path.dirname(dst), { recursive: true });
      const stat = await fsPromises.stat(src);
      const tmpDst = dst + ".tmp";
      await fsPromises.copyFile(src, tmpDst);
      await fsPromises.rename(tmpDst, dst);
      result.restoredFiles++;
      result.totalBytes += stat.size;
      result.restored.push(rel);
    } catch (err: any) {
      result.errors.push(`${rel}: ${err?.message || String(err)}`);
    }
  }

  return result;
}

