#!/usr/bin/env node
/**
 * Cross-compile the Go server for Android (ARM64).
 * Writes dist/godsend-android-arm64
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const serverDir = path.join(root, "src", "server");

fs.mkdirSync(dist, { recursive: true });

const target = ["android", "arm64", "godsend-android-arm64"];
const [goos, goarch, name] = target;
const out = path.join(dist, name);

console.log(`\n[build-android] Cross-compiling Go backend: ${goos}/${goarch} -> dist/${name}`);

const r = spawnSync("go", ["build", "-o", out, "."], {
  cwd: serverDir,
  stdio: "inherit",
  env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: "0" },
  shell: false,
});

if (r.status !== 0) {
  console.error("[build-android] Failed to build Go binary for Android arm64");
  process.exit(r.status ?? 1);
}

console.log(`[build-android] Successfully built dist/${name}`);
