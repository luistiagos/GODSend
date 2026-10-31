const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AURORA_READY_TO_PLAY_FILTER_PATH,
  generateAuroraReadyToPlayFilterLua,
  generateReadyToPlayLaunchIni,
  generateReadyToPlayMarker,
  READY_TO_PLAY_MARKER_PATH,
  READY_TO_PLAY_RESTART_GUARD_PATH,
  READY_TO_PLAY_TU_SCAN_ATTEMPT_PATH,
} = require("../../infrastructure/readyToPlayConfiguration.js");
const { lua, lauxlib, lualib, to_luastring } = require("fengari");
const initSqlJs = require("sql.js");

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
  assert.equal(READY_TO_PLAY_MARKER_PATH, ".xbox-downloader/ready-to-play-v5.marker");
  assert.equal(generateReadyToPlayMarker(), "xbox-companion-ready-to-play-v5\r\n");
  assert.match(lua, /FileSystem\.GetDrives\(false\)/);
  assert.match(lua, /string\.sub\(mountPoint, 1, 5\) == "game:"/);
  assert.match(lua, /normalizedSerial/);
  assert.match(lua, /ready-to-play-v5\.marker/);
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

test("marcas gravadas pelo console seguem a versao da configuracao", () => {
  const lua = generateAuroraReadyToPlayFilterLua();

  assert.equal(READY_TO_PLAY_RESTART_GUARD_PATH, ".xbox-downloader/ready-to-play-v5.restart");
  assert.equal(READY_TO_PLAY_TU_SCAN_ATTEMPT_PATH, ".xbox-downloader/ready-to-play-v5.tuscan");
  assert.match(lua, /local RESTART_GUARD_PATH = "\.xbox-downloader\\\\ready-to-play-v5\.restart"/);
  assert.match(lua, /local TU_SCAN_ATTEMPT_PATH = "\.xbox-downloader\\\\ready-to-play-v5\.tuscan"/);
  assert.doesNotMatch(lua, /TUScanAutoStart/);
});

// ---------------------------------------------------------------------------
// O hook executado de verdade (fengari, Lua 5.3; a Aurora e 5.1) contra um console falso: cada
// boot e um estado Lua novo, e o banco (sql.js) e os arquivos do pendrive persistem entre boots.
// O esquema imita o da Aurora: SystemSettings fica no settings.db, anexado como Config.
// ---------------------------------------------------------------------------

const ROOT = "Game:\\";
const SERIAL = "ABC123";
const onDevice = (relative) => ROOT + relative.replaceAll("/", "\\");
const GUARD = onDevice(READY_TO_PLAY_RESTART_GUARD_PATH);
const ATTEMPT = onDevice(READY_TO_PLAY_TU_SCAN_ATTEMPT_PATH);

async function createConsole(extraFiles = []) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE ScanPaths (Id INTEGER PRIMARY KEY AUTOINCREMENT, Path TEXT, DeviceId TEXT, Depth INTEGER, ScriptData TEXT, OptionsFlag INTEGER)");
  db.run("ATTACH ':memory:' AS Config");
  db.run("CREATE TABLE Config.SystemSettings (Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT, Value TEXT, UNIQUE(Name))");
  return {
    db,
    files: new Set([onDevice("Aurora/default.xex"), onDevice(READY_TO_PLAY_MARKER_PATH), ...extraFiles]),
    failExecute: () => false,
    failFetch: () => false,
    writable: true,
  };
}

function tuScanAtBoot(console) {
  const rows = console.db.exec("SELECT Value FROM SystemSettings WHERE Name = 'TUScanAtBoot'");
  return rows.length === 0 ? null : rows[0].values[0][0];
}

/** O que a propria Aurora faz: fim da varredura grava 0; "Procurar agora" grava 1. */
function setTuScanAtBoot(console, value) {
  console.db.run("INSERT OR REPLACE INTO SystemSettings (Name, Value) VALUES ('TUScanAtBoot', ?)", [value]);
}

