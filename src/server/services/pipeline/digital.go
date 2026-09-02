// digital.go — content install, generic game, and digital/XBLA/DLC/XBLIG processing.
package pipeline

import (
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"godsend/app"
	"godsend/infrastructure/ftp"
	"godsend/infrastructure/helpers"
	"godsend/models"
	"godsend/utils"
)

// ==========================================
// CONTENT INSTALL (Disc 2+ DLC path)
// ==========================================

func (s *Service) processContentInstallFromISO(gameName, safeName, isoPath string, xboxConn *models.XboxConnection) error {
	s.App.Logf("=== Content install: %s ===", gameName)

	s.App.LogStatus(gameName, "Processing", "Reading disc info...")
	info, err := utils.ProbeISODiscInfo(isoPath)
	if err != nil {
		s.App.LogStatus(gameName, "Error", fmt.Sprintf("Disc probe: %v", err))
		return fmt.Errorf("disc probe: %w", err)
	}
	titleID := fmt.Sprintf("%08X", info.TitleID)
	layout, layoutErr := utils.ProbeISOInstallLayout(isoPath, info)
	if layoutErr != nil {
		return fmt.Errorf("disc layout: %w", layoutErr)
	}
	if layout.ContentTitleID != 0 {
		if resolved := fmt.Sprintf("%08X", layout.ContentTitleID); resolved != titleID {
			s.App.Logf("Content install: XEX TitleID %s resolved to %s from embedded content", titleID, resolved)
			titleID = resolved
		}
	} else if models.IsContentDiscPlaceholderTitleID(info.TitleID) {
		if guessed := models.GuessTitleIDFromMultiDiscName(gameName); guessed != 0 {
			s.App.Logf("Content install: placeholder TitleID %s overridden to %08X from game name", titleID, guessed)
			titleID = fmt.Sprintf("%08X", guessed)
		} else {
			return fmt.Errorf("nao foi possivel resolver o Title ID real do disco de conteudo %q", gameName)
		}
	}
	s.App.Logf("Content install: TitleID=%s disc=%d/%d", titleID, info.DiscNumber, info.DiscCount)

	s.App.LogStatus(gameName, "Processing", "Extracting content files from ISO...")
	contentDir := filepath.Join(s.outputRoot(gameName), safeName+"_content")
	if err := s.extractContentResilient(gameName, isoPath, contentDir, info); err != nil {
		s.App.LogStatus(gameName, "Error", fmt.Sprintf("Content extract: %v", err))
		if xboxConn == nil || xboxConn.Mode != "local" {
			s.cleanupStageAfterRun(gameName, contentDir, xboxConn)
		}
		return fmt.Errorf("content extract: %w", err)
	}

	if xboxConn != nil && xboxConn.Mode == "ftp" {
		s.App.LogStatus(gameName, "Processing", "FTP Transfer starting...")
		if err := s.FTP.TransferContent(contentDir, xboxConn, gameName, titleID); err != nil {
			s.App.Logf("FTP: initial content transfer failed for %s: %v — scheduling for retry", gameName, err)
			gameDir := filepath.Join(s.App.ToolsDir, "Ready", safeName)
			job := ftp.PendingFTPJob{
				ID:        helpers.SanitizeFilename(gameName) + "_" + strconv.FormatInt(time.Now().UnixNano(), 36),
				GameName:  gameName,
				Type:      "content",
				SourceDir: contentDir,
				GameDir:   gameDir,
				XboxIP:    xboxConn.IP,
				Drive:     xboxConn.Drive,
				TitleID:   titleID,
				CreatedAt: time.Now(),
			}
			s.FTP.SchedulePendingFTP(job)
			return nil
		}
		os.RemoveAll(contentDir)
		s.App.LogFTPComplete(gameName, titleID, xboxConn.IP)
	} else if xboxConn != nil && xboxConn.Mode == "local" {
		s.App.LogStatus(gameName, "Processing", "Gravando no dispositivo...")
		if err := s.InstallContentLocal(contentDir, xboxConn.LocalRoot, gameName, titleID); err != nil {
			s.App.LogStatus(gameName, "Error", fmt.Sprintf("Gravação local: %v", err))
			return fmt.Errorf("gravacao local: %w", err)
		}
		os.RemoveAll(contentDir)
		os.RemoveAll(filepath.Join(s.App.ToolsDir, "Ready", safeName))
		s.App.LogLocalComplete(gameName, titleID, xboxConn.LocalRoot)
	} else {
		gameDir := filepath.Join(s.App.ToolsDir, "Ready", safeName)
		os.MkdirAll(gameDir, 0755)

		s.App.LogStatus(gameName, "Processing", "Packaging content for transfer...")
		partName := safeName + "_Part1.7z"
		if err := utils.CreateZipFromDir(contentDir, filepath.Join(gameDir, partName)); err != nil {
			s.App.LogStatus(gameName, "Error", fmt.Sprintf("Archive: %v", err))
			os.RemoveAll(contentDir)
			return fmt.Errorf("archive content: %w", err)
		}
		os.RemoveAll(contentDir)
		s.App.GamePartsMap.Store(gameName, []string{partName})
		relPath := fmt.Sprintf("Content\\0000000000000000\\%s\\00000002\\", titleID)
		s.updateGameINI_Content(gameDir, gameName, titleID, partName, relPath)
		s.App.LogStatus(gameName, "Ready", "Ready to Install")
	}
	s.App.Logf("=== Complete (Content): %s ===", gameName)
	return nil
}

