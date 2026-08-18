// pipeline.go — ISO processing pipelines (local and online Redump).
package pipeline

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"godsend/app"
	"godsend/infrastructure/download"
	"godsend/infrastructure/ftp"
	"godsend/infrastructure/helpers"
	"godsend/infrastructure/torrent"
	"godsend/models"
	"godsend/services"
	"godsend/services/cache"
	"godsend/utils"
)

// Service orchestrates all game processing pipelines.
type Service struct {
	App         *app.App
	IA          *cache.IAService
	Minerva     *cache.MinervaService
	ROM         *cache.ROMService
	HuggingFace *cache.HuggingFaceService
	Download    *download.Service
	FTP         *ftp.Service
	Torrent     *torrent.Service
}

// ==========================================
// LOCAL ISO PROCESSING
// ==========================================

func (s *Service) ProcessLocalISO(gameName, isoPath string) {
	s.App.Logf("=== Local ISO: %s ===", gameName)
	safeName := helpers.SanitizeFilename(gameName)
	if safeName == "" {
		s.App.LogStatus(gameName, "Error", "Invalid game name")
		return
	}
	var xboxConn *models.XboxConnection
	if c, ok := s.App.XboxConnections.Load(gameName); ok {
		cc := c.(models.XboxConnection)
		xboxConn = &cc
	}

	installType := s.App.LookupInstallType(gameName)
	if installType == "xex" {
		xexDir := filepath.Join(s.outputRoot(gameName), safeName+"_xex")
		s.App.LogStatus(gameName, "Processing", "Extracting XEX layout from ISO...")
		if err := s.extractXEXResilient(gameName, isoPath, xexDir); err != nil {
			s.App.LogStatus(gameName, "Error", fmt.Sprintf("XEX from ISO: %v", err))
			return
		}
		defer s.cleanupStageAfterRun(gameName, xexDir, xboxConn)

		gameDir := filepath.Join(s.App.ToolsDir, "Ready", safeName)
		os.MkdirAll(gameDir, 0755)
		folderName := safeName
		if xboxConn != nil && xboxConn.Mode == "ftp" {
			if err := s.FTP.TransferXEX(xexDir, folderName, xboxConn, gameName); err != nil {
				s.App.Logf("FTP: initial XEX transfer failed for %s: %v — scheduling for retry", gameName, err)
				job := ftp.PendingFTPJob{
					ID:         helpers.SanitizeFilename(gameName) + "_" + strconv.FormatInt(time.Now().UnixNano(), 36),
					GameName:   gameName,
					Type:       "xex",
					SourceDir:  xexDir,
					GameDir:    gameDir,
					XboxIP:     xboxConn.IP,
					Drive:      xboxConn.Drive,
					FolderName: folderName,
					CreatedAt:  time.Now(),
				}
				s.FTP.SchedulePendingFTP(job)
				return
			}
			os.RemoveAll(gameDir)
			s.App.LogFTPComplete(gameName, "", xboxConn.IP)
		} else if xboxConn != nil && xboxConn.Mode == "local" {
			if err := s.InstallXEXLocal(xexDir, folderName, xboxConn.LocalRoot, gameName); err != nil {
				s.App.LogStatus(gameName, "Error", fmt.Sprintf("Gravação local: %v", err))
				return
			}
			os.RemoveAll(gameDir)
			tid := helpers.FindTitleIDInDir(xexDir)
			s.App.LogLocalComplete(gameName, tid, xboxConn.LocalRoot)
		} else {
			partName := fmt.Sprintf("%s_Part1.7z", safeName)
			if err := utils.CreateZipFromDir(xexDir, filepath.Join(gameDir, partName)); err != nil {
				s.App.LogStatus(gameName, "Error", fmt.Sprintf("Archive XEX: %v", err))
				return
			}
			s.App.GamePartsMap.Store(gameName, []string{partName})
			s.updateGameINI_XEX(gameDir, gameName, folderName, partName)
			s.App.LogStatus(gameName, "Ready", "Ready to Install")
		}
		if gs, ok := s.App.JobQueue.Load(gameName); ok && gs.(models.GameStatus).State == "Ready" {
			if err := os.Remove(isoPath); err == nil {
				s.App.Logf("Cleanup: deleted source ISO: %s", filepath.Base(isoPath))
			}
			s.cleanupCompletedLocalScratch(gameName)
		}
		s.App.Logf("=== Complete (local XEX from ISO): %s ===", gameName)
		return
	}
	if installType == "content" {
		if err := s.processContentInstallFromISO(gameName, safeName, isoPath, xboxConn); err != nil {
			s.App.LogStatus(gameName, "Error", err.Error())
			return
		}
		if gs, ok := s.App.JobQueue.Load(gameName); ok && gs.(models.GameStatus).State == "Ready" {
			if err := os.Remove(isoPath); err == nil {
				s.App.Logf("Cleanup: deleted source ISO: %s", filepath.Base(isoPath))
			}
			s.cleanupCompletedLocalScratch(gameName)
		}
		return
	}

	gameDir := filepath.Join(s.App.ToolsDir, "Ready", safeName)
	os.MkdirAll(gameDir, 0755)

	godDir := filepath.Join(s.outputRoot(gameName), safeName+"_GOD")
	if err := s.convertAndFinalizeGODResilient(gameName, safeName, gameDir, isoPath, godDir, xboxConn); err != nil {
		s.App.LogStatus(gameName, "Error", err.Error())
		return
	}
	s.cleanupCompletedLocalScratch(gameName)
}