function pushValue(L, value) {
  if (value === null || value === undefined) lua.lua_pushnil(L);
  else if (typeof value === "boolean") lua.lua_pushboolean(L, value);
  else if (typeof value === "number") lua.lua_pushnumber(L, value);
  else if (typeof value === "string") lua.lua_pushstring(L, to_luastring(value));
  else if (Array.isArray(value)) {
    lua.lua_createtable(L, value.length, 0);
    value.forEach((item, index) => {
      pushValue(L, item);
      lua.lua_rawseti(L, -2, index + 1);
    });
  } else {
    lua.lua_createtable(L, 0, 0);
    for (const [key, item] of Object.entries(value)) {
      pushValue(L, item);
      lua.lua_setfield(L, -2, to_luastring(key));
    }
  }
}

function setLibrary(L, name, functions) {
  lua.lua_createtable(L, 0, 0);
  for (const [key, fn] of Object.entries(functions)) {
    lua.lua_pushjsfunction(L, (state) => {
      const args = [];
      for (let i = 1; i <= lua.lua_gettop(state); i++) {
        args.push(lua.lua_type(state, i) === lua.LUA_TSTRING ? lua.lua_tojsstring(state, i) : lua.lua_toboolean(state, i));
      }
      const result = fn(...args);
      if (result === undefined) return 0;
      pushValue(state, result);
      return 1;
    });
    lua.lua_setfield(L, -2, to_luastring(key));
  }
  lua.lua_setglobal(L, to_luastring(name));
}

function boot(console) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const logs = [];
  let restarts = 0;

  lua.lua_pushjsfunction(L, (state) => {
    logs.push(lauxlib.luaL_tolstring(state, 1) && lua.lua_tojsstring(state, -1));
    return 0;
  });
  lua.lua_setglobal(L, to_luastring("print"));

  setLibrary(L, "FileSystem", {
    GetDrives: () => [
      { MountPoint: "Game:", Serial: `_${SERIAL}` },
      { MountPoint: "Usb0:", Serial: SERIAL },
    ],
    FileExists: (path) => console.files.has(path),
    WriteFile: (path) => {
      if (console.writable) console.files.add(path);
      return console.writable;
    },
    DeleteFile: (path) => console.files.delete(path),
  });
  setLibrary(L, "Sql", {
    Execute: (query) => {
      if (console.failExecute(query)) return false;
      try {
        console.db.run(query);
        return true;
      } catch {
        return false;
      }
    },
    ExecuteFetchRows: (query) => {
      if (console.failFetch(query)) return null;
      try {
        const statement = console.db.prepare(query);
        const rows = [];
        while (statement.step()) rows.push(statement.getAsObject());
        statement.free();
        return rows;
      } catch {
        return null;
      }
    },
  });
  setLibrary(L, "Aurora", { Restart: () => void restarts++ });

  if (lauxlib.luaL_dostring(L, to_luastring(generateAuroraReadyToPlayFilterLua())) !== lua.LUA_OK) {
    throw new Error(`hook nao executou: ${lua.lua_tojsstring(L, -1)}`);
  }
  // Um erro dentro do pcall vira esta linha; nos cenarios abaixo ela nunca e esperada.
  assert.ok(!logs.some((line) => line.includes("falha ao configurar jogos")), logs.join("\n"));
  return { restarted: restarts > 0, restarts, logs };
}

test("pendrive novo: o boot que cadastra reinicia, a primeira varredura corre e, terminada, nada mais muda", async () => {
  const console = await createConsole();

  const first = boot(console);
  assert.equal(first.restarts, 1);
  assert.ok(!console.files.has(ATTEMPT), "o boot que reinicia nao chega a varredura");
  assert.equal(console.db.exec("SELECT COUNT(*) FROM ScanPaths")[0].values[0][0], 2);

  assert.equal(boot(console).restarted, false);
  assert.ok(console.files.has(ATTEMPT), "o boot que vai varrer deixa a marca de tentativa");
  assert.ok(!console.files.has(GUARD));

  setTuScanAtBoot(console, "0");
  assert.equal(boot(console).restarted, false);
  assert.ok(!console.files.has(ATTEMPT), "varredura concluida: a marca some");
  assert.equal(tuScanAtBoot(console), "0");
});

