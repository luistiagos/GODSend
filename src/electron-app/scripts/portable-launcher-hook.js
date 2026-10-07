// electron-builder's CLI with build/portable.nsi in place of its own portable
// template. build-portable.js runs this file where it would run
// electron-builder/cli.js; the arguments are the CLI's.
//
// electron-builder compiles the portable .exe from its own NSIS template and
// offers no way to replace it: `script` and `include` are only read for the
// installer target. This swaps in build/portable.nsi at the one place where the
// template text is handed to makensis. Why the launcher is ours: see the header
// of build/portable.nsi.
//
// An entry point, not a `node -r` preload: electron-builder forks helper
// processes (the native module rebuild) that inherit node's options, and the
// hook loaded in them failed the build.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const appDir = path.join(__dirname, "..");
const launcherScript = path.join(appDir, "build", "portable.nsi");

// The copy of app-builder-lib that this electron-builder will load.
const builderDir = path.dirname(require.resolve("electron-builder/package.json", { paths: [appDir] }));
const libDir = path.dirname(require.resolve("app-builder-lib/package.json", { paths: [builderDir] }));
const upstreamTemplate = path.join(libDir, "templates", "nsis", "portable.nsi");
// The template build/portable.nsi was derived from (app-builder-lib 26.8.1).
const UPSTREAM_TEMPLATE_SHA256 = "80fa75cf8cb68f4999eb92afc9f37f8e5b605cb1c3a077821bbc350a9b907a48";

// The entry point first: app-builder-lib's modules import each other in a
// cycle that only resolves when loading starts there.
require(libDir);
const { NsisTarget } = require(path.join(libDir, "out", "targets", "nsis", "NsisTarget.js"));

const computeFinalScript = NsisTarget.prototype.computeFinalScript;
if (typeof computeFinalScript !== "function") {
  throw new Error("[portable-launcher-hook] NsisTarget.computeFinalScript is gone: electron-builder changed, the launcher cannot be swapped in");
}

let compiled = false;
NsisTarget.prototype.computeFinalScript = async function (originalScript, isInstaller, archs) {
  if (!this.isPortable) return computeFinalScript.call(this, originalScript, isInstaller, archs);

  const upstream = fs.readFileSync(upstreamTemplate);
  const sha256 = crypto.createHash("sha256").update(upstream).digest("hex");
  if (sha256 !== UPSTREAM_TEMPLATE_SHA256 || originalScript !== upstream.toString("utf8")) {
    throw new Error(
      `[portable-launcher-hook] ${upstreamTemplate} is not the template build/portable.nsi was derived from ` +
        `(sha256 ${sha256}, expected ${UPSTREAM_TEMPLATE_SHA256}). Compare the two, carry over what changed, ` +
        "then update UPSTREAM_TEMPLATE_SHA256."
    );
  }

  compiled = true;
  console.log(`[portable-launcher-hook] compiling ${path.relative(appDir, launcherScript)}`);
  return computeFinalScript.call(this, fs.readFileSync(launcherScript, "utf8"), isInstaller, archs);
};

// A build that ends well without passing through here shipped the template.
process.on("exit", (code) => {
  if (code === 0 && !compiled) {
    console.error("[portable-launcher-hook] the build finished without compiling build/portable.nsi");
    process.exitCode = 1;
  }
});

require(path.join(builderDir, "cli.js"));