// ==========================================
// GENERIC GAME PROCESSING (XBOX_360_* collections)
// ==========================================

func (s *Service) ProcessGenericGame(gameName string) {
	if err := s.ProcessGenericGameWithErr(gameName); err != nil {
		s.App.LogStatus(gameName, "Error", err.Error())
	}
}

// ProcessGenericGameWithErr runs the generic game pipeline and returns any error.
func (s *Service) ProcessGenericGameWithErr(gameName string) error {
	s.App.Logf("=== Generic Game: %s ===", gameName)
	safeName := helpers.SanitizeFilename(gameName)
	if safeName == "" {
		return fmt.Errorf("Invalid game name")
	}
	var xboxConn *models.XboxConnection
	if c, ok := s.App.XboxConnections.Load(gameName); ok {
		cc := c.(models.XboxConnection)
		xboxConn = &cc
	}
	gameDir := filepath.Join(s.App.ToolsDir, "Ready", safeName)
	os.MkdirAll(gameDir, 0755)

	s.App.LogStatus(gameName, "Processing", "Searching Internet Archive (Games)...")
	entry, err := s.IA.FindEntry(gameName, "games")
	if err != nil {
		s.App.Logf("ERROR [%s]: IA search failed: %v", gameName, err)
		return fmt.Errorf("IA search failed: %w", err)
	}
	downloadURL := app.IADownloadBase + entry.CollectionID + "/" + url.PathEscape(entry.FileName)
	s.App.Logf("IA Download: %s → %s", gameName, entry.FileName)

	archivePath := filepath.Join(s.App.TempDir, safeName+filepath.Ext(entry.FileName))
	if xboxConn != nil && xboxConn.Mode == "local" {
		archivePath = filepath.Join(gameDir, ".source"+filepath.Ext(entry.FileName))
	}
	s.App.LogStatus(gameName, "Processing", "Downloading from Internet Archive...")
	if err := s.Download.DownloadWithProgress(downloadURL, archivePath, gameName, app.IADownloadBase); err != nil {
		s.App.Logf("ERROR [%s]: IA download failed: %v", gameName, err)
		return fmt.Errorf("Download failed: %w", classifyLocalStorageFailure(xboxConn, "download-http", err))
	}
	if xboxConn == nil || xboxConn.Mode != "local" {
		defer os.Remove(archivePath)
	}

	s.App.LogStatus(gameName, "Processing", "Extracting archive...")
	extDir := filepath.Join(s.App.TempDir, safeName+"_ext")
	defer s.cleanupStageAfterRun(gameName, extDir, xboxConn)
	if err := s.extractArchiveResilient(gameName, archivePath, extDir); err != nil {
		return fmt.Errorf("Extract failed: %w", err)
	}

	installType := s.App.LookupInstallType(gameName)

	isoPath := helpers.FindFileByExt(extDir, ".iso")
	xexFolder := helpers.FindXEXFolder(extDir)
	if isoPath != "" && installType != "xex" {
		resolved, resolveErr := s.resolveISOInstallType(gameName, isoPath, installType)
		if resolveErr != nil {
			return resolveErr
		}
		installType = resolved
	}

	if installType == "xex" {
		folderName := ""
		if xexFolder != "" {
			folderName = filepath.Base(xexFolder)
		} else if isoPath != "" {
			isoXexDir := filepath.Join(s.outputRoot(gameName), safeName+"_xex")
			s.App.LogStatus(gameName, "Processing", "Extracting XEX layout from ISO...")
			if err := s.extractXEXResilient(gameName, isoPath, isoXexDir); err != nil {
				return fmt.Errorf("XEX extraction from ISO failed: %w", err)
			}
			defer s.cleanupStageAfterRun(gameName, isoXexDir, xboxConn)
			xexFolder = isoXexDir
			folderName = safeName
		} else {
			return fmt.Errorf("XEX install needs a loose game folder in the archive. Try GOD (ISO) or DLC (Disc 2 content ISO).")
		}
		s.App.LogStatus(gameName, "Processing", fmt.Sprintf("XEX folder: %s", folderName))
		if xboxConn != nil && xboxConn.Mode == "ftp" {
			if err := s.FTP.TransferXEX(xexFolder, folderName, xboxConn, gameName); err != nil {
				s.App.Logf("FTP: initial XEX transfer failed for %s: %v — scheduling for retry", gameName, err)
				job := ftp.PendingFTPJob{
					ID:         helpers.SanitizeFilename(gameName) + "_" + strconv.FormatInt(time.Now().UnixNano(), 36),
					GameName:   gameName,
					Type:       "xex",
					SourceDir:  xexFolder,
					GameDir:    gameDir,
					XboxIP:     xboxConn.IP,
					Drive:      xboxConn.Drive,
					FolderName: folderName,
					CreatedAt:  time.Now(),
				}
				s.FTP.SchedulePendingFTP(job)
			} else {
				os.RemoveAll(gameDir)
				s.App.LogFTPComplete(gameName, "", xboxConn.IP)
			}
		} else if xboxConn != nil && xboxConn.Mode == "local" {
			if err := s.InstallXEXLocal(xexFolder, folderName, xboxConn.LocalRoot, gameName); err != nil {
				return fmt.Errorf("Gravação local: %w", err)
			}
			os.RemoveAll(gameDir)
			tid := helpers.FindTitleIDInDir(xexFolder)
			s.App.LogLocalComplete(gameName, tid, xboxConn.LocalRoot)
		} else {
			partName := fmt.Sprintf("%s_Part1.7z", safeName)
			if err := utils.CreateZipFromDir(xexFolder, filepath.Join(gameDir, partName)); err != nil {
				return fmt.Errorf("Archive XEX: %w", err)
			}
			s.App.GamePartsMap.Store(gameName, []string{partName})
			s.updateGameINI_XEX(gameDir, gameName, folderName, partName)
			s.App.LogStatus(gameName, "Ready", "Ready to Install")
		}
		return nil
	}

	if installType == "content" {
		if isoPath == "" {
			return fmt.Errorf("DLC/content install needs an ISO. Pick XEX if this release is a loose-folder rip.")
		}
		return s.processContentInstallFromISO(gameName, safeName, isoPath, xboxConn)
	}

	// GOD (default): ISO → Games on Demand.
	if isoPath != "" {
		godDir := filepath.Join(s.outputRoot(gameName), safeName+"_GOD")
		return s.convertAndFinalizeGODResilient(gameName, safeName, gameDir, isoPath, godDir, xboxConn)
	}

	if xexFolder != "" {
		return fmt.Errorf("No ISO in archive. Choose Install method: XEX for this folder layout, or use a Redump-style ISO release.")
	}
	s.App.Logf("=== Complete (Generic): %s ===", gameName)
	return fmt.Errorf("No ISO or XEX content found in archive")
}