// ==========================================
// ONLINE ISO PROCESSING (Redump)
// ==========================================

func (s *Service) ProcessGame(gameName, platform string) {
	if err := s.ProcessGameWithErr(gameName, platform); err != nil {
		s.App.LogStatus(gameName, "Error", err.Error())
	}
}

// ProcessGameWithErr runs the online game pipeline and returns any error.
func (s *Service) ProcessGameWithErr(gameName, platform string) error {
	s.App.Logf("=== Online ISO: %s (%s) ===", gameName, platform)
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
		s.App.Logf("ERROR [%s]: IA search failed: %v", gameName, err)
		return fmt.Errorf("IA search failed: %w", err)
	}
	downloadURL := app.IADownloadBase + entry.CollectionID + "/" + url.PathEscape(entry.FileName)
	s.App.Logf("IA Download: %s → %s", gameName, entry.FileName)

	archivePath := filepath.Join(s.App.TempDir, safeName+filepath.Ext(entry.FileName))
	if xboxConn != nil && xboxConn.Mode == "local" {
		// Keep a completed source archive outside transient scratch. If the app is
		// restarted after a USB failure, DownloadWithProgress reuses this file.
		archivePath = filepath.Join(gameDir, ".source"+filepath.Ext(entry.FileName))
	}
	s.App.LogStatus(gameName, "Processing", "Downloading from Internet Archive...")
	if err := s.Download.DownloadWithProgress(downloadURL, archivePath, gameName, app.IADownloadBase); err != nil {
		s.App.Logf("ERROR [%s]: IA download failed: %v", gameName, err)
		return fmt.Errorf("Download failed: %w", classifyLocalStorageFailure(xboxConn, "download-http", err))
	}

	installType := s.App.LookupInstallType(gameName)

	if installType == "xex" {
		extDir := filepath.Join(s.App.TempDir, safeName+"_ext")
		s.App.LogStatus(gameName, "Processing", "Extracting archive for XEX...")
		if err := s.extractArchiveResilient(gameName, archivePath, extDir); err != nil {
			if xboxConn == nil || xboxConn.Mode != "local" {
				os.Remove(archivePath)
			}
			s.App.Logf("ERROR [%s]: XEX extract failed: %v", gameName, err)
			return fmt.Errorf("Extract failed: %w", err)
		}
		if xboxConn == nil || xboxConn.Mode != "local" {
			os.Remove(archivePath)
		}
		defer s.cleanupStageAfterRun(gameName, extDir, xboxConn)

		xexFolder := helpers.FindXEXFolder(extDir)
		folderName := ""
		if xexFolder != "" {
			folderName = filepath.Base(xexFolder)
		} else if isoInArchive := helpers.FindFileByExt(extDir, ".iso"); isoInArchive != "" {
			isoXexDir := filepath.Join(s.outputRoot(gameName), safeName+"_xex")
			s.App.LogStatus(gameName, "Processing", "Extracting XEX layout from ISO...")
			if err := s.extractXEXResilient(gameName, isoInArchive, isoXexDir); err != nil {
				return fmt.Errorf("XEX from ISO: %w", err)
			}
			defer s.cleanupStageAfterRun(gameName, isoXexDir, xboxConn)
			xexFolder = isoXexDir
			folderName = safeName
		} else {
			return fmt.Errorf("No default.xex in archive — XEX needs a loose folder rip. Use GOD or DLC for ISO-only Redump releases.")
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
		s.App.Logf("=== Complete (Redump XEX): %s ===", gameName)
		return nil
	}

	s.App.LogStatus(gameName, "Processing", "Extracting ISO...")
	isoPath, err := s.extractISOResilient(gameName, safeName, archivePath, filepath.Join(s.App.TempDir))
	if xboxConn == nil || xboxConn.Mode != "local" {
		os.Remove(archivePath)
	}
	if err != nil {
		s.App.Logf("ERROR [%s]: Extract failed: %v", gameName, err)
		return fmt.Errorf("Extract failed: %w", err)
	}

	if installType == "content" {
		if err := s.processContentInstallFromISO(gameName, safeName, isoPath, xboxConn); err != nil {
			return err
		}
		os.Remove(isoPath)
		return nil
	}

	localRebuilds := 0
	for {
		s.App.LogStatus(gameName, "Processing", "Converting to GOD...")
		godDir := filepath.Join(s.outputRoot(gameName), safeName+"_GOD")
		if err := s.convertGODResilient(gameName, isoPath, godDir); err != nil {
			if xboxConn != nil && xboxConn.Mode == "local" && xboxConn.LocalDeviceID != "" && (!localDeviceMatches(xboxConn.LocalRoot, xboxConn.LocalDeviceID) || isLikelyLocalDeviceError(err)) {
				if !localDeviceMatches(xboxConn.LocalRoot, xboxConn.LocalDeviceID) {
					if waitErr := s.waitForLocalDevice(xboxConn.LocalRoot, xboxConn.LocalDeviceID, gameName); waitErr != nil {
						return waitErr
					}
				}
				localRebuilds++
				if localRebuilds > 3 {
					return fmt.Errorf("%w: nao foi possivel reconstruir GOD apos repetidas desconexoes: %v", ErrLocalDelivery, err)
				}
				s.App.Logf("LOCAL [%s]: dispositivo caiu durante a conversao; refazendo GOD a partir da ISO preservada", gameName)
				continue
			}
			s.App.Logf("ERROR [%s]: iso2god failed: %v", gameName, err)
			if xboxConn == nil || xboxConn.Mode != "local" {
				os.Remove(isoPath)
			}
			os.RemoveAll(godDir)
			return fmt.Errorf("GOD convert failed: %w", err)
		}

		titleID, mediaID, err := helpers.DetectGodStructure(godDir)
		if err != nil {
			if xboxConn != nil && xboxConn.Mode == "local" {
				if xboxConn.LocalDeviceID != "" && !localDeviceMatches(xboxConn.LocalRoot, xboxConn.LocalDeviceID) {
					if waitErr := s.waitForLocalDevice(xboxConn.LocalRoot, xboxConn.LocalDeviceID, gameName); waitErr != nil {
						return waitErr
					}
				}
				localRebuilds++
				if localRebuilds <= 3 {
					s.App.Logf("LOCAL [%s]: GOD temporario incompleto; reconstruindo da ISO preservada: %v", gameName, err)
					continue
				}
				return fmt.Errorf("%w: GOD temporario permaneceu invalido apos reconstrucoes: %v", ErrLocalDelivery, err)
			}
			os.RemoveAll(godDir)
			return fmt.Errorf("GOD structure detect failed: %w", err)
		}
		s.App.Logf("Online ISO: TitleID=%s MediaID=%s", titleID, mediaID)
		err = s.finalizeGOD(gameName, safeName, gameDir, godDir, titleID, mediaID, xboxConn)
		if errors.Is(err, ErrLocalSourceLost) {
			localRebuilds++
			if localRebuilds > 3 {
				return fmt.Errorf("%w: staging GOD foi perdido repetidamente; ISO e download foram preservados: %v", ErrLocalDelivery, err)
			}
			s.App.Logf("LOCAL [%s]: staging perdido; reconstruindo GOD a partir da ISO preservada", gameName)
			continue
		}
		if err == nil {
			os.Remove(isoPath)
		}
		return err
	}
}

