// Teste do formatador do Windows em VHD (bug "Nao Formatado", T2). Gera, a partir do
// buildGuardedWindowsFat32Script COMPILADO, um script por cenario com GUID e capacidade de
// mentira; o run-elevated.ps1 cria o VHD, troca esses dois valores pelos reais e relaxa o guarda
// de BusType = USB so na copia de teste (fixado no numero do disco do VHD). Depois do run,
// `node generate.cjs --verify <outDir>` confere o resultado e a leitura de readFormattedPartitionBytes.
//
// Uso: npx tsc; node scripts/vhd-format-test/generate.cjs <outDir>
//      (elevado) powershell -File scripts/vhd-format-test/run-elevated.ps1 -WorkDir <outDir>
//      node scripts/vhd-format-test/generate.cjs --verify <outDir>
const fs = require("node:fs");
const path = require("node:path");
const {
  buildGuardedWindowsFat32Script,
  readFormattedPartitionBytes,
} = require("../../infrastructure/fat32Format.js");

const DUMMY_GUID = "\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\";
const DUMMY_BYTES = 1073741824;

// letra, tamanho do VHD (MB), tabela, particoes de chegada e o que se espera de cada caminho.
const SCENARIOS = [
  { id: "S1", letter: "T", sizeMb: 8192, style: "GPT", setup: "fat32", expectRecreate: true, note: "<= 32 GB, GPT: diskpart clean + convert mbr" },
  { id: "S2", letter: "U", sizeMb: 8192, style: "MBR", setup: "two-partitions", expectRecreate: true, note: "<= 32 GB, MBR com 2 particoes (a 2a sem letra)" },
  { id: "S3", letter: "V", sizeMb: 8192, style: "MBR", setup: "ntfs-type7", expectRecreate: false, note: "<= 32 GB, MBR 1 particao tipo 7: Format-Volume na existente (H2)" },
  { id: "S4", letter: "W", sizeMb: 40960, style: "GPT", setup: "ntfs", expectRecreate: true, note: "> 32 GB, GPT: particao crua + fat32format" },
  { id: "S5", letter: "X", sizeMb: 40960, style: "MBR", setup: "ntfs-type7", expectRecreate: null, note: "> 32 GB, MBR 1 particao NTFS montada: caminho comum" },
  // Nos VHDs, Format-Volume e fat32format ja gravam o tipo 12; para exercitar a correcao de tipo
  // (H2), a copia de teste remarca a particao como 7 logo antes da conferencia final.
  {
    id: "S6", letter: "Y", sizeMb: 8192, style: "MBR", setup: "ntfs-type7", expectRecreate: false,
    note: "H2 simulada: tipo 7 depois de formatar -> Set-Partition -MbrType 12 no volume montado",
    expectLog: /corrigindo para 12/,
    patches: [{
      old: "  Update-Disk -Number $diskNo -ErrorAction SilentlyContinue",
      new: "  Set-Partition -DiskNumber $diskNo -PartitionNumber 1 -MbrType 7 -ErrorAction Stop\n  Update-Disk -Number $diskNo -ErrorAction SilentlyContinue",
    }],
  },
  // Mesmo caminho de S1 sem o Update-Disk: mostra se o cache do Storage Management enxerga o
  // diskpart sem ele.
  {
    id: "S7", letter: "Z", sizeMb: 8192, style: "GPT", setup: "fat32", expectRecreate: true,
    note: "S1 sem Update-Disk antes da conferencia final",
    patches: [{ old: "  Update-Disk -Number $diskNo -ErrorAction SilentlyContinue", new: "  # Update-Disk retirado no teste S7" }],
  },
];

function generate(outDir) {
  const exe = path.resolve(__dirname, "../../../../dist/win-unpacked/fat32format.exe");
  if (!fs.existsSync(exe)) throw new Error(`fat32format.exe ausente: ${exe}`);
  fs.mkdirSync(outDir, { recursive: true });
  for (const s of SCENARIOS) {
    const logPath = path.join(outDir, `${s.id}.format.log`);
    const script = buildGuardedWindowsFat32Script(s.letter, exe, logPath, {
      expectedVolumeGuid: DUMMY_GUID,
      expectedVolumeBytes: DUMMY_BYTES,
    });
    fs.writeFileSync(path.join(outDir, `${s.id}.template.ps1`), script, "utf8");
  }
  fs.writeFileSync(
    path.join(outDir, "scenarios.json"),
    JSON.stringify({ dummyGuid: DUMMY_GUID, dummyBytes: DUMMY_BYTES, scenarios: SCENARIOS }, null, 2),
  );
  console.log(`${SCENARIOS.length} cenarios gerados em ${outDir} (fat32format: ${exe})`);
}

function verify(outDir) {
  const results = JSON.parse(fs.readFileSync(path.join(outDir, "results.json"), "utf8").replace(/^\uFEFF/, ""));
  let failed = 0;
  for (const s of SCENARIOS) {
    const r = results.find((x) => x.id === s.id);
    const problems = [];
    if (!r) {
      problems.push("sem resultado");
    } else {
      const log = fs.existsSync(path.join(outDir, `${s.id}.format.log`))
        ? fs.readFileSync(path.join(outDir, `${s.id}.format.log`), "utf8")
        : "";
      const parsed = readFormattedPartitionBytes(log);
      if (r.exitCode !== 0) problems.push(`exit ${r.exitCode}`);
      if (r.finalStyle !== "MBR") problems.push(`tabela final ${r.finalStyle}`);
      if (r.finalCount !== 1) problems.push(`${r.finalCount} particoes`);
      if (r.finalMbrType !== 11 && r.finalMbrType !== 12) problems.push(`tipo ${r.finalMbrType}`);
      if (String(r.finalFs).toUpperCase() !== "FAT32") problems.push(`fs ${r.finalFs}`);
      if (parsed !== r.finalPartitionBytes) problems.push(`Particao final lida ${parsed} != Get-Partition ${r.finalPartitionBytes}`);
      // Linhas do proprio script antes de cada diskpart clean + convert mbr.
      const recreated = /recriar particao primaria limpa|Recriando a tabela|Recriando a particao|Recriando particao via diskpart|inicializando particao limpa/.test(log);
      r.recreated = recreated;
      if (s.expectRecreate !== null && recreated !== s.expectRecreate) problems.push(`recriou a tabela=${recreated}, esperado ${s.expectRecreate}`);
      if (s.expectLog && !s.expectLog.test(log)) problems.push(`log sem ${s.expectLog}`);
    }
    if (problems.length) failed++;
    console.log(`${s.id} ${problems.length ? "FALHOU" : "ok"} (recriou=${r && r.recreated}) — ${s.note}${problems.length ? ": " + problems.join("; ") : ""}`);
  }
  process.exitCode = failed ? 1 : 0;
}

const args = process.argv.slice(2);
if (args[0] === "--verify") verify(path.resolve(args[1]));
else if (args[0]) generate(path.resolve(args[0]));
else {
  console.error("uso: generate.cjs <outDir> | --verify <outDir>");
  process.exitCode = 2;
}
