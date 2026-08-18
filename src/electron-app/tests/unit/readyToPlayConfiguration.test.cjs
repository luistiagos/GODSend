const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AURORA_READY_TO_PLAY_FILTER_PATH,
  generateAuroraReadyToPlayFilterLua,
  generateReadyToPlayLaunchIni,
  generateReadyToPlayMarker,
  READY_TO_PLAY_MARKER_PATH,
} = require("../../infrastructure/readyToPlayConfiguration.js");

test("configuracao pronta para jogar gera launch.ini canonico", () => {
  assert.equal(
    generateReadyToPlayLaunchIni(),
    "[Paths]\r\nDefault = Usb:\\Aurora\\default.xex\r\n\r\n[Settings]\r\nnoupdater = true\r\nliveblock = true\r\nlivestrong = false\r\n",
  );
});

test("hook carregado pelo Aurora identifica o pendrive e registra os caminhos de jogos", () => {
  const lua = generateAuroraReadyToPlayFilterLua();

  assert.equal(
    AURORA_READY_TO_PLAY_FILTER_PATH,
    "Aurora/User/Scripts/Content/Filters/XboxCompanionReady.lua",
  );
  assert.equal(READY_TO_PLAY_MARKER_PATH, ".xbox-downloader/ready-to-play-v2.marker");
  assert.equal(generateReadyToPlayMarker(), "xbox-companion-ready-to-play-v2\r\n");
  assert.match(lua, /FileSystem\.GetDrives\(false\)/);
  assert.match(lua, /string\.sub\(mountPoint, 1, 5\) == "game:"/);
  assert.match(lua, /normalizedSerial/);
  assert.match(lua, /ready-to-play-v2\.marker/);
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
