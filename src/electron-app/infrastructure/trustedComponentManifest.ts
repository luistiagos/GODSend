import { createPublicKey, KeyObject, verify as verifySignature } from "crypto";

export const COMPONENT_MANIFEST_SCHEMA_VERSION = 1;
export const MAX_COMPONENT_DOWNLOAD_BYTES = 2 * 1024 ** 3;
export const MAX_COMPONENT_EXTRACTED_BYTES = 8 * 1024 ** 3;
export const MAX_COMPONENT_ARCHIVE_ENTRIES = 10_000;

export type TrustedComponentRole =
  | "badavatar-entry"
  | "xeunshackle-autostart"
  | "dashboard-aurora"
  | "xexmenu";

export interface TrustedComponentSource {
  url: string;
  redirectHosts: string[];
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

export interface TrustedComponentLicense {
  spdx: string;
  projectUrl: string;
  redistributionApproved: true;
  attribution: string;
}

export interface TrustedComponentArchive {
  format: "zip" | "raw";
  installPath: string;
  maxExtractedBytes: number;
  maxEntries: number;
}

export interface TrustedComponent {
  id: string;
  role: TrustedComponentRole;
  displayName: string;
  version: string;
  required: boolean;
  source: TrustedComponentSource;
  license: TrustedComponentLicense;
  archive: TrustedComponentArchive;
}

export interface TrustedComponentManifest {
  schemaVersion: 1;
  manifestId: string;
  release: string;
  createdAt: string;
  expiresAt: string;
  components: TrustedComponent[];
}

export interface SignedComponentManifestEnvelope {
  schemaVersion: 1;
  algorithm: "Ed25519";
  keyId: string;
  manifest: TrustedComponentManifest;
  signature: string;
}

export type TrustedManifestKeyring = Readonly<Record<string, string | Buffer | KeyObject>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertPlainObject(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${field} deve ser um objeto JSON.`);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`${field} contém campos desconhecidos: ${extras.join(", ")}.`);
}

function requiredString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${field} é inválido.`);
  }
  return value;
}

function requiredInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${field} está fora dos limites permitidos.`);
  }
  return Number(value);
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} deve ser booleano.`);
  return value;
}

function requiredDate(value: unknown, field: string): string {
  const text = requiredString(value, field, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) {
    throw new Error(`${field} deve estar em UTC no formato ISO 8601.`);
  }
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${field} contém uma data inválida.`);
  return text;
}

function validateHttpsUrl(value: unknown, field: string): string {
  const text = requiredString(value, field, 2048);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${field} contém uma URL inválida.`);
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error(`${field} deve usar HTTPS e não pode conter credenciais.`);
  }
  return parsed.toString();
}