test("varredura interrompida: o boot seguinte apaga TUScanAtBoot e reinicia uma vez so", async () => {
  const console = await createConsole();
  boot(console);
  boot(console);
  // desligou na tela de carga: a Aurora nao gravou 0

  const third = boot(console);
  assert.equal(third.restarts, 1);
  assert.equal(tuScanAtBoot(console), "0");
  assert.ok(!console.files.has(ATTEMPT));
  assert.ok(console.files.has(GUARD));
  assert.ok(third.logs.some((line) => line.includes("varredura de Title Updates anterior interrompida")));

  assert.equal(boot(console).restarted, false);
  assert.ok(!console.files.has(GUARD));
  assert.ok(!console.files.has(ATTEMPT));

  // "Procurar agora" grava 1: vira uma tentativa normal, sem reinicio
  setTuScanAtBoot(console, "1");
  assert.equal(boot(console).restarted, false);
  assert.ok(console.files.has(ATTEMPT));
  setTuScanAtBoot(console, "0");
  assert.equal(boot(console).restarted, false);
  assert.ok(!console.files.has(ATTEMPT));
});

test("se o 0 gravado nao persistir, nao ha laco de reinicio", async () => {
  const console = await createConsole();
  boot(console);
  boot(console);
  assert.equal(boot(console).restarts, 1);

  // A Aurora regrava o 1 da memoria: o boot seguinte e uma tentativa nova, nao outro reinicio.
  setTuScanAtBoot(console, "1");
  assert.equal(boot(console).restarted, false);
  assert.ok(console.files.has(ATTEMPT));
});

test("marca de reinicio ja presente: apaga TUScanAtBoot sem reiniciar", async () => {
  // O cadastro dos caminhos nao sobreviveu ao reinicio anterior e havia uma tentativa pendente.
  const console = await createConsole([GUARD, ATTEMPT]);

  const result = boot(console);
  assert.equal(result.restarted, false);
  assert.equal(tuScanAtBoot(console), "0");
  assert.ok(result.logs.some((line) => line.includes("TUScanAtBoot apagado sem reiniciar")));
});

test("cadastro que nao persiste nao reinicia em laco", async () => {
  const console = await createConsole();
  assert.equal(boot(console).restarts, 1);
  for (let i = 0; i < 3; i++) {
    console.db.run("DELETE FROM ScanPaths");
    const result = boot(console);
    assert.equal(result.restarted, false);
    assert.ok(result.logs.some((line) => line.includes("caminhos recadastrados sem reiniciar")));
  }
});

test("falhas de Sql ou de escrita devolvem o comportamento de hoje, sem reinicio nem erro", async () => {
  const executeFails = await createConsole();
  boot(executeFails);
  boot(executeFails);
  executeFails.failExecute = (query) => query.includes("SystemSettings");
  const afterExecute = boot(executeFails);
  assert.equal(afterExecute.restarted, false);
  assert.equal(tuScanAtBoot(executeFails), null);
  assert.ok(afterExecute.logs.some((line) => line.includes("falha ao apagar TUScanAtBoot")));

  const fetchFails = await createConsole();
  boot(fetchFails);
  boot(fetchFails);
  fetchFails.failFetch = (query) => query.includes("SystemSettings");
  const afterFetch = boot(fetchFails);
  assert.equal(afterFetch.restarted, false);
  assert.equal(tuScanAtBoot(fetchFails), null);
  assert.ok(afterFetch.logs.some((line) => line.includes("TUScanAtBoot ilegivel")));

  const readOnly = await createConsole();
  readOnly.writable = false;
  for (let i = 0; i < 4; i++) assert.equal(boot(readOnly).restarted, false);
  assert.equal(tuScanAtBoot(readOnly), null);
});