// ==========================================
// DIGITAL / XBLA / DLC / XBLIG PROCESSING
// ==========================================

func (s *Service) ProcessDigital(gameName, platform string) {
	if err := s.ProcessDigitalWithErr(gameName, platform); err != nil {
		s.App.LogStatus(gameName, "Error", err.Error())
	}
}

// ProcessDigitalWithErr processes XBLA/DLC content and returns any error.
func (s *Service) ProcessDigitalWithErr(gameName, platform string) error {
	s.App.Logf("=== Digital: %s (%s) ===", gameName, platform)
	safeName := helpers.SanitizeFilename(gameName)
	if safeName == "" {
		return fmt.Errorf("Invalid game name")
	}
	var xboxConn *models.XboxConnection
	if c, ok := s.App.XboxConnections.Load(gameName); ok {
		cc := c.(models.XboxConnection)
		xboxConn = &cc
	}
	gameDir := filepath.Join(s.App.ToolsDir, "Ready", safeName)
	os.MkdirAll(gameDir, 0755)

	s.App.LogStatus(gameName, "Processing", "Searching Internet Archive...")
	entry, err := s.IA.FindEntry(gameName, platform)
	if err != nil {
		return fmt.Errorf("IA search failed: %w", err)
	}
	downloadURL := app.IADownloadBase + entry.CollectionID + "/" + url.PathEscape(entry.FileName)

	archivePath := filepath.Join(s.App.TempDir, safeName+"_digi"+filepath.Ext(entry.FileName))
	if xboxConn != nil && xboxConn.Mode == "local" {
		archivePath = filepath.Join(gameDir, ".source_digi"+filepath.Ext(entry.FileName))
	}
	if err := s.Download.DownloadWithProgress(downloadURL, archivePath, gameName, app.IADownloadBase); err != nil {
		return fmt.Errorf("Download failed: %w", classifyLocalStorageFailure(xboxConn, "download-http", err))
	}
	if xboxConn == nil || xboxConn.Mode != "local" {
		defer os.Remove(archivePath)
	}

	s.App.LogStatus(gameName, "Processing", "Extracting...")
	extDir := filepath.Join(s.App.TempDir, safeName+"_ext")
	defer s.cleanupStageAfterRun(gameName, extDir, xboxConn)
	if err := s.extractArchiveResilient(gameName, archivePath, extDir); err != nil {
		return fmt.Errorf("Extract failed: %w", err)
	}

	var contentFile, titleID, typeDir string
	filepath.Walk(extDir, func(p string, i os.FileInfo, e error) error {
		if e != nil || i.IsDir() || i.Size() < 0x368 {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		if ext == ".txt" || ext == ".nfo" || ext == ".jpg" {
			return nil
		}
		tid, ct := helpers.ParseXboxHeader(p)
		if tid != "" {
			contentFile = p
			titleID = tid
			typeDir = fmt.Sprintf("%08X", ct)
			return io.EOF
		}
		return nil
	})

	if contentFile == "" {
		return fmt.Errorf("No valid Xbox content found in archive")
	}
	s.App.Logf("Digital: TitleID=%s Type=%s", titleID, typeDir)
	finalName := filepath.Base(contentFile)

	if xboxConn != nil && xboxConn.Mode == "ftp" {
		drive := strings.TrimSuffix(xboxConn.Drive, ":")
		base := fmt.Sprintf("/%s/Content/0000000000000000/%s/%s", drive, titleID, typeDir)
		fc, err := s.FTP.ConnectWithRetry(xboxConn.IP)
		if err != nil {
			return fmt.Errorf("FTP connect failed: %w", err)
		}
		defer s.FTP.QuitConn(fc)
		ftp.MkdirAll(fc, base)
		info, _ := os.Stat(contentFile)
		var xfer int64
		if err := s.FTP.UploadFile(fc, contentFile, base+"/"+finalName, gameName, &xfer, info.Size(), 1, 1, time.Now(), new(float64)); err != nil {
			return fmt.Errorf("FTP upload failed: %w", err)
		}
		os.RemoveAll(gameDir)
		s.App.LogFTPComplete(gameName, titleID, xboxConn.IP)
	} else if xboxConn != nil && xboxConn.Mode == "local" {
		if err := s.InstallContentFileLocal(contentFile, xboxConn.LocalRoot, gameName, titleID, typeDir); err != nil {
			return fmt.Errorf("Gravação local: %w", err)
		}
		os.RemoveAll(gameDir)
		s.App.LogLocalComplete(gameName, titleID, xboxConn.LocalRoot)
	} else {
		relPath := fmt.Sprintf("Content\\0000000000000000\\%s\\%s\\", titleID, typeDir)
		if err := helpers.CopyFileBuffered(contentFile, filepath.Join(gameDir, finalName)); err != nil {
			return fmt.Errorf("Copy failed: %w", err)
		}
		s.updateGameINI_Raw(gameDir, gameName, finalName, relPath, "")
		s.App.LogStatus(gameName, "Ready", "Ready to Install")
	}
	s.App.Logf("=== Complete (Digital): %s ===", gameName)
	return nil
}
