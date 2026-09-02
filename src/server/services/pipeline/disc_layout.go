package pipeline

import (
	"fmt"

	"godsend/models"
	"godsend/utils"
)

// resolveISOInstallType makes the downloaded ISO authoritative. Catalog names
// and compatibility rows are useful before download, but cannot safely decide
// whether a retail disc is playable or is an STFS content installer.
func (s *Service) resolveISOInstallType(gameName, isoPath, requested string) (string, error) {
	info, err := utils.ProbeISODiscInfo(isoPath)
	if err != nil {
		return "", fmt.Errorf("validar tipo do disco: %w", err)
	}
	layout, err := utils.ProbeISOInstallLayout(isoPath, info)
	if err != nil {
		return "", fmt.Errorf("validar conteudo do disco: %w", err)
	}
	compatTitleID := info.TitleID
	if guessed := models.GuessTitleIDFromMultiDiscName(gameName); (compatTitleID == 0 || models.IsContentDiscPlaceholderTitleID(compatTitleID)) && guessed != 0 {
		compatTitleID = guessed
	}
	compatDiscNumber := info.DiscNumber
	if compatDiscNumber == 0 {
		compatDiscNumber = models.DiscNumberFromName(gameName)
	}
	rec := models.DiscCompat(compatTitleID, compatDiscNumber)
	if rec.InstallType == "xex" {
		if requested != "xex" {
			return "", fmt.Errorf("este disco nao e compativel com GOD; selecione instalacao XEX: %s", rec.Notes)
		}
		return "xex", nil
	}
	if requested == "xex" {
		return requested, nil
	}
	resolved := "god"
	if rec.InstallType == "content" || layout.HasInstallableContent {
		resolved = "content"
	}
	// Blacklist Disc 2 is a documented mixed disc. Keep the playable GOD path;
	// embedded content still needs a separate extraction workflow.
	if compatTitleID == 0x555308B6 && compatDiscNumber == 2 {
		resolved = "god"
	}
	if requested != resolved {
		s.App.Logf("DISC LAYOUT [%s]: pedido=%s corrigido=%s TitleID=%08X disco=%d/%d conteudo=%t",
			gameName, requested, resolved, info.TitleID, info.DiscNumber, info.DiscCount, layout.HasInstallableContent)
	}
	return resolved, nil
}
