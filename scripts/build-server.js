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

console.log("\n[build-server] windows/amd64 → dist/godsend.exe");
run("go", ["build", "-o", path.join(dist, "godsend.exe"), "."], {
  cwd: serverDir,
  shell: false,
  env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
});

run(process.execPath, [path.join(__dirname, "verify-go-binaries.js"), "windows"], {
  cwd: root,
  env: process.env,
});
