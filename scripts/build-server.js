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

// Automatically include standard Go install locations in PATH if not already present
for (const p of ["C:\\Program Files\\Go\\bin", "C:\\Go\\bin", path.join(process.env.USERPROFILE || "", "go", "bin")]) {
  if (fs.existsSync(p) && !(process.env.PATH || "").toLowerCase().includes(p.toLowerCase())) {
    process.env.PATH = `${p};${process.env.PATH || ""}`;
  }
}

const argv = process.argv.slice(2);
const buildX64 = argv.length === 0 || argv.includes("x64") || argv.includes("amd64") || argv.includes("--x64") || argv.includes("all");
const buildIa32 = argv.length === 0 || argv.includes("ia32") || argv.includes("386") || argv.includes("--ia32") || argv.includes("all");

function hasGo() {
  try {
    const r = spawnSync("go", ["version"], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

const goAvailable = hasGo();

if (buildX64) {
  const x64Out = path.join(dist, "godsend-windows-x64.exe");
  const defaultExe = path.join(dist, "godsend.exe");
  if (goAvailable) {
    console.log("\n[build-server] windows/amd64 → dist/godsend-windows-x64.exe (and dist/godsend.exe)");
    run("go", ["build", "-o", x64Out, "."], {
      cwd: serverDir,
      shell: false,
      env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
    });
    fs.copyFileSync(x64Out, defaultExe);
  } else {
    if (fs.existsSync(x64Out) || fs.existsSync(defaultExe)) {
      console.warn("\n[build-server] 'go' not found in PATH — reusing existing prebuilt Windows x64 binary in dist/");
      if (!fs.existsSync(x64Out) && fs.existsSync(defaultExe)) {
        fs.copyFileSync(defaultExe, x64Out);
      } else if (fs.existsSync(x64Out) && !fs.existsSync(defaultExe)) {
        fs.copyFileSync(x64Out, defaultExe);
      }
    } else {
      console.error("\n[build-server] Error: 'go' is not installed or not in PATH and no prebuilt dist/godsend-windows-x64.exe was found.");
      console.error("Install Go with: winget install GoLang.Go (then restart terminal)");
      process.exit(1);
    }
  }
}

if (buildIa32) {
  const ia32Out = path.join(dist, "godsend-windows-ia32.exe");
  if (goAvailable) {
    console.log("\n[build-server] windows/386 → dist/godsend-windows-ia32.exe");
    run("go", ["build", "-o", ia32Out, "."], {
      cwd: serverDir,
      shell: false,
      env: { ...process.env, GOOS: "windows", GOARCH: "386", CGO_ENABLED: "0" },
    });
  } else {
    if (fs.existsSync(ia32Out)) {
      console.warn("\n[build-server] 'go' not found in PATH — reusing existing prebuilt Windows ia32 binary in dist/");
    } else {
      console.warn("\n[build-server] Notice: 'go' not found in PATH — skipping ia32 backend compilation (install Go to compile for 32-bit).");
    }
  }
}

run(process.execPath, [path.join(__dirname, "verify-go-binaries.js"), "windows-all"], {
  cwd: root,
  env: process.env,
});
