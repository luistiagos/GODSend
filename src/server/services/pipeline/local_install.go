// local_install.go — write processed games directly to a mounted drive on this PC
// (e.g. a prepared BadAvatar pendrive), mirroring the on-drive layout the FTP path
// produces on the console. This is the primary delivery path; FTP is the secondary.
package pipeline

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"godsend/infrastructure/helpers"
)

// joinSub joins a "/" or "\"-delimited sub-path (e.g. a custom GOD/XEX path) under
// root using OS-native separators, ignoring any leading/trailing slashes.
func joinSub(root, sub string) string {
	parts := strings.FieldsFunc(sub, func(r rune) bool { return r == '/' || r == '\\' })
	return filepath.Join(append([]string{root}, parts...)...)
}

// localSpaceMargin is headroom kept free on the target for filesystem metadata
// and FAT cluster slack, so the device never fills to the very last byte.
const localSpaceMargin = 64 * 1024 * 1024 // 64 MB

// ensureFreeSpace fails (before any write) when the destination volume cannot
// hold needBytes. If free space cannot be measured it logs and allows the write,
// so a measurement failure never blocks an otherwise-valid install.
func (s *Service) ensureFreeSpace(root string, needBytes int64) error {
	query := root
	if vol := filepath.VolumeName(root); vol != "" {
		query = vol + string(filepath.Separator) // e.g. "F:/" → "F:\"
	}
	free, err := helpers.FreeSpaceBytes(query)
	if err != nil {
		s.App.Logf("LOCAL: não foi possível medir espaço livre em %s: %v (seguindo)", query, err)
		return nil
	}
	if uint64(needBytes)+localSpaceMargin > free {
		return fmt.Errorf("espaço insuficiente no destino: o jogo precisa de %.2f GB, mas há apenas %.2f GB livres. Libere espaço ou use outro dispositivo",
			float64(needBytes)/1073741824, float64(free)/1073741824)
	}
	return nil
}

// copyTreeLocal copies every file under srcDir into dstDir (recreating the tree),
// reporting overall progress through LogStatus so the queue UI shows a percentage.
// root is the destination volume root, used for the pre-flight free-space check.
func (s *Service) copyTreeLocal(srcDir, dstDir, root, gameName, label string) error {
	var totalFiles int
	var totalSize int64
	filepath.Walk(srcDir, func(_ string, i os.FileInfo, e error) error {
		if e == nil && !i.IsDir() {
			totalFiles++
			totalSize += i.Size()
		}
		return nil
	})
	if totalFiles == 0 {
		return fmt.Errorf("nenhum arquivo para gravar em %s", srcDir)
	}
	if err := s.ensureFreeSpace(root, totalSize); err != nil {
		return err
	}
	s.App.Logf("LOCAL %s: %d arquivos (%.2f GB) → %s", label, totalFiles, float64(totalSize)/1073741824, dstDir)

	var doneFiles int
	var doneSize int64
	lastLog := time.Now()
	return filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, relErr := filepath.Rel(srcDir, path)
		if relErr != nil {
			return relErr
		}
		dst := filepath.Join(dstDir, rel)
		if info.IsDir() {
			return os.MkdirAll(dst, 0755)
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			return err
		}
		if err := helpers.CopyFileBuffered(path, dst); err != nil {
			return fmt.Errorf("gravar %s: %v", filepath.Base(path), err)
		}
		doneFiles++
		doneSize += info.Size()
		if time.Since(lastLog) > time.Second {
			pct := float64(doneSize) / float64(totalSize) * 100
			s.App.LogStatus(gameName, "Processing",
				fmt.Sprintf("Gravando no dispositivo… %.0f%% (%d/%d)", pct, doneFiles, totalFiles))
			lastLog = time.Now()
		}
		return nil
	})
}

