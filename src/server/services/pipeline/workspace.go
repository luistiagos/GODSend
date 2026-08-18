package pipeline

import (
	"os"
	"path/filepath"

	"godsend/infrastructure/helpers"
	"godsend/models"
)

const localScratchFolder = ".xbox-360-companion-temp"

// outputRoot keeps extracted loose files and split GOD output on the local
// destination when possible. The compressed archive and any full ISO remain on
// the large-file-capable processing volume.
func (s *Service) outputRoot(gameName string) string {
	if value, ok := s.App.XboxConnections.Load(gameName); ok {
		connection := value.(models.XboxConnection)
		if connection.Mode == "local" && connection.LocalRoot != "" {
			root := filepath.Join(connection.LocalRoot, localScratchFolder)
			if err := os.MkdirAll(root, 0755); err == nil {
				return root
			} else {
				s.App.Logf("LOCAL: could not create output scratch %s: %v; using %s", root, err, s.App.TempDir)
			}
		}
	}
	return s.App.TempDir
}

func (s *Service) scratchRoots(gameName string) []string {
	roots := []string{s.App.TempDir}
	if local := s.outputRoot(gameName); !samePath(local, s.App.TempDir) {
		roots = append(roots, local)
	}
	return roots
}

func samePath(a, b string) bool {
	absA, errA := filepath.Abs(a)
	absB, errB := filepath.Abs(b)
	if errA != nil || errB != nil {
		return a == b
	}
	return filepath.Clean(absA) == filepath.Clean(absB)
}

func (s *Service) cleanupGameScratch(gameName string) {
	s.cleanupGameScratchInternal(gameName, true)
}

func (s *Service) cleanupCompletedLocalScratch(gameName string) {
	value, ok := s.App.XboxConnections.Load(gameName)
	if !ok || value.(models.XboxConnection).Mode != "local" {
		return
	}
	statusValue, ok := s.App.JobQueue.Load(gameName)
	status, valid := statusValue.(models.GameStatus)
	if !ok || !valid || status.State != "Ready" {
		return
	}
	s.cleanupGameScratchInternal(gameName, false)
}

func (s *Service) cleanupStageAfterRun(gameName, stageDir string, connection *models.XboxConnection) {
	if connection != nil && connection.Mode == "local" {
		value, ok := s.App.JobQueue.Load(gameName)
		status, valid := value.(models.GameStatus)
		if !ok || !valid || status.State != "Ready" {
			s.App.Logf("STAGE CACHE [%s]: preservando %s para retomada", gameName, stageDir)
			return
		}
	}
	_ = os.RemoveAll(stageDir)
	_ = os.Remove(stageCheckpointPath(stageDir))
	_ = os.Remove(stageSourceMarkerPath(stageDir))
}

func (s *Service) cleanupGameScratchInternal(gameName string, preserveResumable bool) {
	safeName := helpers.SanitizeFilename(gameName)
	if safeName == "" {
		return
	}
	suffixes := []string{
		".7z", ".zip", ".rar", ".iso",
		"_hf.7z", "_hf.zip", "_hf.rar", "_hf_ext",
		"_ext", "_extracted", "_torrent", "_mext", "_mgext", "_mdext",
		"_xex", "_mxex", "_content", "_GOD", "_MGOD", "_MGGOD",
		"_rom_ext",
	}
	preserveLocalStages := false
	if value, ok := s.App.XboxConnections.Load(gameName); ok {
		preserveLocalStages = preserveResumable && value.(models.XboxConnection).Mode == "local"
	}
	resumableStages := map[string]bool{
		"_torrent": true, "_hf_ext": true, "_ext": true, "_extracted": true,
		"_mext": true, "_mgext": true, "_mdext": true,
		"_xex": true, "_mxex": true, "_content": true,
		"_GOD": true, "_MGOD": true, "_MGGOD": true,
		"_rom_ext": true,
	}
	for _, root := range s.scratchRoots(gameName) {
		for _, suffix := range suffixes {
			if preserveLocalStages && resumableStages[suffix] {
				continue
			}
			stagePath := filepath.Join(root, safeName+suffix)
			_ = os.RemoveAll(stagePath)
			_ = os.Remove(stageCheckpointPath(stagePath))
			_ = os.Remove(stageSourceMarkerPath(stagePath))
		}
		if filepath.Base(root) == localScratchFolder {
			_ = os.Remove(root)
		}
	}
}

// Local torrent data remains resumable after a destination failure or process
// restart. It is removed only after the local job reaches Ready.
func (s *Service) cleanupTorrentScratchAfterRun(gameName, torrentDir string, connection *models.XboxConnection) {
	if connection != nil && connection.Mode == "local" {
		value, ok := s.App.JobQueue.Load(gameName)
		status, valid := value.(models.GameStatus)
		if !ok || !valid || status.State != "Ready" {
			s.App.Logf("MINERVA CACHE [%s]: preservando %s para retomada", gameName, torrentDir)
			return
		}
	}
	_ = os.RemoveAll(torrentDir)
}
