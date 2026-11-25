const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  isConflictingRootBootEntryName,
  listConflictingRootBootEntries,
  hasConflictingRootBootEntries,
  quarantineConflictingRootBootEntries,
} = require("../../infrastructure/rootBootConflicts.js");

const revalidate = async () => {};

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "companion-root-conflicts-"));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved).toLowerCase(), parent.toLowerCase());
    assert.ok(path.basename(resolved).startsWith("companion-root-conflicts-"));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 });
  });
  return root;
}

function writeFile(root, rel, contents = "payload") {
  const target = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

test("isConflictingRootBootEntryName reconhece apenas entradas conflitantes de raiz", () => {
  for (const name of [
    "default.xex",
    "DEFAULT.XEX",
    "Default.xex",
    "$SystemUpdate",
    "$systemupdate",
    "$$ystemUpdate",
    "$$SystemUpdate",
  ]) {
    assert.equal(isConflictingRootBootEntryName(name), true, `esperado conflito para ${name}`);
  }

  for (const safe of [
    "launch.ini",
    "lhelper.xex",
    "UsbdSecPatch.xex",
    "Aurora",
    "BadUpdatePayload",
    "Content",
    "games",
    "Aurora/default.xex",
    "BadUpdatePayload\\default.xex",
    "games/Halo/default.xex",
    "SystemUpdate",
    "",
  ]) {
    assert.equal(isConflictingRootBootEntryName(safe), false, `nao deveria marcar ${safe}`);
  }
});

test("nao altera nem cria .xbox-downloader quando a raiz esta limpa", async (t) => {
  const root = fixture(t);
  writeFile(root, "Aurora/default.xex", "aurora");
  writeFile(root, "BadUpdatePayload/default.xex", "xeunshackle");
  writeFile(root, "games/MyGame/default.xex", "game");
  writeFile(root, "launch.ini", "[Paths]");
  writeFile(root, "lhelper.xex", "helper");
  writeFile(root, "UsbdSecPatch.xex", "patch");

  assert.deepEqual(await listConflictingRootBootEntries(root), []);
  assert.equal(await hasConflictingRootBootEntries(root), false);
  assert.deepEqual(await quarantineConflictingRootBootEntries(root, revalidate), []);
  assert.equal(fs.existsSync(path.join(root, ".xbox-downloader")), false);
  assert.equal(fs.readFileSync(path.join(root, "Aurora/default.xex"), "utf8"), "aurora");
  assert.equal(fs.readFileSync(path.join(root, "games/MyGame/default.xex"), "utf8"), "game");
});

test("isola default.xex e pastas $SystemUpdate / $$ystemUpdate da raiz preservando jogos e subpastas", async (t) => {
  const root = fixture(t);
  writeFile(root, "Default.XEX", "stray-root-xex");
  writeFile(root, "$SystemUpdate/su20076000_00000000", "update-data");
  writeFile(root, "$$ystemUpdate/xam.xex", "bypass-update");
  writeFile(root, "Aurora/default.xex", "aurora-ok");
  writeFile(root, "BadUpdatePayload/default.xex", "payload-ok");
  writeFile(root, "games/GTA5/default.xex", "game-ok");
  writeFile(root, "launch.ini", "[Paths]");

  assert.equal(await hasConflictingRootBootEntries(root), true);
  const moved = await quarantineConflictingRootBootEntries(root, revalidate);

  assert.equal(moved.length, 3);
  assert.equal(await hasConflictingRootBootEntries(root), false);
  assert.equal(fs.existsSync(path.join(root, "Default.XEX")), false);
  assert.equal(fs.existsSync(path.join(root, "$SystemUpdate")), false);
  assert.equal(fs.existsSync(path.join(root, "$$ystemUpdate")), false);

  const movedByLower = new Map(moved.map((item) => [item.originalName.toLowerCase(), item]));
  assert.equal(movedByLower.get("default.xex").kind, "file");
  assert.equal(
    fs.readFileSync(path.join(root, movedByLower.get("default.xex").quarantinePath), "utf8"),
    "stray-root-xex",
  );
  assert.equal(movedByLower.get("$systemupdate").kind, "directory");
  assert.equal(
    fs.readFileSync(
      path.join(root, movedByLower.get("$systemupdate").quarantinePath, "su20076000_00000000"),
      "utf8",
    ),
    "update-data",
  );
  assert.equal(movedByLower.get("$$ystemupdate").kind, "directory");
  assert.equal(
    fs.readFileSync(
      path.join(root, movedByLower.get("$$ystemupdate").quarantinePath, "xam.xex"),
      "utf8",
    ),
    "bypass-update",
  );

  // Arquivos legitimos em subpastas e na raiz permanecem intactos.
  assert.equal(fs.readFileSync(path.join(root, "Aurora/default.xex"), "utf8"), "aurora-ok");
  assert.equal(fs.readFileSync(path.join(root, "BadUpdatePayload/default.xex"), "utf8"), "payload-ok");
  assert.equal(fs.readFileSync(path.join(root, "games/GTA5/default.xex"), "utf8"), "game-ok");
  assert.equal(fs.readFileSync(path.join(root, "launch.ini"), "utf8"), "[Paths]");

  // Segunda execucao e no-op.
  assert.deepEqual(await quarantineConflictingRootBootEntries(root, revalidate), []);
});

test("nao sobrescreve quarentena anterior quando default.xex reaparece na raiz", async (t) => {
  const root = fixture(t);
  writeFile(root, "default.xex", "first-copy");
  const first = await quarantineConflictingRootBootEntries(root, revalidate);

  writeFile(root, "default.xex", "second-copy");
  const second = await quarantineConflictingRootBootEntries(root, revalidate);

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.notEqual(first[0].quarantinePath, second[0].quarantinePath);
  assert.equal(fs.readFileSync(path.join(root, first[0].quarantinePath), "utf8"), "first-copy");
  assert.equal(fs.readFileSync(path.join(root, second[0].quarantinePath), "utf8"), "second-copy");
});

test("propaga erro de revalidacao do dispositivo sem encapsular como conflito de raiz", async (t) => {
  const root = fixture(t);
  writeFile(root, "default.xex", "stray");

  await assert.rejects(
    quarantineConflictingRootBootEntries(root, async () => {
      throw new Error("O dispositivo USB não está acessível.");
    }),
    { message: /^O dispositivo USB não está acessível\.$/ },
  );
  assert.equal(fs.existsSync(path.join(root, "default.xex")), true);
});

test("retoma apos interrupcao entre itens conflitantes preservando quarentena anterior", async (t) => {
  const root = fixture(t);
  writeFile(root, "$SystemUpdate/patch.bin", "upd");
  writeFile(root, "default.xex", "xex");

  await assert.rejects(
    quarantineConflictingRootBootEntries(root, async () => {
      if (!fs.existsSync(path.join(root, "$SystemUpdate"))) {
        throw new Error("USB desconectado");
      }
    }),
    /USB desconectado/,
  );

  assert.equal(fs.existsSync(path.join(root, "default.xex")), true);
  const remaining = await quarantineConflictingRootBootEntries(root, revalidate);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].originalName.toLowerCase(), "default.xex");
  assert.equal(fs.existsSync(path.join(root, "default.xex")), false);

  const quarantineDirs = fs.readdirSync(path.join(root, ".xbox-downloader", "quarantine"));
  assert.equal(quarantineDirs.length, 2);
});

