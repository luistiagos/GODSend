package pipeline

import (
	"errors"
	"fmt"

	"godsend/models"
	"godsend/utils"
)

// resolveISOInstallType makes the downloaded ISO authoritative. Catalog names
// and compatibility rows are useful before download, but cannot safely decide
// whether a retail disc is playable or is an STFS content installer.
func (s *Service) resolveISOInstallType(gameName, isoPath, requested string) (string, error) {
	info, execErr := utils.ProbeISODiscInfo(isoPath)
	if execErr != nil && !errors.Is(execErr, utils.ErrNoExecutable) {
		return "", fmt.Errorf("validar tipo do disco: %w", execErr)
	}
	if info == nil {
		info = &utils.TitleExecInfo{}
	}
	layout, err := utils.ProbeISOInstallLayout(isoPath, info)
	if err != nil {
		return "", fmt.Errorf("validar conteudo do disco: %w", err)
	}
	compatTitleID := info.TitleID
	if guessed := models.GuessTitleIDFromMultiDiscName(gameName); (compatTitleID == 0 || models.IsContentDiscPlaceholderTitleID(compatTitleID)) && guessed != 0 {
		compatTitleID = guessed
	}
	if compatTitleID == 0 && layout.ContentTitleID != 0 {
		compatTitleID = layout.ContentTitleID
	}
	compatDiscNumber := info.DiscNumber
	if compatDiscNumber == 0 {
		compatDiscNumber = models.DiscNumberFromName(gameName)
	}
	rec := models.DiscCompat(compatTitleID, compatDiscNumber)
	resolved := "god"
	if rec.InstallType == "xex" {
		if execErr != nil {
			return "", fmt.Errorf("validar tipo do disco: %w", execErr)
		}
		resolved = "xex"
	} else if requested == "xex" {
		if execErr != nil {
			return "", fmt.Errorf("validar tipo do disco: %w", execErr)
		}
		resolved = "xex"
	} else if rec.InstallType == "content" || layout.HasInstallableContent {
		resolved = "content"
	}
	// Blacklist Disc 2 is a documented mixed disc. Keep the playable GOD path;
	// embedded content still needs a separate extraction workflow.
	if compatTitleID == 0x555308B6 && compatDiscNumber == 2 {
		resolved = "god"
	}
	if execErr != nil && resolved != "content" {
		return "", fmt.Errorf("validar tipo do disco: %w", execErr)
	}
	if requested != resolved {
		s.App.Logf("DISC LAYOUT [%s]: pedido=%s corrigido=%s TitleID=%08X disco=%d/%d conteudo=%t",
			gameName, requested, resolved, info.TitleID, info.DiscNumber, info.DiscCount, layout.HasInstallableContent)
	}
	return resolved, nil
}
