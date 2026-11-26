const test = require("node:test");
const assert = require("node:assert/strict");

const {
  XBOX_ONE_SERIES_MBR_MAX_BYTES,
  XBOX_ONE_SERIES_RECOMMENDED_MIN_BYTES,
  assessXboxOneSeriesLayout,
  isSmallCapacityForXeniaGames,
  recommendedPartitionStyleForXboxOneSeries,
} = require("../../infrastructure/xboxOneSeriesDiskLayoutPolicy.js");

const GB = 1024 ** 3;
const TB = 1024 ** 4;

test("escolhe MBR para discos ate 2 TiB e GPT acima de 2 TiB", () => {
  assert.equal(recommendedPartitionStyleForXboxOneSeries(64 * GB), "MBR");
  assert.equal(recommendedPartitionStyleForXboxOneSeries(XBOX_ONE_SERIES_MBR_MAX_BYTES), "MBR");
  assert.equal(recommendedPartitionStyleForXboxOneSeries(XBOX_ONE_SERIES_MBR_MAX_BYTES + 1), "GPT");
  assert.equal(recommendedPartitionStyleForXboxOneSeries(4 * TB), "GPT");
});

test("aviso de capacidade pequena dispara apenas abaixo de 16 GB", () => {
  assert.equal(isSmallCapacityForXeniaGames(8 * GB), true);
  assert.equal(isSmallCapacityForXeniaGames(XBOX_ONE_SERIES_RECOMMENDED_MIN_BYTES - 1), true);
  assert.equal(isSmallCapacityForXeniaGames(XBOX_ONE_SERIES_RECOMMENDED_MIN_BYTES), false);
  assert.equal(isSmallCapacityForXeniaGames(128 * GB), false);
  assert.equal(isSmallCapacityForXeniaGames(0), false);
});

test("aceita layout NTFS valido em MBR (<= 2 TiB) e GPT (> 2 TiB), setores 512 ou 4096", () => {
  const mbrOk = assessXboxOneSeriesLayout({
    partitionStyle: "MBR",
    partitionCount: 1,
    partitionOffsetBytes: 1048576,
    logicalSectorSize: 512,
    fileSystem: "NTFS",
    diskSizeBytes: 500 * GB,
    partitionSizeBytes: 500 * GB,
  });
  assert.equal(mbrOk.verdict, "ok");
  assert.deepEqual(mbrOk.codes, []);
  assert.equal(mbrOk.recommendedPartitionStyle, "MBR");

  const gpt4TbOk = assessXboxOneSeriesLayout({
    partitionStyle: "GPT",
    partitionCount: 1,
    partitionOffsetBytes: 1048576,
    logicalSectorSize: 4096,
    fileSystem: "NTFS",
    diskSizeBytes: 4 * TB,
    partitionSizeBytes: 4 * TB,
  });
  assert.equal(gpt4TbOk.verdict, "ok");
  assert.deepEqual(gpt4TbOk.codes, []);
  assert.equal(gpt4TbOk.recommendedPartitionStyle, "GPT");
});

test("reprova FAT32, exFAT, superfloppy, multiplas particoes e MBR acima de 2 TiB", () => {
  const fat32 = assessXboxOneSeriesLayout({
    partitionStyle: "MBR",
    partitionCount: 1,
    partitionOffsetBytes: 1048576,
    logicalSectorSize: 512,
    fileSystem: "FAT32",
    partitionSizeBytes: 128 * GB,
  });
  assert.equal(fat32.verdict, "rejected");
  assert.ok(fat32.codes.includes("NOT_NTFS"));
  assert.equal(fat32.fixableByFormat, true);

  const superfloppy = assessXboxOneSeriesLayout({
    partitionStyle: "MBR",
    partitionCount: 1,
    partitionOffsetBytes: 0,
    logicalSectorSize: 512,
    fileSystem: "NTFS",
    partitionSizeBytes: 64 * GB,
  });
  assert.equal(superfloppy.verdict, "rejected");
  assert.ok(superfloppy.codes.includes("SUPERFLOPPY"));

  const multiPart = assessXboxOneSeriesLayout({
    partitionStyle: "GPT",
    partitionCount: 2,
    partitionOffsetBytes: 1048576,
    logicalSectorSize: 512,
    fileSystem: "NTFS",
    diskSizeBytes: 1 * TB,
    partitionSizeBytes: 500 * GB,
  });
  assert.equal(multiPart.verdict, "rejected");
  assert.ok(multiPart.codes.includes("PARTITION_COUNT"));

  const mbrOver2Tb = assessXboxOneSeriesLayout({
    partitionStyle: "MBR",
    partitionCount: 1,
    partitionOffsetBytes: 1048576,
    logicalSectorSize: 512,
    fileSystem: "NTFS",
    diskSizeBytes: 4 * TB,
    partitionSizeBytes: 2 * TB,
  });
  assert.equal(mbrOver2Tb.verdict, "rejected");
  assert.ok(mbrOver2Tb.codes.includes("PARTITION_STYLE"));
  assert.equal(mbrOver2Tb.recommendedPartitionStyle, "GPT");
});

test("layout fisico ausente devolve unknown sem bloquear", () => {
  const unknown = assessXboxOneSeriesLayout({
    partitionStyle: "",
    partitionCount: 0,
    logicalSectorSize: 0,
    fileSystem: "NTFS",
    partitionSizeBytes: 128 * GB,
  });
  assert.equal(unknown.verdict, "unknown");
  assert.equal(unknown.fixableByFormat, true);
});
