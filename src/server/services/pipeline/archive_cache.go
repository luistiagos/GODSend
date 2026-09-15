package pipeline

import (
	"fmt"
	"os"
	"strings"
)

func corruptArchiveRedownloadMarkerPath(archivePath string) string {
	return archivePath + ".corrupt-redownloaded"
}

func isArchiveIntegrityError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	for _, fragment := range []string{
		"bad file checksum",
		"bad block checksum",
		"checksum error",
		"checksum mismatch",
		"invalid checksum",
		"crc32 invalido",
		"crc32 inv",
		"crc error",
		"crc check failed",
		"crc failed",
		"not a valid 7-zip file",
		"not a valid zip file",
		"zip: not a valid zip file",
		"compressed data is corrupt",
		"flate: corrupt input",
		"arquivo extraido incompleto",
		"unexpected eof",
	} {
		if strings.Contains(message, fragment) {
			return true
		}
	}
	return false
}

func (s *Service) invalidateDownloadedArchiveOnCorruptExtract(gameName, archivePath, provider string, err error) error {
	if !isArchiveIntegrityError(err) {
		return err
	}
	marker := corruptArchiveRedownloadMarkerPath(archivePath)
	if _, statErr := os.Stat(marker); statErr == nil {
		s.Download.InvalidateCompletedDownload(archivePath, gameName, "extracao corrompida repetida")
		return fmt.Errorf("%w; arquivo baixado novamente de %s continua invalido. A origem pode estar corrompida no catalogo", err, provider)
	}
	_ = os.WriteFile(marker, []byte("download invalidado apos erro de integridade na extracao\n"), 0644)
	s.Download.InvalidateCompletedDownload(archivePath, gameName, "erro de integridade na extracao")
	return fmt.Errorf("%w; arquivo baixado removido para baixar novamente na proxima tentativa", err)
}

func clearCorruptArchiveRedownloadMarker(archivePath string) {
	_ = os.Remove(corruptArchiveRedownloadMarkerPath(archivePath))
}
