const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assessDriveForCatalogContext,
  catalogPlatformsForContext,
  normalizePlatformForContext,
  pickDefaultDriveForCatalogContext,
  shouldAllowFtpInCatalogContext,
} = require("../../infrastructure/catalogConsolePolicy.js");

test("fluxo Xbox One/Series oculta apenas Original Xbox e mantem todas as demais plataformas", () => {
  const xeniaPlatforms = catalogPlatformsForContext("xbox-one-series").map((p) => p.id);
  assert.equal(xeniaPlatforms.includes("xbox"), false);
  assert.ok(xeniaPlatforms.includes("xbox360"));
  assert.ok(xeniaPlatforms.includes("xbla"));
  assert.ok(xeniaPlatforms.includes("digital"));
  assert.ok(xeniaPlatforms.includes("dlc"));
  assert.ok(xeniaPlatforms.includes("xblig"));
  assert.ok(xeniaPlatforms.includes("games"));

  assert.equal(normalizePlatformForContext("xbox", "xbox-one-series"), "xbox360");
  assert.equal(normalizePlatformForContext("xbla", "xbox-one-series"), "xbla");
  assert.equal(shouldAllowFtpInCatalogContext("xbox-one-series"), false);
});

test("fluxo Catálogo direto (all) e fluxo Xbox 360 mantem Original Xbox e FTP disponiveis", () => {
  for (const ctx of ["all", "xbox360"]) {
    const ids = catalogPlatformsForContext(ctx).map((p) => p.id);
    assert.ok(ids.includes("xbox"), `${ctx} deve manter Original Xbox`);
    assert.equal(shouldAllowFtpInCatalogContext(ctx), true);
  }
});

test("Catalogo direto (all) nunca bloqueia nenhum drive; fluxos de console bloqueiam console oposto", () => {
  const drive360 = {
    rootPath: "E:\\",
    fileSystem: "FAT32",
    preparedState: "preparado-bloqueado-lt",
    xboxOneSeriesState: "preparado-outro-console",
  };
  const driveXenia = {
    rootPath: "F:\\",
    fileSystem: "NTFS",
    preparedState: "sem-preparo",
    xboxOneSeriesState: "preparado-xenia",
  };

  // G3: Catálogo direto da Home nunca bloqueia.
  assert.equal(assessDriveForCatalogContext(drive360, "all").compatible, true);
  assert.equal(assessDriveForCatalogContext(driveXenia, "all").compatible, true);

  // G4: Fluxo Xbox One/Series bloqueia pendrive de Xbox 360 e aceita HD Xenia.
  const x360InXenia = assessDriveForCatalogContext(drive360, "xbox-one-series");
  assert.equal(x360InXenia.compatible, false);
  assert.match(x360InXenia.blockReason, /Xbox 360/);
  assert.equal(assessDriveForCatalogContext(driveXenia, "xbox-one-series").compatible, true);

  // G4: Fluxo Xbox 360 bloqueia HD Xenia e aceita pendrive 360.
  const xeniaIn360 = assessDriveForCatalogContext(driveXenia, "xbox360");
  assert.equal(xeniaIn360.compatible, false);
  assert.match(xeniaIn360.blockReason, /Xbox One/);
  assert.equal(assessDriveForCatalogContext(drive360, "xbox360").compatible, true);

  // Seleção padrão prioriza o drive do console ativo.
  assert.equal(pickDefaultDriveForCatalogContext([drive360, driveXenia], "xbox-one-series").rootPath, "F:\\");
  assert.equal(pickDefaultDriveForCatalogContext([driveXenia, drive360], "xbox360").rootPath, "E:\\");
});