test("recusa junctions na entrada conflitante e na pasta .xbox-downloader", async (t) => {
  const root = fixture(t);
  const outside = fixture(t);
  writeFile(outside, "secret.txt", "do-not-move");

  // Junction disfarçada de $SystemUpdate na raiz nao pode ser movida.
  fs.symlinkSync(outside, path.join(root, "$SystemUpdate"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    quarantineConflictingRootBootEntries(root, revalidate),
    /Não foi possível isolar arquivo conflitante na raiz do dispositivo \(\$SystemUpdate\)/,
  );
  assert.equal(fs.readFileSync(path.join(outside, "secret.txt"), "utf8"), "do-not-move");

  // Junction em .xbox-downloader tambem deve ser recusada antes de mover default.xex.
  const other = fixture(t);
  writeFile(other, "default.xex", "stray");
  fs.symlinkSync(outside, path.join(other, ".xbox-downloader"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    quarantineConflictingRootBootEntries(other, revalidate),
    /diretório real/,
  );
  assert.equal(fs.existsSync(path.join(other, "default.xex")), true);
});

test("falha de rename (ex.: EBUSY) bloqueia o preparo com mensagem explicita em vez de ignorar conflito", async (t) => {
  const root = fixture(t);
  writeFile(root, "default.xex", "locked-file");

  t.mock.method(fs.promises, "rename", async () => {
    throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
  });

  await assert.rejects(
    quarantineConflictingRootBootEntries(root, revalidate),
    /Não foi possível isolar arquivo conflitante na raiz do dispositivo \(default\.xex\): EBUSY/,
  );
  assert.equal(fs.existsSync(path.join(root, "default.xex")), true);
});
