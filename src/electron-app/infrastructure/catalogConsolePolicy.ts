/**
 * Regras puras do catálogo de jogos por contexto de console.
 * Sem imports do Electron/React para ser testável diretamente em `tests/unit/`.
 *
 * Regras aprovadas (D3, G3, G4):
 * - Fluxo "Catálogo de Jogos" direto da Home (`context === "all"`): 100% independente —
 *   exibe todas as plataformas (inclusive Original Xbox) e nunca bloqueia nenhum drive/destino.
 * - Fluxo Xbox One / Series (`context === "xbox-one-series"`): oculta apenas `xbox`
 *   (Original Xbox / Xbox Clássico não roda no Xenia); mantém `xbox360`, `xbla`, `digital`,
 *   `dlc`, `xblig` e `games` (verificado que `games` é 100% Xbox 360); oculta FTP Aurora;
 *   bloqueia envio para pendrive preparado para Xbox 360.
 * - Fluxo Xbox 360 (`context === "xbox360"`): exibe todas as plataformas; bloqueia envio
 *   acidental para pendrive/HD preparado para Xbox One / Series (NTFS/Xenia).
 */

import type {
  CatalogConsoleContext,
  PreparedDeviceState,
  XboxOneSeriesDeviceState,
} from "../services/preparedUsbDetection";

export interface CatalogPlatformDef {
  id: string;
  label: string;
  methods: boolean;
}

export const ALL_CATALOG_PLATFORMS: readonly CatalogPlatformDef[] = [
  { id: "xbox360", label: "Xbox 360", methods: true },
  { id: "xbox", label: "Original Xbox", methods: true },
  { id: "xbla", label: "XBLA", methods: false },
  { id: "digital", label: "Digital", methods: false },
  { id: "dlc", label: "DLC", methods: false },
  { id: "xblig", label: "Indie", methods: false },
  { id: "games", label: "Games Archive", methods: true },
];

export function catalogPlatformsForContext(
  context: CatalogConsoleContext = "all",
): CatalogPlatformDef[] {
  if (context === "xbox-one-series") {
    return ALL_CATALOG_PLATFORMS.filter((p) => p.id !== "xbox");
  }
  return [...ALL_CATALOG_PLATFORMS];
}

export function normalizePlatformForContext(
  platform: string,
  context: CatalogConsoleContext = "all",
): string {
  const allowed = catalogPlatformsForContext(context);
  if (allowed.some((p) => p.id === platform)) return platform;
  return allowed[0]?.id || "xbox360";
}

export function shouldAllowFtpInCatalogContext(
  context: CatalogConsoleContext = "all",
): boolean {
  return context !== "xbox-one-series";
}

export interface CatalogDriveDescriptor {
  rootPath: string;
  label?: string;
  fileSystem?: string;
  preparedState?: PreparedDeviceState;
  xboxOneSeriesState?: XboxOneSeriesDeviceState;
}

export interface DriveCompatibilityResult {
  compatible: boolean;
  /** Motivo legível para usuário leigo quando incompatível (bloqueia o envio dentro do fluxo do console). */
  blockReason?: string;
  /** Etiqueta curta para exibir junto ao nome do drive no seletor de destino. */
  consoleTag?: string;
}

/**
 * Avalia se um drive USB é compatível com o contexto ativo do catálogo.
 * - No contexto `"all"` (entrada direta pelo Catálogo na Home), nunca bloqueia (G3).
 * - Dentro de `"xbox-one-series"`, bloqueia drives preparados para Xbox 360 (G4).
 * - Dentro de `"xbox360"`, bloqueia drives preparados para Xbox One / Series (G4).
 */
export function assessDriveForCatalogContext(
  drive: CatalogDriveDescriptor | null | undefined,
  context: CatalogConsoleContext = "all",
): DriveCompatibilityResult {
  if (!drive) return { compatible: true };

  const isXeniaDrive = drive.xboxOneSeriesState === "preparado-xenia";
  const isXbox360Drive =
    drive.preparedState === "preparado-bloqueado-lt" ||
    drive.preparedState === "preparado-rgh";

  const consoleTag = isXeniaDrive
    ? "Xbox One / Series · NTFS"
    : isXbox360Drive
      ? "Xbox 360 · FAT32"
      : drive.fileSystem
        ? drive.fileSystem.toUpperCase()
        : undefined;

  if (context === "all") {
    return { compatible: true, consoleTag };
  }

  if (context === "xbox-one-series" && isXbox360Drive) {
    return {
      compatible: false,
      consoleTag,
      blockReason:
        "Este pendrive está preparado para o Xbox 360 (FAT32) e não funciona no Xbox One / Series (Xenia). Escolha o pendrive/HD preparado para Xbox One / Series ou salve em uma Pasta no PC.",
    };
  }

  if (context === "xbox360" && isXeniaDrive) {
    return {
      compatible: false,
      consoleTag,
      blockReason:
        "Este pendrive/HD está preparado para o Xbox One / Series (NTFS / Xenia) e o Xbox 360 não consegue lê-lo. Escolha um pendrive preparado para Xbox 360 ou salve em uma Pasta no PC.",
    };
  }

  return { compatible: true, consoleTag };
}

/** Escolhe o drive padrão mais adequado ao contexto ativo do catálogo. */
export function pickDefaultDriveForCatalogContext<T extends CatalogDriveDescriptor>(
  drives: readonly T[],
  context: CatalogConsoleContext = "all",
): T | undefined {
  if (!drives.length) return undefined;
  if (context === "xbox-one-series") {
    return (
      drives.find((d) => d.xboxOneSeriesState === "preparado-xenia") ||
      drives.find((d) => assessDriveForCatalogContext(d, context).compatible) ||
      drives[0]
    );
  }
  if (context === "xbox360") {
    return (
      drives.find(
        (d) =>
          d.preparedState === "preparado-bloqueado-lt" ||
          d.preparedState === "preparado-rgh",
      ) ||
      drives.find((d) => assessDriveForCatalogContext(d, context).compatible) ||
      drives[0]
    );
  }
  return drives[0];
}