// finalizeGOD handles the FTP vs HTTP packaging step shared by local and online ISO flows.
func (s *Service) finalizeGOD(gameName, safeName, gameDir, godDir, titleID, mediaID string, xboxConn *models.XboxConnection) error {
	s.App.LogStatus(gameName, "Processing", "Looking up title name...")
	resolvedName := services.LookupTitleName(titleID)

	if xboxConn != nil && xboxConn.Mode == "ftp" {
		s.App.LogStatus(gameName, "Processing", "FTP Transfer starting...")
		if err := s.FTP.TransferGame(godDir, xboxConn, gameName, titleID, mediaID, resolvedName); err != nil {
			s.App.Logf("FTP: initial transfer failed for %s: %v — scheduling for retry", gameName, err)
			job := ftp.PendingFTPJob{
				ID:           helpers.SanitizeFilename(gameName) + "_" + strconv.FormatInt(time.Now().UnixNano(), 36),
				GameName:     gameName,
				Type:         "god",
				SourceDir:    godDir,
				GameDir:      gameDir,
				XboxIP:       xboxConn.IP,
				Drive:        xboxConn.Drive,
				TitleID:      titleID,
				MediaID:      mediaID,
				ResolvedName: resolvedName,
				CreatedAt:    time.Now(),
			}
			s.FTP.SchedulePendingFTP(job)
			return nil
		}
		os.RemoveAll(godDir)
		os.RemoveAll(gameDir)
		s.App.LogFTPComplete(gameName, titleID, xboxConn.IP)
	} else if xboxConn != nil && xboxConn.Mode == "local" {
		s.App.LogStatus(gameName, "Processing", "Gravando no dispositivo...")
		if err := s.InstallGameLocal(godDir, xboxConn.LocalRoot, gameName, titleID, resolvedName); err != nil {
			return fmt.Errorf("gravacao local: %w", err)
		}
		os.RemoveAll(godDir)
		os.RemoveAll(gameDir)
		s.App.LogLocalComplete(gameName, titleID, xboxConn.LocalRoot)
	} else {
		s.App.LogStatus(gameName, "Processing", "Archiving for HTTP transfer...")
		titleID, mediaID, err := helpers.BucketAndZip(s.App, godDir, gameDir, gameName, safeName)
		if err != nil {
			os.RemoveAll(godDir)
			return fmt.Errorf("archive: %w", err)
		}
		os.RemoveAll(godDir)
		s.updateGameINI_Parts(gameDir, gameName, titleID, mediaID, resolvedName, nil)
		s.App.LogStatus(gameName, "Ready", "Ready to Install")
	}
	s.App.Logf("=== Complete: %s ===", gameName)
	return nil
}
