const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { detectPreparedDeviceState } = require("../../services/preparedDeviceState.js");
const { isExploitProfilePath } = require("../../infrastructure/exploitProfile.js");

// Um perfil do exploit sintetico, com a mesma forma do que o manifesto ativo descreve:
// `Content/<XUID>/...`, com XUID diferente de 0000000000000000.
const EXPLOIT_PROFILE = [
  { path: "Content/E0002FF78DFBDE7B/FFFE07D1/00010000/E0002FF78DFBDE7B", sizeBytes: 7 },
];

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prepared-device-state-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 }));
  return root;
}

function write(root, relativePath, contents = "x") {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

test("dispositivo vazio nao tem preparo nenhum", async (t) => {
  assert.equal(await detectPreparedDeviceState(temp(t), EXPLOIT_PROFILE), "sem-preparo");
});

// O caso do cliente 232224620290076: a raiz tinha `xbox downloader`, `content` e `games`, e
// dentro de content "uma pasta com um monte de 0". A preparacao nunca tinha rodado ali — so o
// download de jogos —, e a tela dizia que ja existia um desbloqueio.
test("pendrive so com os jogos baixados nunca conta como preparado", async (t) => {
  const root = temp(t);
  write(root, "Content/0000000000000000/584D07D1/00007000/jogo", "god");
  write(root, "games/Trigger/default.xex", "xex");
  assert.equal(await detectPreparedDeviceState(root, EXPLOIT_PROFILE), "jogos-apenas");
});

test("pacote de terceiros na raiz nao conta como preparado", async (t) => {
  const root = temp(t);
  write(root, "FSD/default.xex", "fsd");
  write(root, "Freestyle/config.ini", "cfg");
  assert.equal(await detectPreparedDeviceState(root, EXPLOIT_PROFILE), "jogos-apenas");
});

// O caso dos clientes 88399251775584 e 45367823446171: preparado em modo RGH num console travado.
// `isRghOnly` filtra o plano para `Aurora/`, e o marcador e o launch.ini entram mesmo assim.
test("preparo em modo RGH e reconhecido como RGH, nao como desbloqueado", async (t) => {
  const root = temp(t);
  write(root, "Aurora/default.xex", "aurora");
  write(root, "launch.ini", "[Paths]");
  write(root, ".xbox-downloader/ready-to-play-v4.marker", "xbox-companion-ready-to-play-v4\r\n");
  write(root, "Content/0000000000000000/584D07D1/00007000/jogo", "god");
  assert.equal(await detectPreparedDeviceState(root, EXPLOIT_PROFILE), "preparado-rgh");
});

test("marcador de versao anterior continua sendo preparo deste aplicativo", async (t) => {
  const root = temp(t);
  write(root, ".xbox-downloader/ready-to-play-v2.marker", "xbox-companion-ready-to-play-v2\r\n");
  assert.equal(await detectPreparedDeviceState(root, EXPLOIT_PROFILE), "preparado-rgh");
});

test("o perfil do exploit gravado e o que declara o dispositivo preparado", async (t) => {
  const root = temp(t);
  write(root, "Aurora/default.xex", "aurora");
  write(root, "launch.ini", "[Paths]");
  write(root, ".xbox-downloader/ready-to-play-v4.marker", "marker");
  write(root, EXPLOIT_PROFILE[0].path, "profile");
  assert.equal(EXPLOIT_PROFILE[0].sizeBytes, "profile".length);
  assert.equal(await detectPreparedDeviceState(root, EXPLOIT_PROFILE), "preparado-bloqueado-lt");
});

test("perfil truncado nao passa por perfil gravado", async (t) => {
  const root = temp(t);
  write(root, ".xbox-downloader/ready-to-play-v4.marker", "marker");
  write(root, EXPLOIT_PROFILE[0].path, "pro");
  assert.equal(await detectPreparedDeviceState(root, EXPLOIT_PROFILE), "preparado-rgh");
});

// Manifesto ilegivel: sem poder conferir, o assistente tem de perguntar o modo do console — nunca
// afirmar que o desbloqueio esta la.
test("sem o perfil do pacote para conferir, nada e declarado desbloqueado", async (t) => {
  const root = temp(t);
  write(root, "Aurora/default.xex", "aurora");
  write(root, "launch.ini", "[Paths]");
  write(root, EXPLOIT_PROFILE[0].path, "profile");
  assert.equal(await detectPreparedDeviceState(root, []), "preparado-rgh");
});

test("o perfil do exploit sai do manifesto ativo, e o do console nao conta", () => {
  const assetsRoot = path.resolve(__dirname, "../../assets");
  const index = JSON.parse(fs.readFileSync(path.join(assetsRoot, "badavatar-package.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(assetsRoot, index.manifestFileName), "utf8"));
  const profile = manifest.files.filter((file) => isExploitProfilePath(file.path));

  assert.ok(profile.length > 0, "o pacote ativo precisa trazer o perfil do exploit");
  assert.ok(
    profile.every((file) => !file.path.startsWith("Content/0000000000000000/")),
    "a pasta de conteudo do console nao e perfil do exploit",
  );
  assert.ok(
    manifest.files.some((file) => file.path.startsWith("Content/0000000000000000/")),
    "o pacote tambem traz conteudo do console, e ele nao pode contar como desbloqueio",
  );
  assert.equal(isExploitProfilePath("Content"), false);
  assert.equal(isExploitProfilePath("Aurora/default.xex"), false);
  assert.equal(isExploitProfilePath("launch.ini"), false);
});
