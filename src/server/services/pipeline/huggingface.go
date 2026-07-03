// huggingface.go — HuggingFace XEX game download and install pipeline.
package pipeline

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"godsend/infrastructure/ftp"
	"godsend/infrastructure/helpers"
	"godsend/models"
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

	archivePath := filepath.Join(s.App.ToolsDir, "Temp", safeName+"_hf.7z")
	s.App.LogStatus(gameName, "Processing", "Downloading from HuggingFace...")
	if err := s.Download.DownloadWithProgress(downloadURL, archivePath, gameName, "huggingface.co"); err != nil {
		s.App.Logf("ERROR [%s]: HuggingFace download failed: %v", gameName, err)
		return fmt.Errorf("HuggingFace download failed: %w", err)
	}
	defer os.Remove(archivePath)

	s.App.LogStatus(gameName, "Processing", "Extracting HuggingFace archive...")
	extDir := filepath.Join(s.App.ToolsDir, "Temp", safeName+"_hf_ext")
	os.RemoveAll(extDir)
	defer os.RemoveAll(extDir)
	if err := utils.ExtractArchive(archivePath, extDir); err != nil {
		return fmt.Errorf("Extract failed: %w", err)
	}

	xexFolder := helpers.FindXEXFolder(extDir)
	folderName := ""
	if xexFolder != "" {
		folderName = filepath.Base(xexFolder)
	} else {
		xexFolder = extDir
		folderName = safeName
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
		s.App.LogStatus(gameName, "Ready", "Gravado no dispositivo!")
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