function validateLeafFileName(value: unknown, field: string): string {
  const text = requiredString(value, field, 180);
  if (
    text === "." ||
    text === ".." ||
    /[\\/:*?"<>|\x00-\x1f]/.test(text) ||
    text.endsWith(".") ||
    text.endsWith(" ")
  ) {
    throw new Error(`${field} não é um nome de arquivo seguro.`);
  }
  return text;
}

function validateInstallPath(value: unknown, field: string): string {
  const text = requiredString(value, field, 500);
  if (text === ".") return text;
  if (text.startsWith("/") || text.includes("\\") || /^[a-z]:/i.test(text)) {
    throw new Error(`${field} deve ser um caminho relativo normalizado com '/'.`);
  }
  const segments = text.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${field} contém travessia ou segmento inválido.`);
  }
  return text;
}

function validateSource(value: unknown, field: string): TrustedComponentSource {
  assertPlainObject(value, field);
  assertOnlyKeys(value, ["url", "redirectHosts", "fileName", "sizeBytes", "sha256"], field);
  const sha256 = requiredString(value.sha256, `${field}.sha256`, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`${field}.sha256 deve ter 64 dígitos hexadecimais.`);
  if (!Array.isArray(value.redirectHosts) || value.redirectHosts.length > 10) {
    throw new Error(`${field}.redirectHosts deve ser uma lista com no máximo 10 hosts.`);
  }
  const redirectHosts = value.redirectHosts.map((host, index) => {
    const text = requiredString(host, `${field}.redirectHosts[${index}]`, 253).toLowerCase();
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(text)) {
      throw new Error(`${field}.redirectHosts[${index}] é inválido.`);
    }
    return text;
  });
  if (new Set(redirectHosts).size !== redirectHosts.length) {
    throw new Error(`${field}.redirectHosts contém hosts duplicados.`);
  }
  return {
    url: validateHttpsUrl(value.url, `${field}.url`),
    redirectHosts,
    fileName: validateLeafFileName(value.fileName, `${field}.fileName`),
    sizeBytes: requiredInteger(value.sizeBytes, `${field}.sizeBytes`, 1, MAX_COMPONENT_DOWNLOAD_BYTES),
    sha256,
  };
}

function validateLicense(value: unknown, field: string): TrustedComponentLicense {
  assertPlainObject(value, field);
  assertOnlyKeys(value, ["spdx", "projectUrl", "redistributionApproved", "attribution"], field);
  if (value.redistributionApproved !== true) {
    throw new Error(`${field}.redistributionApproved precisa ser explicitamente true.`);
  }
  return {
    spdx: requiredString(value.spdx, `${field}.spdx`, 100),
    projectUrl: validateHttpsUrl(value.projectUrl, `${field}.projectUrl`),
    redistributionApproved: true,
    attribution: requiredString(value.attribution, `${field}.attribution`, 500),
  };
}

function validateArchive(value: unknown, field: string): TrustedComponentArchive {
  assertPlainObject(value, field);
  assertOnlyKeys(value, ["format", "installPath", "maxExtractedBytes", "maxEntries"], field);
  if (value.format !== "zip" && value.format !== "raw") {
    throw new Error(`${field}.format deve ser 'zip' ou 'raw'.`);
  }
  return {
    format: value.format,
    installPath: validateInstallPath(value.installPath, `${field}.installPath`),
    maxExtractedBytes: requiredInteger(
      value.maxExtractedBytes,
      `${field}.maxExtractedBytes`,
      1,
      MAX_COMPONENT_EXTRACTED_BYTES,
    ),
    maxEntries: requiredInteger(value.maxEntries, `${field}.maxEntries`, 1, MAX_COMPONENT_ARCHIVE_ENTRIES),
  };
}

function validateComponent(value: unknown, index: number): TrustedComponent {
  const field = `manifest.components[${index}]`;
  assertPlainObject(value, field);
  assertOnlyKeys(
    value,
    ["id", "role", "displayName", "version", "required", "source", "license", "archive"],
    field,
  );
  const id = requiredString(value.id, `${field}.id`, 80).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`${field}.id é inválido.`);
  const allowedRoles: TrustedComponentRole[] = [
    "badavatar-entry",
    "xeunshackle-autostart",
    "dashboard-aurora",
    "xexmenu",
  ];
  if (!allowedRoles.includes(value.role as TrustedComponentRole)) {
    throw new Error(`${field}.role é inválido.`);
  }
  const source = validateSource(value.source, `${field}.source`);
  const archive = validateArchive(value.archive, `${field}.archive`);
  if (archive.format === "raw" && archive.maxEntries !== 1) {
    throw new Error(`${field}.archive.maxEntries deve ser 1 para arquivos raw.`);
  }
  if (archive.maxExtractedBytes < source.sizeBytes) {
    throw new Error(`${field}.archive.maxExtractedBytes não pode ser menor que o download.`);
  }
  return {
    id,
    role: value.role as TrustedComponentRole,
    displayName: requiredString(value.displayName, `${field}.displayName`, 150),
    version: requiredString(value.version, `${field}.version`, 80),
    required: requiredBoolean(value.required, `${field}.required`),
    source,
    license: validateLicense(value.license, `${field}.license`),
    archive,
  };
}

export function validateTrustedComponentManifest(
  value: unknown,
  now = new Date(),
): TrustedComponentManifest {
  assertPlainObject(value, "manifest");
  assertOnlyKeys(
    value,
    ["schemaVersion", "manifestId", "release", "createdAt", "expiresAt", "components"],
    "manifest",
  );
  if (value.schemaVersion !== COMPONENT_MANIFEST_SCHEMA_VERSION) {
    throw new Error("Versão de manifesto não suportada.");
  }
  const manifestId = requiredString(value.manifestId, "manifest.manifestId", 100);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(manifestId)) {
    throw new Error("manifest.manifestId é inválido.");
  }
  const createdAt = requiredDate(value.createdAt, "manifest.createdAt");
  const expiresAt = requiredDate(value.expiresAt, "manifest.expiresAt");
  const createdMs = Date.parse(createdAt);
  const expiresMs = Date.parse(expiresAt);
  if (createdMs > now.getTime() + 5 * 60_000) throw new Error("O manifesto foi criado no futuro.");
  if (expiresMs <= createdMs) throw new Error("O manifesto expira antes de sua criação.");
  if (expiresMs <= now.getTime()) throw new Error("O manifesto confiável expirou.");
  if (!Array.isArray(value.components) || value.components.length === 0 || value.components.length > 100) {
    throw new Error("manifest.components deve conter entre 1 e 100 componentes.");
  }
  const components = value.components.map(validateComponent);
  const ids = new Set<string>();
  for (const component of components) {
    if (ids.has(component.id)) throw new Error(`Componente duplicado no manifesto: ${component.id}.`);
    ids.add(component.id);
  }
  return {
    schemaVersion: COMPONENT_MANIFEST_SCHEMA_VERSION,
    manifestId,
    release: requiredString(value.release, "manifest.release", 80),
    createdAt,
    expiresAt,
    components,
  };
}

export function canonicalizeJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("O manifesto contém número não finito.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`;
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error("O manifesto contém um tipo que não pertence a JSON canônico.");
}

function decodeSignature(value: unknown): Buffer {
  const text = requiredString(value, "envelope.signature", 200);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error("Assinatura Base64 inválida.");
  const decoded = Buffer.from(text, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== text) {
    throw new Error("Assinatura Ed25519 inválida.");
  }
  return decoded;
}

export function verifySignedComponentManifest(
  value: unknown,
  keyring: TrustedManifestKeyring,
  now = new Date(),
): TrustedComponentManifest {
  assertPlainObject(value, "envelope");
  assertOnlyKeys(value, ["schemaVersion", "algorithm", "keyId", "manifest", "signature"], "envelope");
  if (value.schemaVersion !== COMPONENT_MANIFEST_SCHEMA_VERSION || value.algorithm !== "Ed25519") {
    throw new Error("Envelope de assinatura não suportado.");
  }
  const keyId = requiredString(value.keyId, "envelope.keyId", 100);
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(keyId)) throw new Error("envelope.keyId é inválido.");
  const configuredKey = keyring[keyId];
  if (!configuredKey) throw new Error(`Chave de confiança desconhecida: ${keyId}.`);
  const signature = decodeSignature(value.signature);
  const canonicalManifest = Buffer.from(canonicalizeJson(value.manifest), "utf8");
  let publicKey: KeyObject;
  try {
    publicKey = configuredKey instanceof KeyObject ? configuredKey : createPublicKey(configuredKey);
  } catch {
    throw new Error(`A chave pública ${keyId} é inválida.`);
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error(`A chave pública ${keyId} não é Ed25519.`);
  }
  if (!verifySignature(null, canonicalManifest, publicKey, signature)) {
    throw new Error("A assinatura do manifesto não confere.");
  }
  return validateTrustedComponentManifest(value.manifest, now);
}
