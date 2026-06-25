import { randomUUID } from "crypto";
import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { hashFileSha256 } from "./secureComponentStaging";
import type { SecureZipExtractionResult } from "./secureZipExtractor";
import { canonicalizeJson, type TrustedComponent, type TrustedComponentManifest, type TrustedComponentRole } from "./trustedComponentManifest";
import { validateXboxTargetRelativePath, type WritePlanSourceEntry } from "./transactionalWritePlan";

const REQUIRED_ROLES: TrustedComponentRole[] = [
  "badavatar-entry",
  "xeunshackle-autostart",
  "dashboard-aurora",
];

const GENERATED_LAUNCH_PATH = "launch.ini";
const GENERATED_AUTOSTART_PATH = "BadUpdatePayload/XeUnshackleAutoStart.txt";
const GENERATED_MANIFEST_PATH = ".xbox-downloader/manifest.json";
const FORBIDDEN_COMPONENT_PATHS = new Set([
  GENERATED_LAUNCH_PATH.toLowerCase(),
  GENERATED_AUTOSTART_PATH.toLowerCase(),
  GENERATED_MANIFEST_PATH.toLowerCase(),
]);
const FORBIDDEN_FILE_NAMES = new Set([
  "originalmacaddress.bin",
  "kv.bin",
  "updflash.bin",
  "nanddump.bin",
  "flashdmp.bin",
]);

export interface ExtractedTrustedComponent {
  component: TrustedComponent;
  extraction: SecureZipExtractionResult;
}

export interface CleanImageManifestFile {
  path: string;
  sizeBytes: number;
  sha256: string;
  source: string;
}

export interface CleanImageManifest {
  schemaVersion: 1;
  manifestId: string;
  manifestRelease: string;
  createdAt: string;
  autoStartSeconds: number;
  files: CleanImageManifestFile[];
}

export interface CleanDeviceImageResult {
  imageRoot: string;
  files: WritePlanSourceEntry[];
  imageManifest: CleanImageManifest;
}

export function generateCleanLaunchIni(): string {
  return [
    "[Paths]",
    "Default = Usb:\\Aurora\\default.xex",
    "",
    "[Settings]",
    "noupdater = true",
    "liveblock = true",
    "livestrong = false",
    "",
  ].join("\r\n");
}

export function validateCleanLaunchIni(contents: string): void {
  if (contents !== generateCleanLaunchIni()) {
    throw new Error("launch.ini diverge da configuração mínima e segura aprovada.");
  }
  if (!/^[\x09\x0d\x0a\x20-\x7e]*$/.test(contents) || contents.charCodeAt(0) === 0xfeff) {
    throw new Error("launch.ini precisa ser ASCII sem BOM.");
  }
}

export function generateXeUnshackleAutoStart(seconds = 2): string {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 10) {
    throw new Error("O AutoStart precisa estar entre 1 e 10 segundos.");
  }
  return seconds.toFixed(2);
}

function relativeInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function combineInstallPath(component: TrustedComponent, archivePath: string): string {
  return component.archive.installPath === "."
    ? archivePath
    : `${component.archive.installPath}/${archivePath}`;
}

