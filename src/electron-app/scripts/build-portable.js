const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// electron-builder's CLI, compiling build/portable.nsi instead of its own template.
const launcherHook = path.join(__dirname, "portable-launcher-hook.js");

const rootDir = path.resolve(__dirname, "../../..");
const distDir = path.join(rootDir, "dist");
const pkg = require(path.join(__dirname, "..", "package.json"));
const version = pkg.version;

// Everything after `--` goes to electron-builder as is. The launcher test uses
// it to package a stand-in app into a temp folder.
const separator = process.argv.indexOf("--", 2);
const argv = process.argv.slice(2, separator === -1 ? undefined : separator);
const builderArgs = separator === -1 ? [] : process.argv.slice(separator + 1);
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
      launcherHook,
      "--win",
      "portable",
      `--${arch}`,
      ...builderArgs,
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
  if (arch === "x64" && builderArgs.length === 0) {
    const archFile = path.join(distDir, `xbox-360-companion-Portable-${version}-x64.exe`);
    const legacyFile = path.join(distDir, `xbox-360-companion-Portable-${version}.exe`);
    if (fs.existsSync(archFile)) {
      fs.copyFileSync(archFile, legacyFile);
      console.log(`[build-portable] Copied ${path.basename(archFile)} → ${path.basename(legacyFile)}`);
    }
  }
}

