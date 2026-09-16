import { app, protocol } from "electron";
import { getAppDataDir } from "./services/appDataPath";

// Lock in the app-data directory before any other module reads userData.
// Portable Windows builds default to <exe-dir>/godsend-data; everything else
// stays on the OS platform default unless the user picked an override.
app.setPath("userData", getAppDataDir());

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Another instance is already running with this userData. Quit immediately
  // to avoid competing for USB polling, GODSEND_HOME, scratch dirs and binaries.
  app.quit();
} else {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "godsend-aurora",
      privileges: {
        standard:        true,
        secure:          true,
        supportFetchAPI: true,
        corsEnabled:     true,
      },
    },
  ]);

  const { bootstrapApp } = require("./app/bootstrap");
  bootstrapApp();
}