async function copyVerifiedFile(source: string, destination: string, expectedSize: number, expectedHash: string): Promise<void> {
  await fsPromises.mkdir(path.dirname(destination), { recursive: true });
  await pipeline(
    fs.createReadStream(source),
    fs.createWriteStream(destination, { flags: "wx", mode: 0o600 }),
  );
  const stat = await fsPromises.lstat(destination);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expectedSize) {
    throw new Error(`Cópia de staging possui tipo ou tamanho incorreto: ${destination}.`);
  }
  if (await hashFileSha256(destination) !== expectedHash) {
    throw new Error(`Cópia de staging falhou na verificação SHA-256: ${destination}.`);
  }
  const handle = await fsPromises.open(destination, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeGeneratedFile(destination: string, contents: string): Promise<CleanImageManifestFile> {
  await fsPromises.mkdir(path.dirname(destination), { recursive: true });
  const handle = await fsPromises.open(destination, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  const stat = await fsPromises.stat(destination);
  return {
    path: "",
    sizeBytes: stat.size,
    sha256: await hashFileSha256(destination),
    source: "generated",
  };
}

function assertRoleSet(inputs: ExtractedTrustedComponent[]): void {
  const roleCounts = new Map<TrustedComponentRole, number>();
  for (const input of inputs) {
    roleCounts.set(input.component.role, (roleCounts.get(input.component.role) || 0) + 1);
  }
  for (const role of REQUIRED_ROLES) {
    if (roleCounts.get(role) !== 1) throw new Error(`A imagem exige exatamente um componente com role ${role}.`);
  }
  if ((roleCounts.get("xexmenu") || 0) > 1) throw new Error("A imagem aceita no máximo um componente xexmenu.");
}

export async function buildCleanDeviceImage(
  trustedManifest: TrustedComponentManifest,
  inputs: ExtractedTrustedComponent[],
  outputPath: string,
  options: { autoStartSeconds?: number; now?: Date } = {},
): Promise<CleanDeviceImageResult> {
  if (!path.isAbsolute(outputPath)) throw new Error("O destino da imagem precisa ser absoluto.");
  if (!Array.isArray(inputs) || inputs.length < REQUIRED_ROLES.length) {
    throw new Error("Componentes insuficientes para montar a imagem limpa.");
  }
  assertRoleSet(inputs);
  const manifestById = new Map(trustedManifest.components.map((component) => [component.id, component]));
  const suppliedIds = new Set<string>();
  for (const input of inputs) {
    const trusted = manifestById.get(input.component.id);
    if (
      !trusted ||
      trusted.role !== input.component.role ||
      trusted.version !== input.component.version ||
      trusted.source.sha256 !== input.component.source.sha256
    ) {
      throw new Error(`O componente ${input.component.id} não pertence ao manifesto confiável.`);
    }
    if (suppliedIds.has(input.component.id)) throw new Error(`Componente duplicado: ${input.component.id}.`);
    suppliedIds.add(input.component.id);
  }
  for (const component of trustedManifest.components) {
    if (component.required && !suppliedIds.has(component.id)) {
      throw new Error(`Componente obrigatório ausente: ${component.id}.`);
    }
  }

  const finalRoot = path.resolve(outputPath);
  const parent = path.dirname(finalRoot);
  await fsPromises.mkdir(parent, { recursive: true });
  const realParent = await fsPromises.realpath(parent);
  if (
    (process.platform === "win32" ? realParent.toLowerCase() : realParent) !==
    (process.platform === "win32" ? parent.toLowerCase() : parent)
  ) {
    throw new Error("O destino da imagem atravessa link ou redirecionamento de diretório.");
  }
  if (await fsPromises.lstat(finalRoot).then(() => true, (error: any) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  })) {
    throw new Error("A imagem final já existe e nunca será sobrescrita.");
  }
  const temporaryRoot = path.join(parent, `.${path.basename(finalRoot)}.${randomUUID()}.partial`);
  await fsPromises.mkdir(temporaryRoot);

  const imageFiles: CleanImageManifestFile[] = [];
  const caseInsensitiveTargets = new Set<string>();
  try {
    for (const input of inputs) {
      const extractionRoot = await fsPromises.realpath(input.extraction.outputPath);
      for (const file of input.extraction.files) {
        const sourcePath = await fsPromises.realpath(file.sourcePath);
        if (!relativeInside(extractionRoot, sourcePath)) {
          throw new Error(`Arquivo extraído escapou da raiz do componente ${input.component.id}.`);
        }
        const sourceStat = await fsPromises.lstat(sourcePath);
        if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size !== file.sizeBytes) {
          throw new Error(`Arquivo extraído mudou de tipo ou tamanho: ${file.archivePath}.`);
        }
        if (await hashFileSha256(sourcePath) !== file.sha256) {
          throw new Error(`Arquivo extraído mudou de conteúdo: ${file.archivePath}.`);
        }
        const relativePath = validateXboxTargetRelativePath(
          combineInstallPath(input.component, file.archivePath),
        );
        const key = relativePath.toLowerCase();
        if (FORBIDDEN_COMPONENT_PATHS.has(key)) {
          throw new Error(`Componente tentou fornecer arquivo reservado: ${relativePath}.`);
        }
        if (FORBIDDEN_FILE_NAMES.has(path.posix.basename(key))) {
          throw new Error(`Arquivo sensível proibido na imagem limpa: ${relativePath}.`);
        }
        if (key.startsWith(".xbox-downloader/")) {
          throw new Error("Componentes não podem escrever metadados internos do preparador.");
        }
        if (caseInsensitiveTargets.has(key)) throw new Error(`Colisão entre componentes: ${relativePath}.`);
        caseInsensitiveTargets.add(key);
        const destination = path.join(temporaryRoot, ...relativePath.split("/"));
        await copyVerifiedFile(sourcePath, destination, file.sizeBytes, file.sha256);
        imageFiles.push({
          path: relativePath,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          source: input.component.id,
        });
      }
    }

    const requiredPaths = ["BadUpdatePayload/default.xex", "Aurora/default.xex"];
    for (const requiredPath of requiredPaths) {
      if (!caseInsensitiveTargets.has(requiredPath.toLowerCase())) {
        throw new Error(`A imagem não contém o arquivo obrigatório ${requiredPath}.`);
      }
    }
    if (![...caseInsensitiveTargets].some((target) => target.startsWith("content/"))) {
      throw new Error("A imagem não contém o perfil de entrada em Content/.");
    }

    const launchContents = generateCleanLaunchIni();
    validateCleanLaunchIni(launchContents);
    const launchFile = await writeGeneratedFile(path.join(temporaryRoot, GENERATED_LAUNCH_PATH), launchContents);
    imageFiles.push({ ...launchFile, path: GENERATED_LAUNCH_PATH, source: "generated:launch.ini" });

    const autoStartSeconds = options.autoStartSeconds ?? 2;
    const autoStartContents = generateXeUnshackleAutoStart(autoStartSeconds);
    const autoStartFile = await writeGeneratedFile(
      path.join(temporaryRoot, ...GENERATED_AUTOSTART_PATH.split("/")),
      autoStartContents,
    );
    imageFiles.push({ ...autoStartFile, path: GENERATED_AUTOSTART_PATH, source: "generated:autostart" });

    imageFiles.sort((a, b) => a.path.localeCompare(b.path, "en", { sensitivity: "base" }));
    const imageManifest: CleanImageManifest = {
      schemaVersion: 1,
      manifestId: trustedManifest.manifestId,
      manifestRelease: trustedManifest.release,
      createdAt: (options.now || new Date()).toISOString(),
      autoStartSeconds,
      files: imageFiles.map((file) => ({ ...file })),
    };
    await writeGeneratedFile(
      path.join(temporaryRoot, ...GENERATED_MANIFEST_PATH.split("/")),
      `${canonicalizeJson(imageManifest)}\n`,
    );
    await fsPromises.rename(temporaryRoot, finalRoot);

    const planFiles: WritePlanSourceEntry[] = [];
    for (const file of [...imageFiles, {
      path: GENERATED_MANIFEST_PATH,
      sizeBytes: (await fsPromises.stat(path.join(finalRoot, ...GENERATED_MANIFEST_PATH.split("/")))).size,
      sha256: await hashFileSha256(path.join(finalRoot, ...GENERATED_MANIFEST_PATH.split("/"))),
      source: "generated:image-manifest",
    }]) {
      planFiles.push({
        sourcePath: path.join(finalRoot, ...file.path.split("/")),
        relativePath: file.path,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
      });
    }
    return { imageRoot: finalRoot, files: planFiles, imageManifest };
  } catch (error) {
    await fsPromises.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

