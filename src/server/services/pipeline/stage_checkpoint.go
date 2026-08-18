package pipeline

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"godsend/app"
	"godsend/infrastructure/helpers"
	"godsend/models"
	"godsend/utils"
)

const stageCheckpointVersion = 1

type stageCheckpointFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type stageCheckpoint struct {
	Version         int                   `json:"version"`
	Phase           string                `json:"phase"`
	SourceSize      int64                 `json:"source_size"`
	SourceModTimeNS int64                 `json:"source_mod_time_ns"`
	Files           []stageCheckpointFile `json:"files"`
}

type stageSourceMarker struct {
	Version         int    `json:"version"`
	Phase           string `json:"phase"`
	SourceSize      int64  `json:"source_size"`
	SourceModTimeNS int64  `json:"source_mod_time_ns"`
}

func stageCheckpointPath(destDir string) string {
	return destDir + ".xbox-stage-complete.json"
}

func stageSourceMarkerPath(destDir string) string {
	return destDir + ".xbox-stage-source.json"
}

func currentStageSource(phase, sourcePath string) (*stageSourceMarker, error) {
	st, err := os.Stat(sourcePath)
	if err != nil {
		return nil, err
	}
	return &stageSourceMarker{
		Version: stageCheckpointVersion, Phase: phase,
		SourceSize: st.Size(), SourceModTimeNS: st.ModTime().UnixNano(),
	}, nil
}

func stageSourceMatches(destDir string, current *stageSourceMarker) bool {
	data, err := os.ReadFile(stageSourceMarkerPath(destDir))
	if err != nil {
		return false
	}
	var saved stageSourceMarker
	return json.Unmarshal(data, &saved) == nil && saved == *current
}

func writeStageSourceMarker(destDir string, marker *stageSourceMarker) error {
	data, err := json.Marshal(marker)
	if err != nil {
		return err
	}
	return writeStageMetadata(stageSourceMarkerPath(destDir), data)
}

func hashStageFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func buildStageCheckpoint(phase, sourcePath, destDir string) (*stageCheckpoint, error) {
	source, err := os.Stat(sourcePath)
	if err != nil {
		return nil, err
	}
	checkpoint := &stageCheckpoint{
		Version: stageCheckpointVersion, Phase: phase,
		SourceSize: source.Size(), SourceModTimeNS: source.ModTime().UnixNano(),
	}
	err = filepath.Walk(destDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		if strings.HasSuffix(info.Name(), ".xbox-companion-part") {
			return fmt.Errorf("fase %s deixou arquivo parcial: %s", phase, path)
		}
		rel, err := filepath.Rel(destDir, path)
		if err != nil {
			return err
		}
		hash, err := hashStageFile(path)
		if err != nil {
			return err
		}
		checkpoint.Files = append(checkpoint.Files, stageCheckpointFile{
			Path: filepath.ToSlash(rel), Size: info.Size(), SHA256: hash,
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(checkpoint.Files) == 0 {
		return nil, fmt.Errorf("fase %s nao gerou arquivos", phase)
	}
	sort.Slice(checkpoint.Files, func(i, j int) bool { return checkpoint.Files[i].Path < checkpoint.Files[j].Path })
	return checkpoint, nil
}

func writeStageCheckpoint(destDir string, checkpoint *stageCheckpoint) error {
	data, err := json.Marshal(checkpoint)
	if err != nil {
		return err
	}
	return writeStageMetadata(stageCheckpointPath(destDir), data)
}

func writeStageMetadata(path string, data []byte) error {
	tmp := path + ".new"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	if _, err := f.Write(append(data, '\n')); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	_ = os.Remove(path)
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func validStageCheckpoint(phase, sourcePath, destDir string) bool {
	data, err := os.ReadFile(stageCheckpointPath(destDir))
	if err != nil {
		return false
	}
	var checkpoint stageCheckpoint
	if json.Unmarshal(data, &checkpoint) != nil || checkpoint.Version != stageCheckpointVersion || checkpoint.Phase != phase || len(checkpoint.Files) == 0 {
		return false
	}
	source, err := os.Stat(sourcePath)
	if err != nil || source.Size() != checkpoint.SourceSize || source.ModTime().UnixNano() != checkpoint.SourceModTimeNS {
		return false
	}
	expectedPaths := make(map[string]bool, len(checkpoint.Files))
	for _, file := range checkpoint.Files {
		clean := filepath.Clean(filepath.FromSlash(file.Path))
		if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return false
		}
		expectedPaths[filepath.ToSlash(clean)] = true
		path := filepath.Join(destDir, filepath.FromSlash(file.Path))
		st, err := os.Stat(path)
		if err != nil || !st.Mode().IsRegular() || st.Size() != file.Size {
			return false
		}
		hash, err := hashStageFile(path)
		if err != nil || hash != file.SHA256 {
			return false
		}
	}
	actualCount := 0
	if filepath.Walk(destDir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(destDir, path)
		if relErr != nil || strings.HasSuffix(info.Name(), ".xbox-companion-part") || !expectedPaths[filepath.ToSlash(rel)] {
			return fmt.Errorf("arquivo inesperado no checkpoint")
		}
		actualCount++
		return nil
	}) != nil || actualCount != len(checkpoint.Files) {
		return false
	}
	return true
}

func (s *Service) runDirectoryStage(gameName, phase, sourcePath, destDir string, resetOnRetry bool, action func() error) error {
	if validStageCheckpoint(phase, sourcePath, destDir) {
		s.App.Logf("STAGE CACHE [%s]: reutilizando fase validada %s", gameName, phase)
		s.App.LogStatus(gameName, "Processing", "Retomando: fase "+phase+" ja estava concluida e foi verificada...")
		return nil
	}
	_ = os.Remove(stageCheckpointPath(destDir))
	var connection *models.XboxConnection
	if value, ok := s.App.XboxConnections.Load(gameName); ok {
		copy := value.(models.XboxConnection)
		connection = &copy
	}
	currentSource, sourceErr := currentStageSource(phase, sourcePath)
	if sourceErr != nil && connection != nil && connection.Mode == "local" && connection.LocalDeviceID != "" &&
		!localDeviceMatches(connection.LocalRoot, connection.LocalDeviceID) {
		if waitErr := s.waitForLocalDevice(connection.LocalRoot, connection.LocalDeviceID, gameName); waitErr != nil {
			return waitErr
		}
		currentSource, sourceErr = currentStageSource(phase, sourcePath)
	}
	if sourceErr != nil {
		if connection != nil && connection.Mode == "local" {
			return fmt.Errorf("%w: %w: fonte da fase %s: %v", ErrLocalDelivery, ErrLocalSourceLost, phase, sourceErr)
		}
		return sourceErr
	}
	if !stageSourceMatches(destDir, currentSource) {
		if err := os.RemoveAll(destDir); err != nil {
			return classifyLocalStorageFailure(connection, phase, err)
		}
		if err := writeStageSourceMarker(destDir, currentSource); err != nil {
			return classifyLocalStorageFailure(connection, phase, err)
		}
	}
	for attempt := 0; attempt < 4; attempt++ {
		if s.App.IsGameJobCancelled(gameName) {
			return app.ErrJobCancelled
		}
		if resetOnRetry {
			if err := os.RemoveAll(destDir); err != nil {
				return classifyLocalStorageFailure(connection, phase, err)
			}
		}
		if err := os.MkdirAll(destDir, 0755); err != nil {
			return classifyLocalStorageFailure(connection, phase, err)
		}
		err := action()
		if err == nil {
			checkpoint, checkpointErr := buildStageCheckpoint(phase, sourcePath, destDir)
			if checkpointErr == nil {
				checkpointErr = writeStageCheckpoint(destDir, checkpoint)
			}
			if checkpointErr == nil {
				return nil
			}
			err = fmt.Errorf("checkpoint %s: %w", phase, checkpointErr)
		}

		if connection != nil && connection.Mode == "local" && connection.LocalDeviceID != "" {
			if !localDeviceMatches(connection.LocalRoot, connection.LocalDeviceID) {
				if waitErr := s.waitForLocalDevice(connection.LocalRoot, connection.LocalDeviceID, gameName); waitErr != nil {
					return waitErr
				}
			} else if !isLikelyLocalDeviceError(err) {
				if isLikelyLocalStorageError(err) {
					return fmt.Errorf("%w: fase %s: %v", ErrLocalDelivery, phase, err)
				}
				return err
			}
			s.App.Logf("STAGE RETRY [%s]: refazendo %s sem novo download (tentativa %d/4): %v", gameName, phase, attempt+2, err)
			time.Sleep(time.Second)
			continue
		}
		if connection != nil && connection.Mode == "local" && isLikelyLocalStorageError(err) {
			return fmt.Errorf("%w: fase %s: %v", ErrLocalDelivery, phase, err)
		}
		if isLikelyLocalDeviceError(err) && attempt < 3 {
			time.Sleep(time.Second)
			continue
		}
		return err
	}
	return fmt.Errorf("fase %s falhou apos tentativas locais", phase)
}

func (s *Service) extractArchiveResilient(gameName, archivePath, destDir string) error {
	return s.runDirectoryStage(gameName, "extract-archive", archivePath, destDir, false, func() error {
		return utils.ExtractArchive(archivePath, destDir)
	})
}

func (s *Service) extractISOResilient(gameName, safeName, archivePath, tempRoot string) (string, error) {
	destDir := filepath.Join(tempRoot, safeName+"_extracted")
	err := s.runDirectoryStage(gameName, "extract-iso", archivePath, destDir, false, func() error {
		_, err := utils.ExtractISO(archivePath, safeName, tempRoot)
		return err
	})
	if err != nil {
		return "", err
	}
	isoPath := helpers.FindFileByExt(destDir, ".iso")
	if isoPath == "" {
		return "", fmt.Errorf("checkpoint de extracao sem ISO")
	}
	return isoPath, nil
}

func (s *Service) extractXEXResilient(gameName, isoPath, destDir string) error {
	return s.runDirectoryStage(gameName, "extract-xex", isoPath, destDir, false, func() error {
		return utils.ExtractXEXFolderFromISO(isoPath, destDir)
	})
}

func (s *Service) extractContentResilient(gameName, isoPath, destDir string, info *utils.TitleExecInfo) error {
	return s.runDirectoryStage(gameName, "extract-content", isoPath, destDir, false, func() error {
		return utils.ExtractXDVDFSContentToDir(isoPath, destDir, info)
	})
}

func (s *Service) convertGODResilient(gameName, isoPath, godDir string) error {
	return s.runDirectoryStage(gameName, "convert-god", isoPath, godDir, true, func() error {
		if err := utils.RunIso2GodNative(isoPath, godDir, Iso2GodResolveDisplayTitle); err != nil {
			return err
		}
		_, _, err := helpers.DetectGodStructure(godDir)
		return err
	})
}

func (s *Service) convertAndFinalizeGODResilient(gameName, safeName, gameDir, isoPath, godDir string, connection *models.XboxConnection) error {
	for rebuild := 0; rebuild < 4; rebuild++ {
		s.App.LogStatus(gameName, "Processing", "Convertendo/verificando GOD...")
		if err := s.convertGODResilient(gameName, isoPath, godDir); err != nil {
			return fmt.Errorf("conversao GOD: %w", err)
		}
		titleID, mediaID, err := helpers.DetectGodStructure(godDir)
		if err != nil {
			_ = os.Remove(stageCheckpointPath(godDir))
			_ = os.RemoveAll(godDir)
			if rebuild < 3 {
				continue
			}
			return fmt.Errorf("estrutura GOD invalida apos reconstrucoes: %w", err)
		}
		err = s.finalizeGOD(gameName, safeName, gameDir, godDir, titleID, mediaID, connection)
		if errors.Is(err, ErrLocalSourceLost) {
			_ = os.Remove(stageCheckpointPath(godDir))
			s.App.Logf("STAGE RETRY [%s]: reconstruindo GOD da ISO preservada apos perda do staging", gameName)
			continue
		}
		if err == nil {
			_ = os.Remove(isoPath)
			_ = os.Remove(stageCheckpointPath(godDir))
		}
		return err
	}
	return fmt.Errorf("%w: staging GOD perdido repetidamente; ISO preservada", ErrLocalDelivery)
}
