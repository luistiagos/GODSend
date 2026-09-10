// companion_content.go — deliver the whole release when a XEX rip carries more than one disc.
package pipeline

import (
	"fmt"
	"path/filepath"

	"godsend/infrastructure/helpers"
	"godsend/models"
)

// xexDestinationName picks the folder an extracted XEX rip is installed under. The rip's own
// top-level folder normally names the game, but a multi-disc rip names it after the disc, so
// Grand Theft Auto V arrived on the console as a game called "Disc2". The release title
// replaces such a placeholder; every other rip keeps the name it shipped with.
func xexDestinationName(xexFolder, archiveFolder, gameName string) string {
	name := archiveFolder
	if helpers.IsGenericDiscFolderName(name) {
		if release := helpers.SanitizeFilename(models.ExtractReleaseTitle(gameName)); release != "" {
			name = release
		}
	}
	return helpers.XEXFolderName(xexFolder, name)
}

// installCompanionDiscContent writes the install-disc payloads that shipped in the same
// archive as the playable folder. A scene rip of a two-disc release packs the whole release
// together, and the XEX paths install only the folder holding default.xex — so without this
// the install disc that Grand Theft Auto V, Metal Gear Solid V or Forza Motorsport 3 need in
// order to boot went to the scratch cleanup, and the console got a game that cannot start.
//
// The payload is written before the playable folder: a failure here must stop the job while
// the provider fallback can still look for a release that fits the destination, instead of
// leaving a half-installed game reported as ready.
func (s *Service) installCompanionDiscContent(gameName, extDir, gameFolder string, xboxConn *models.XboxConnection) error {
	payloads := helpers.FindCompanionContentPayloads(extDir, gameFolder)
	if len(payloads) == 0 {
		return nil
	}
	s.App.Logf("MULTI-DISC [%s]: %d payload(s) de disco de instalação encontrados junto da pasta jogável %s",
		gameName, len(payloads), filepath.Base(gameFolder))

	for i, payload := range payloads {
		s.App.LogStatus(gameName, "Processing", fmt.Sprintf("Gravando disco de instalação %d/%d (TitleID %s)...",
			i+1, len(payloads), payload.TitleID))
		s.App.Logf("MULTI-DISC [%s]: %s -> Content/0000000000000000/%s/%s",
			gameName, payload.Dir, payload.TitleID, payload.TypeDir)

		switch {
		case xboxConn != nil && xboxConn.Mode == "ftp":
			// No pending-FTP fallback here: the payload lives inside the extraction scratch,
			// which is removed when this job returns, so a retry would find no source.
			if err := s.FTP.TransferContent(payload.Dir, xboxConn, gameName, payload.TitleID, payload.TypeDir); err != nil {
				return fmt.Errorf("transferir disco de instalação (TitleID %s): %w", payload.TitleID, err)
			}
		case xboxConn != nil && xboxConn.Mode == "local":
			if err := s.InstallContentLocal(payload.Dir, xboxConn.LocalRoot, gameName, payload.TitleID, payload.TypeDir); err != nil {
				return fmt.Errorf("gravar disco de instalação (TitleID %s): %w", payload.TitleID, err)
			}
		default:
			// No destination was registered, so the job only packages the playable folder for
			// a manual install. The manifest carries a single type, and a XEX manifest has
			// nowhere to name a content destination.
			s.App.Logf("MULTI-DISC [%s]: sem destino registrado — o disco de instalação %s/%s não entra no pacote manual",
				gameName, payload.TitleID, payload.TypeDir)
		}
	}
	return nil
}
