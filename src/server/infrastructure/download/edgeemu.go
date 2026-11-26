// edgeemu.go — EdgeEmu downloads backed by the unified MDM-style dynamic range engine.
package download

import "os"

// DownloadEdgeEmuWithProgress downloads from edgeemu.net using the unified
// dynamic parallel range engine (with dedicated HTTP/1.1 transport, slow-cut,
// stall recovery, and in-place resume), cleaning up temporary completion
// sidecars afterwards because non-local ROM downloads remove dest immediately.
func (s *Service) DownloadEdgeEmuWithProgress(urlStr, dest, name string) error {
	err := s.DownloadWithProgress(urlStr, dest, name, "https://edgeemu.net/")
	if err == nil {
		_ = os.Remove(completedMarkerPath(dest))
		removeDownloadResume(dest)
	}
	return err
}
