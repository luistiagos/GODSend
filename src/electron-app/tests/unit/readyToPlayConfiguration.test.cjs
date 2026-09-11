const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AURORA_READY_TO_PLAY_FILTER_PATH,
  generateAuroraReadyToPlayFilterLua,
  generateReadyToPlayLaunchIni,
  generateReadyToPlayMarker,
  READY_TO_PLAY_MARKER_PATH,
  READY_TO_PLAY_RESTART_GUARD_PATH,
} = require("../../infrastructure/readyToPlayConfiguration.js");

test("configuracao pronta para jogar gera launch.ini canonico", () => {
  assert.equal(
    generateReadyToPlayLaunchIni(),
    "[Paths]\r\nDefault = Usb:\\Aurora\\default.xex\r\nDumpfile = Usb:\\crashlog.txt\r\n\r\n[Settings]\r\nnoupdater = true\r\nliveblock = true\r\nlivestrong = false\r\n",
  );
});

test("launch.ini aponta o dump do DashLaunch para o proprio pendrive", () => {
  const ini = generateReadyToPlayLaunchIni();
  const paths = ini.slice(ini.indexOf("[Paths]"), ini.indexOf("[Settings]"));

  // Dumpfile so vale dentro de [Paths]; fora dela o DashLaunch ignora e a excecao
  // interceptada continua saindo apenas pela UART.
  assert.match(paths, /^Dumpfile = Usb:\\crashlog\.txt$/m);
});

test("hook carregado pelo Aurora identifica o pendrive e registra os caminhos de jogos", () => {
  const lua = generateAuroraReadyToPlayFilterLua();

  assert.equal(
    AURORA_READY_TO_PLAY_FILTER_PATH,
    "Aurora/User/Scripts/Content/Filters/XboxCompanionReady.lua",
  );
  assert.equal(READY_TO_PLAY_MARKER_PATH, ".xbox-downloader/ready-to-play-v4.marker");
  assert.equal(generateReadyToPlayMarker(), "xbox-companion-ready-to-play-v4\r\n");
  assert.match(lua, /FileSystem\.GetDrives\(false\)/);
  assert.match(lua, /string\.sub\(mountPoint, 1, 5\) == "game:"/);
  assert.match(lua, /normalizedSerial/);
  assert.match(lua, /ready-to-play-v4\.marker/);
  assert.match(lua, /Aurora\\\\default\.xex/);
  assert.match(lua, /path = "\\\\games", depth = 6/);
  assert.match(lua, /path = "\\\\Content\\\\0000000000000000", depth = 5/);
  assert.match(lua, /SELECT id, path, deviceid, depth FROM scanpaths/);
  assert.match(lua, /INSERT INTO scanpaths/);
  assert.match(lua, /UPDATE scanpaths SET depth=/);
  assert.match(lua, /Aurora\.Restart\(\)/);
  assert.doesNotMatch(lua, /Content\.StartScan\(\)/);
  assert.doesNotMatch(lua, /Usb[0-9]:/);
});

test("cadastro reconhece o mesmo dispositivo quando o serial vem prefixado por _", () => {
  const lua = generateAuroraReadyToPlayFilterLua();

  // O mesmo pendrive aparece duas vezes na lista de drives: Usb0: com o serial fisico e
  // Game: com o mesmo serial prefixado por "_". Comparar o deviceid cru faria a linha ja
  // gravada parecer de outro aparelho, e o hook inseriria um caminho duplicado a cada boot.
  assert.match(lua, /normalizedSerial\(rowDeviceId\) == normalizedSerial\(deviceId\)/);
  assert.doesNotMatch(lua, /rowDeviceId == deviceId/);
});

test("hook reinicia o Aurora no maximo uma vez por cadastro", () => {
  const lua = generateAuroraReadyToPlayFilterLua();

  assert.equal(READY_TO_PLAY_RESTART_GUARD_PATH, ".xbox-downloader/ready-to-play-v4.restart");
  assert.match(lua, /local RESTART_GUARD_PATH = "\.xbox-downloader\\\\ready-to-play-v4\.restart"/);
  assert.match(lua, /local guardPath = root \.\. RESTART_GUARD_PATH/);

  const clearsGuard = lua.indexOf("FileSystem.DeleteFile(guardPath)");
  const skipsRestart = lua.indexOf("caminhos recadastrados sem reiniciar");
  const writesGuard = lua.indexOf("FileSystem.WriteFile(guardPath");
  const confirmsGuard = lua.indexOf("if not FileSystem.FileExists(guardPath) then");
  const restarts = lua.indexOf("Aurora.Restart()");

  // A ordem e a correcao: um cadastro que se repete encontra a marca do reinicio anterior e
  // desiste (senao o console reinicia a cada boot), e o reinicio so acontece depois que a
  // marca esta comprovadamente gravada no pendrive.
  assert.ok(clearsGuard > 0, "o cadastro intacto precisa apagar a marca");
  assert.ok(skipsRestart > clearsGuard, "o cadastro repetido precisa sair sem reiniciar");
  assert.ok(writesGuard > skipsRestart, "a marca e gravada depois da checagem de repeticao");
  assert.ok(confirmsGuard > writesGuard, "a marca gravada precisa ser conferida");
  assert.ok(restarts > confirmsGuard, "o reinicio so vem depois da marca conferida");
});
