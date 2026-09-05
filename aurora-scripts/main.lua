scriptTitle       = "Xbox 360 Companion"
scriptAuthor      = "Nesquin/david12549 & ghosty99"
scriptVersion     = "2.12.67"
scriptDescription = "Browse and install Xbox 360, Original, Digital (XBLA/DLC), and Retro ROMs via Minerva Archive, Internet Archive, or EdgeEmu!"
scriptIcon        = "icon\\icon.xur"
scriptPermissions = { "http", "filesystem" }

require("menu_system")
require("state")
require("http_client")
require("services")
require("menu")

-- ==============================
-- ENTRY POINT
-- ==============================

function main()
    -- Step 1: Build SERVER_BASE / FILES_URL from state.lua values.
    -- Electron FTP deployment now patches BRAIN_IP and PORT directly in state.lua.
    initServerURL()

    -- Step 2: Network and server connectivity checks.
    if not Aurora.HasInternetConnection() then
        showError("NO_NETWORK")
        return
    end

    local basePath = Script.GetBasePath()
    absoluteDownloadsPath = basePath .. DOWNLOAD_FOLDER .. "\\"

    local mkOk = pcall(FileSystem.CreateDirectory, absoluteDownloadsPath)
    if not mkOk then
        Script.ShowMessageBox("Error",
            "Failed to create directory:\n" .. absoluteDownloadsPath ..
            "\n\nPlease check storage permissions.",
            "OK")
        return
    end

    -- Step 3: Register this console's FTP IP with the brain.
    registerConsoleFTP()

    -- Step 4: Show main menu.
    showMainMenu()
end
