const { spawnSync } = require("node:child_process");
const path = require("node:path");

const electronBuilderCli = path.join(
  __dirname,
  "..",
  "node_modules",
  "electron-builder",
  "cli.js",
);

const result = spawnSync(
  process.execPath,
  [
    "--disable-warning=DEP0190",
    electronBuilderCli,
    "--win",
    "portable",
    "--x64",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      // The bundled fixed payload is large and 7-Zip starts many worker threads.
      // Level 1 keeps the portable compressed without exhausting commit memory.
      ELECTRON_BUILDER_COMPRESSION_LEVEL: "1",
    },
  },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
