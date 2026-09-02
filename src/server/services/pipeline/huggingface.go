// huggingface.go — HuggingFace XEX game download and install pipeline.
package pipeline

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"godsend/infrastructure/ftp"
	"godsend/infrastructure/helpers"
	"godsend/models"
	"godsend/services"
	"godsend/utils"
)

// ProcessHuggingFaceGame downloads and processes an XEX game folder from HuggingFace.
func (s *Service) ProcessHuggingFaceGame(gameName string, downloadURL string) {
	if err := s.ProcessHuggingFaceGameWithErr(gameName, downloadURL); err != nil {
		s.App.LogStatus(gameName, "Error", err.Error())
	}
}

// ProcessHuggingFaceGameWithErr downloads and processes an XEX game folder, returning any error.
func (s *Service) ProcessHuggingFaceGameWithErr(gameName string, downloadURL string) error {
	s.App.Logf("=== HuggingFace: %s ===", gameName)
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

	ext := strings.ToLower(filepath.Ext(downloadURL))
	if ext == "" || (ext != ".zip" && ext != ".rar" && ext != ".7z") {
		ext = ".7z"
	}
	archivePath := filepath.Join(s.App.TempDir, safeName+"_hf"+ext)
	if xboxConn != nil && xboxConn.Mode == "local" {
		archivePath = filepath.Join(gameDir, ".source_hf"+ext)
	}
	s.App.LogStatus(gameName, "Processing", "Downloading from HuggingFace...")
	if err := s.Download.DownloadWithProgress(downloadURL, archivePath, gameName, "huggingface.co"); err != nil {
		s.App.Logf("ERROR [%s]: HuggingFace download failed: %v", gameName, err)
		return fmt.Errorf("HuggingFace download failed: %w", classifyLocalStorageFailure(xboxConn, "download-http", err))
	}
	if xboxConn == nil || xboxConn.Mode != "local" {
		defer os.Remove(archivePath)
	}

	s.App.LogStatus(gameName, "Processing", "Extracting HuggingFace archive...")
	extDir := filepath.Join(s.outputRoot(gameName), safeName+"_hf_ext")
	defer s.cleanupStageAfterRun(gameName, extDir, xboxConn)
	if err := s.extractArchiveResilient(gameName, archivePath, extDir); err != nil {
		return fmt.Errorf("Extract failed: %w", err)
	}

	xexFolder := helpers.FindXEXFolder(extDir)
	folderName := ""
	if xexFolder != "" {
		folderName = filepath.Base(xexFolder)
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
			largeFile, largeSize := findFileExceedingFAT32Limit(xexFolder)
			if largeFile != "" && helpers.IsFATVolume(xboxConn.LocalRoot) {
				s.App.Logf("HUGGINGFACE [%s]: XEX contains file >= 4 GB (%s: %.2f GB) incompatible with FAT32 — switching provider for ISO/GOD",
					gameName, filepath.Base(largeFile), float64(largeSize)/(1024*1024*1024))
				return fmt.Errorf("%w: formato XEX possui arquivo de %.2f GB (%s) incompativel com pendrive FAT32 (limite 4 GB)",
					ErrFAT32FileSizeLimit, float64(largeSize)/(1024*1024*1024), filepath.Base(largeFile))
			}
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
		s.App.Logf("=== Complete (HuggingFace XEX): %s ===", gameName)
		return nil
	}

	if isoInArchive := helpers.FindFileByExt(extDir, ".iso"); isoInArchive != "" {
		isoXexDir := filepath.Join(s.outputRoot(gameName), safeName+"_xex")
		s.App.LogStatus(gameName, "Processing", "Extracting XEX layout from ISO...")
		if err := s.extractXEXResilient(gameName, isoInArchive, isoXexDir); err != nil {
			return fmt.Errorf("XEX from ISO: %w", err)
		}
		defer s.cleanupStageAfterRun(gameName, isoXexDir, xboxConn)
		xexFolder = isoXexDir
		folderName = safeName

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
			largeFile, largeSize := findFileExceedingFAT32Limit(xexFolder)
			if largeFile != "" && helpers.IsFATVolume(xboxConn.LocalRoot) {
				s.App.Logf("HUGGINGFACE [%s]: XEX contains file >= 4 GB (%s: %.2f GB) incompatible with FAT32 — switching provider for ISO/GOD",
					gameName, filepath.Base(largeFile), float64(largeSize)/(1024*1024*1024))
				return fmt.Errorf("%w: formato XEX possui arquivo de %.2f GB (%s) incompativel com pendrive FAT32 (limite 4 GB)",
					ErrFAT32FileSizeLimit, float64(largeSize)/(1024*1024*1024), filepath.Base(largeFile))
			}
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
		s.App.Logf("=== Complete (HuggingFace XEX from ISO): %s ===", gameName)
		return nil
	}

	if godDir, titleID, mediaID, err := helpers.FindGODPackage(extDir); err == nil && godDir != "" {
		s.App.LogStatus(gameName, "Processing", fmt.Sprintf("GOD package detected: %s (TitleID: %s)", mediaID, titleID))
		resolvedName := services.LookupTitleName(titleID)
		if resolvedName == "" {
			resolvedName = gameName
		}
		if xboxConn != nil && xboxConn.Mode == "ftp" {
			if err := s.FTP.TransferGame(godDir, xboxConn, gameName, titleID, mediaID, resolvedName); err != nil {
				s.App.Logf("FTP: initial GOD transfer failed for %s: %v — scheduling for retry", gameName, err)
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
			} else {
				os.RemoveAll(gameDir)
				s.App.LogFTPComplete(gameName, titleID, xboxConn.IP)
			}
		} else if xboxConn != nil && xboxConn.Mode == "local" {
			if err := s.InstallGameLocal(godDir, xboxConn.LocalRoot, gameName, titleID, resolvedName); err != nil {
				return fmt.Errorf("Gravação local GOD: %w", err)
			}
			os.RemoveAll(gameDir)
			s.App.LogLocalComplete(gameName, titleID, xboxConn.LocalRoot)
		} else {
			titleID, mediaID, err := helpers.BucketAndZip(s.App, godDir, gameDir, gameName, safeName)
			if err != nil {
				return fmt.Errorf("Archive GOD: %w", err)
			}
			s.updateGameINI_Parts(gameDir, gameName, titleID, mediaID, resolvedName, nil)
			s.App.LogStatus(gameName, "Ready", "Ready to Install")
		}
		s.App.Logf("=== Complete (HuggingFace GOD): %s ===", gameName)
		return nil
	}

	if contentFile, titleID, typeDir, err := helpers.FindContentPackage(extDir); err == nil && contentFile != "" {
		s.App.LogStatus(gameName, "Processing", fmt.Sprintf("Content package detected (TitleID: %s, Type: %s)", titleID, typeDir))
		if xboxConn != nil && xboxConn.Mode == "ftp" {
			if err := s.FTP.TransferContent(filepath.Dir(contentFile), xboxConn, gameName, titleID); err != nil {
				s.App.Logf("FTP: initial Content transfer failed for %s: %v", gameName, err)
				return fmt.Errorf("FTP Content transfer failed: %w", err)
			}
			os.RemoveAll(gameDir)
			s.App.LogFTPComplete(gameName, titleID, xboxConn.IP)
		} else if xboxConn != nil && xboxConn.Mode == "local" {
			if err := s.InstallContentFileLocal(contentFile, xboxConn.LocalRoot, gameName, titleID, typeDir); err != nil {
				return fmt.Errorf("Gravação local Content: %w", err)
			}
			os.RemoveAll(gameDir)
			s.App.LogLocalComplete(gameName, titleID, xboxConn.LocalRoot)
		} else {
			s.App.LogStatus(gameName, "Ready", "Ready to Install")
		}
		s.App.Logf("=== Complete (HuggingFace Content): %s ===", gameName)
		return nil
	}

	return fmt.Errorf("No default.xex, .iso, GOD, or Content package found in HuggingFace archive")
}

func findFileExceedingFAT32Limit(dir string) (string, int64) {
	var foundName string
	var foundSize int64
	_ = filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		if info.Size() >= 4294967295 {
			foundName = p
			foundSize = info.Size()
			return filepath.SkipAll
		}
		return nil
	})
	return foundName, foundSize
}