// detectExistingGamesDir scans the root for folders that look like JTAG/RGH game directories.
// Returns the relative folder name (e.g. "Games", "jogos", "Xbox360") or "" if none found.
func detectExistingGamesDir(root string) string {
	// 1. Common names check (fast case)
	commonNames := []string{"Games", "games", "Jogos", "jogos", "Xbox360", "xbox360", "Xbox 360", "xbox 360", "RGH", "rgh"}
	for _, name := range commonNames {
		p := filepath.Join(root, name)
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return name
		}
	}

	// 2. Scan first-level directories for game indicators
	entries, err := os.ReadDir(root)
	if err != nil {
		return ""
	}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		nameLower := strings.ToLower(entry.Name())
		if nameLower == "content" || nameLower == "aurora" || nameLower == "fsd" || nameLower == "freestyle" || nameLower == "badupdatepayload" || nameLower == "apps" {
			continue
		}

		dirPath := filepath.Join(root, entry.Name())
		subEntries, err := os.ReadDir(dirPath)
		if err != nil {
			continue
		}
		for _, sub := range subEntries {
			if !sub.IsDir() {
				continue
			}
			if len(sub.Name()) == 8 && helpers.IsHexString(sub.Name()) {
				return entry.Name()
			}
			subDirPath := filepath.Join(dirPath, sub.Name())
			if _, err := os.Stat(filepath.Join(subDirPath, "default.xex")); err == nil {
				return entry.Name()
			}
			if _, err := os.Stat(filepath.Join(subDirPath, "00007000")); err == nil {
				return entry.Name()
			}
		}
	}
	return ""
}

// InstallGameLocal writes a GOD game to <root>/<godSubPath>/<name> - <titleID>/,
// mirroring FTP TransferGame.
func (s *Service) InstallGameLocal(godDir, root, gameName, titleID, resolvedName string) error {
	folderID := resolvedName
	if folderID == "" {
		folderID = "Title"
	}
	folderID = helpers.SanitizeFilename(folderID)

	godSub := "Games"
	if s.App.CustomGodPath != "" {
		godSub = s.App.CustomGodPath
	} else if detected := detectExistingGamesDir(root); detected != "" {
		godSub = detected
	}
	base := filepath.Join(joinSub(root, godSub), fmt.Sprintf("%s - %s", folderID, titleID))

	contentDir := filepath.Join(godDir, titleID)
	if _, err := os.Stat(contentDir); os.IsNotExist(err) {
		return fmt.Errorf("conteúdo GOD não encontrado: %s", contentDir)
	}
	return s.copyTreeLocal(contentDir, base, root, gameName, "GOD")
}

// InstallContentLocal writes extracted content to
// <root>/Content/0000000000000000/<titleID>/00000002/, mirroring FTP TransferContent.
func (s *Service) InstallContentLocal(contentDir, root, gameName, titleID string) error {
	base := filepath.Join(root, "Content", "0000000000000000", titleID, "00000002")
	return s.copyTreeLocal(contentDir, base, root, gameName, "Content")
}

// InstallXEXLocal writes a XEX folder to <root>/<xexSubPath>/<folderName>/,
// mirroring FTP TransferXEX.
func (s *Service) InstallXEXLocal(xexFolder, folderName, root, gameName string) error {
	xexSub := "Games"
	if s.App.CustomXexPath != "" {
		xexSub = s.App.CustomXexPath
	} else if detected := detectExistingGamesDir(root); detected != "" {
		xexSub = detected
	}
	base := filepath.Join(joinSub(root, xexSub), folderName)
	return s.copyTreeLocal(xexFolder, base, root, gameName, "XEX")
}

// InstallContentFileLocal copies a single digital/DLC content package to
// <root>/Content/0000000000000000/<titleID>/<typeDir>/<name>.
func (s *Service) InstallContentFileLocal(srcFile, root, gameName, titleID, typeDir string) error {
	if st, err := os.Stat(srcFile); err == nil {
		if err := s.ensureFreeSpace(root, st.Size()); err != nil {
			return err
		}
	}
	base := filepath.Join(root, "Content", "0000000000000000", titleID, typeDir)
	if err := os.MkdirAll(base, 0755); err != nil {
		return err
	}
	dst := filepath.Join(base, filepath.Base(srcFile))
	s.App.LogStatus(gameName, "Processing", "Gravando no dispositivo…")
	return helpers.CopyFileBuffered(srcFile, dst)
}

// InstallROMLocal copies a ROM file to <root>/<xboxROMPath>/<name>, where xboxROMPath
// is the same "RomRoot\System\" relative path the FTP path uses on the console.
func (s *Service) InstallROMLocal(romFile, root, xboxROMPath, gameName string) error {
	if st, err := os.Stat(romFile); err == nil {
		if err := s.ensureFreeSpace(root, st.Size()); err != nil {
			return err
		}
	}
	base := joinSub(root, xboxROMPath)
	if err := os.MkdirAll(base, 0755); err != nil {
		return err
	}
	dst := filepath.Join(base, filepath.Base(romFile))
	s.App.LogStatus(gameName, "Processing", "Gravando ROM no dispositivo…")
	return helpers.CopyFileBuffered(romFile, dst)
}
