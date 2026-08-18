#!/usr/bin/env node
// Cross-platform replacement for the bash-style build:server npm script.
// Sets GOOS/GOARCH/CGO_ENABLED via spawnSync env — works on Windows, macOS, Linux.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const serverDir = path.join(root, "src", "server");

function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run(process.execPath, [path.join(__dirname, "download-aria2.js")], { cwd: root, env: process.env });
run(process.execPath, [path.join(__dirname, "download-fat32format.js")], { cwd: root, env: process.env });

fs.mkdirSync(dist, { recursive: true });

const argv = process.argv.slice(2);
const buildX64 = argv.length === 0 || argv.includes("x64") || argv.includes("amd64") || argv.includes("--x64") || argv.includes("all");
const buildIa32 = argv.length === 0 || argv.includes("ia32") || argv.includes("386") || argv.includes("--ia32") || argv.includes("all");

if (buildX64) {
  console.log("\n[build-server] windows/amd64 → dist/godsend-windows-x64.exe (and dist/godsend.exe)");
  const x64Out = path.join(dist, "godsend-windows-x64.exe");
  run("go", ["build", "-o", x64Out, "."], {
    cwd: serverDir,
    shell: false,
    env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
  });
  fs.copyFileSync(x64Out, path.join(dist, "godsend.exe"));
}

if (buildIa32) {
  console.log("\n[build-server] windows/386 → dist/godsend-windows-ia32.exe");
  const ia32Out = path.join(dist, "godsend-windows-ia32.exe");
  run("go", ["build", "-o", ia32Out, "."], {
    cwd: serverDir,
    shell: false,
    env: { ...process.env, GOOS: "windows", GOARCH: "386", CGO_ENABLED: "0" },
  });
}

run(process.execPath, [path.join(__dirname, "verify-go-binaries.js"), "windows-all"], {
  cwd: root,
  env: process.env,
});
