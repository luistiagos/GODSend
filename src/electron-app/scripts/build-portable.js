const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const electronBuilderCli = path.join(
  __dirname,
  "..",
  "node_modules",
  "electron-builder",
  "cli.js",
);

const rootDir = path.resolve(__dirname, "../../..");
const distDir = path.join(rootDir, "dist");
const pkg = require(path.join(__dirname, "..", "package.json"));
const version = pkg.version;

const argv = process.argv.slice(2);
let arches = ["x64"];
if (argv.includes("--all") || argv.includes("all")) {
  arches = ["x64", "ia32"];
} else if (argv.includes("--ia32") || argv.includes("ia32") || argv.includes("386")) {
  arches = ["ia32"];
} else if (argv.includes("--x64") || argv.includes("x64") || argv.includes("amd64")) {
  arches = ["x64"];
}

for (const arch of arches) {
  console.log(`\n[build-portable] Building Windows portable for ${arch}...`);
  const result = spawnSync(
    process.execPath,
    [
      "--disable-warning=DEP0190",
      electronBuilderCli,
      "--win",
      "portable",
      `--${arch}`,
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
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  // If x64 was built, also provide the unadorned version for legacy tooling
  if (arch === "x64") {
    const archFile = path.join(distDir, `xbox-360-companion-Portable-${version}-x64.exe`);
    const legacyFile = path.join(distDir, `xbox-360-companion-Portable-${version}.exe`);
    if (fs.existsSync(archFile)) {
      fs.copyFileSync(archFile, legacyFile);
      console.log(`[build-portable] Copied ${path.basename(archFile)} → ${path.basename(legacyFile)}`);
    }
  }
}

