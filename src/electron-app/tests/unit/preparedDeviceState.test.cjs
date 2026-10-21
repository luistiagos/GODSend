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
  { path: "Content/E0002FF78DFBDE7B/FFFE07D1/00010000/E0002FF78DFBDE7B", sizeBytes: 335872 },
];

// Pacote STFS com os campos do perfil do pacote badavatar-1.1: `CON `, headerSize 0x971A,
// blockSeparation 2 (tabelas de hash de 2 blocos) e `allocated` blocos de dados. Com 70 blocos o
// pacote completo tem 0xA000 + 72 * 0x1000 = 335872 bytes, o tamanho do manifesto.
function stfsProfile(allocated, sizeBytes = 0xa000 + (allocated + 2) * 0x1000) {
  const data = Buffer.alloc(sizeBytes);
  data.write("CON ", 0, "latin1");
  data.writeUInt32BE(0x971a, 0x340);
  data.writeUInt32BE(0x00010000, 0x344);
  data[0x379] = 0x24;
  data[0x37b] = 2;
  data.writeUInt32BE(allocated, 0x395);
  return data;
}

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
  write(root, EXPLOIT_PROFILE[0].path, stfsProfile(70));
  assert.equal(stfsProfile(70).length, EXPLOIT_PROFILE[0].sizeBytes);
  assert.equal(await detectPreparedDeviceState(root, EXPLOIT_PROFILE), "preparado-bloqueado-lt");
});

// O caso do cliente 32822140117221@lid: HD preparado em "Xbox Bloqueado ou LT", usado no console
// (jogou FIFA e Amped 3), e de volta ao PC a tela dizia que era RGH sem o perfil do exploit. O
// console regrava o pacote do perfil e ele cresce; o tamanho do manifesto deixa de bater.
test("perfil que o console aumentou continua sendo o perfil do exploit", async (t) => {
  const root = temp(t);
  write(root, ".xbox-downloader/ready-to-play-v4.marker", "marker");
  write(root, EXPLOIT_PROFILE[0].path, stfsProfile(71));
  assert.equal(await detectPreparedDeviceState(root, EXPLOIT_PROFILE), "preparado-bloqueado-lt");
});

test("perfil truncado nao passa por perfil gravado", async (t) => {
  const root = temp(t);
  write(root, ".xbox-downloader/ready-to-play-v4.marker", "marker");
  write(root, EXPLOIT_PROFILE[0].path, stfsProfile(71, stfsProfile(71).length - 0x1000));
  assert.equal(await detectPreparedDeviceState(root, EXPLOIT_PROFILE), "preparado-rgh");
  write(root, EXPLOIT_PROFILE[0].path, stfsProfile(70).subarray(0, 0x100));
  assert.equal(await detectPreparedDeviceState(root, EXPLOIT_PROFILE), "preparado-rgh");
});

test("arquivo que nao e pacote STFS nao passa por perfil, nem com o tamanho do manifesto", async (t) => {
  const root = temp(t);
  write(root, ".xbox-downloader/ready-to-play-v4.marker", "marker");
  write(root, EXPLOIT_PROFILE[0].path, Buffer.alloc(EXPLOIT_PROFILE[0].sizeBytes));
  assert.equal(await detectPreparedDeviceState(root, EXPLOIT_PROFILE), "preparado-rgh");
});

// O perfil real do pacote (gitignored; `npm run payload:update` o traz): a conta do cabeçalho tem de
// dar exatamente o tamanho dele, e ele sem o último bloco tem de ser recusado.
test("o perfil real do pacote confere pelo proprio cabecalho", async (t) => {
  const assetsRoot = path.resolve(__dirname, "../../assets");
  const index = JSON.parse(fs.readFileSync(path.join(assetsRoot, "badavatar-package.json"), "utf8"));
  const bundled = path.join(assetsRoot, index.directoryName, ...EXPLOIT_PROFILE[0].path.split("/"));
  if (!fs.existsSync(bundled)) return t.skip("pacote BadAvatar ausente");
  const profile = fs.readFileSync(bundled);
  const root = temp(t);
  write(root, ".xbox-downloader/ready-to-play-v4.marker", "marker");
  write(root, EXPLOIT_PROFILE[0].path, profile);
  assert.equal(await detectPreparedDeviceState(root, EXPLOIT_PROFILE), "preparado-bloqueado-lt");
  write(root, EXPLOIT_PROFILE[0].path, profile.subarray(0, profile.length - 0x1000));
  assert.equal(await detectPreparedDeviceState(root, EXPLOIT_PROFILE), "preparado-rgh");
});

// Manifesto ilegivel: sem poder conferir, o assistente tem de perguntar o modo do console — nunca
// afirmar que o desbloqueio esta la.
test("sem o perfil do pacote para conferir, nada e declarado desbloqueado", async (t) => {
  const root = temp(t);
  write(root, "Aurora/default.xex", "aurora");
  write(root, "launch.ini", "[Paths]");
  write(root, EXPLOIT_PROFILE[0].path, stfsProfile(70));
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
