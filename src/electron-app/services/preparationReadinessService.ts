import fs from "fs";
import path from "path";
import { getBundledResourcesRoot } from "../infrastructure/fileSystem";
import {
  verifySignedComponentManifest,
  type TrustedComponentManifest,
} from "../infrastructure/trustedComponentManifest";
import { PRODUCTION_TRUSTED_MANIFEST_KEYS } from "../infrastructure/trustedManifestKeyring";

const MAX_MANIFEST_FILE_BYTES = 2 * 1024 * 1024;

export interface TrustedManifestReadiness {
  ready: boolean;
  manifestPath: string;
  manifestId?: string;
  release?: string;
  componentCount: number;
  blocker?: string;
}

export function getTrustedManifestPath(): string {
  return path.join(
    getBundledResourcesRoot(),
    "assets",
    "security",
    "components.manifest.json",
  );
}

export function loadTrustedComponentManifest(now = new Date()): TrustedComponentManifest {
  if (Object.keys(PRODUCTION_TRUSTED_MANIFEST_KEYS).length === 0) {
    throw new Error("Nenhuma chave pública de release foi aprovada e incorporada ao aplicativo.");
  }
  const manifestPath = getTrustedManifestPath();
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_MANIFEST_FILE_BYTES) {
    throw new Error("O arquivo de manifesto possui tipo ou tamanho inválido.");
  }
  const envelope = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return verifySignedComponentManifest(envelope, PRODUCTION_TRUSTED_MANIFEST_KEYS, now);
}

export function inspectTrustedManifestReadiness(now = new Date()): TrustedManifestReadiness {
  const manifestPath = getTrustedManifestPath();
  if (Object.keys(PRODUCTION_TRUSTED_MANIFEST_KEYS).length === 0) {
    return {
      ready: false,
      manifestPath,
      componentCount: 0,
      blocker: "Nenhuma chave pública de release foi aprovada e incorporada ao aplicativo.",
    };
  }
  let stat;
  try {
    stat = fs.statSync(manifestPath);
  } catch {
    return {
      ready: false,
      manifestPath,
      componentCount: 0,
      blocker: "O manifesto assinado de componentes ainda não foi fornecido.",
    };
  }
  if (!stat.isFile() || stat.size < 2 || stat.size > MAX_MANIFEST_FILE_BYTES) {
    return {
      ready: false,
      manifestPath,
      componentCount: 0,
      blocker: "O arquivo de manifesto possui tipo ou tamanho inválido.",
    };
  }
  try {
    const manifest = loadTrustedComponentManifest(now);
    return {
      ready: true,
      manifestPath,
      manifestId: manifest.manifestId,
      release: manifest.release,
      componentCount: manifest.components.length,
    };
  } catch (error: any) {
    return {
      ready: false,
      manifestPath,
      componentCount: 0,
      blocker: `O manifesto de componentes não é confiável: ${error?.message || error}`,
    };
  }
}
