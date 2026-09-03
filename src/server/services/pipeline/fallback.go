// fallback.go — Pipeline to sequentially try multiple download providers with fallback.
package pipeline

import (
	"errors"
	"fmt"
	"strings"

	"godsend/app"
	"godsend/models"
	cacheService "godsend/services/cache"
)

func isFAT32LimitError(err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, ErrFAT32FileSizeLimit) ||
		strings.Contains(err.Error(), "excede o limite maximo de 4 GB") ||
		strings.Contains(err.Error(), "incompativel com pendrive FAT32")
}

func isDownloadTooSlowError(err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, app.ErrDownloadTooSlow) ||
		strings.Contains(err.Error(), "muito lento")
}

// ProcessGameWithFallback sequentially tries the given providers in priority order for the game download and installation.
func (s *Service) ProcessGameWithFallback(gameName, platform string, providers []string) {
	s.App.Logf("=== Fallback Pipeline: %s (%s) ===", gameName, platform)

	var lastErr error
	var providerErrors []string
	var slowProviders []string

	recordError := func(provider string, err error) {
		if err == nil {
			return
		}
		lastErr = err
		providerErrors = append(providerErrors, fmt.Sprintf("%s: %v", provider, err))
		if isDownloadTooSlowError(err) {
			slowProviders = append(slowProviders, provider)
		}
	}

	executeProvider := func(p string) error {
		p = strings.TrimSpace(strings.ToLower(p))
		switch p {
		case "huggingface":
			if platform != "xbox360" {
				s.App.Logf("FALLBACK: HuggingFace ignorado porque a plataforma é %s", platform)
				return fmt.Errorf("plataforma %s nao suportada no HuggingFace", platform)
			}
			entry, ok := cacheService.FindHuggingFaceEntry(s.App, gameName, platform)
			if !ok && !cacheService.HasHuggingFaceCatalog(s.App, platform) && s.HuggingFace != nil {
				s.App.Logf("FALLBACK: HuggingFace catalog empty in memory, building for %s...", platform)
				s.HuggingFace.Build(platform)
				entry, ok = cacheService.FindHuggingFaceEntry(s.App, gameName, platform)
			}
			if !ok {
				return fmt.Errorf("jogo nao encontrado no catalogo")
			}
			return s.ProcessHuggingFaceGameWithErr(gameName, entry.FileName)

		case "ia", "internet_archive", "internetarchive":
			if platform == "games" {
				return s.ProcessGenericGameWithErr(gameName)
			} else if platform == "digital" || platform == "xbla" || platform == "dlc" || platform == "xblig" {
				return s.ProcessDigitalWithErr(gameName, platform)
			}
			return s.ProcessGameWithErr(gameName, platform)

		case "minerva":
			var entry models.MinervaEntry
			var ok bool
			if s.Minerva != nil {
				entry, ok = s.Minerva.FindEntry(gameName, platform)
			}
			if !ok {
				return fmt.Errorf("jogo nao encontrado no catalogo")
			}
			effPlatform := platform
			if entry.Platform != "" {
				effPlatform = entry.Platform
			}
			if effPlatform == "games" {
				return s.ProcessMinervaGenericGameWithErr(gameName, entry)
			} else if effPlatform == "digital" || effPlatform == "xbla" || effPlatform == "dlc" || effPlatform == "xblig" {
				return s.ProcessMinervaDigitalWithErr(gameName, entry, effPlatform)
			}
			return s.ProcessMinervaGameWithErr(gameName, entry, effPlatform)

		default:
			return fmt.Errorf("provedor desconhecido: %s", p)
		}
	}

	for _, p := range providers {
		p = strings.TrimSpace(strings.ToLower(p))
		s.cleanupGameScratch(gameName)
		s.App.Logf("FALLBACK: Trying provider '%s' for game '%s'", p, gameName)

		err := executeProvider(p)
		if errors.Is(err, app.ErrJobCancelled) {
			s.cleanupGameScratch(gameName)
			return
		}
		if err == nil {
			s.cleanupCompletedLocalScratch(gameName)
			s.App.Logf("FALLBACK SUCCESS: %s for %s", p, gameName)
			return
		}
		if isFAT32LimitError(err) {
			s.App.Logf("FALLBACK WARNING: %s falhou por limite de 4 GB do FAT32 para %s — alternando para provedor ISO/GOD", p, gameName)
			recordError(p, err)
			continue
		}
		if errors.Is(err, ErrLocalDelivery) {
			s.App.LogStatus(gameName, "Error", "Falha no dispositivo local. O download concluido foi preservado para nova tentativa: "+err.Error())
			return
		}
		if isDownloadTooSlowError(err) {
			s.App.Logf("FALLBACK WARNING: %s cancelado por velocidade baixa para %s — alternando provedor", p, gameName)
		} else {
			s.App.Logf("FALLBACK ERROR: %s falhou para %s: %v — alternando provedor", p, gameName, err)
		}
		recordError(p, err)
	}

	// Se todas as fontes falharam e ao menos uma delas foi por velocidade baixa,
	// retoma no melhor provedor que estava baixando, com monitoramento de velocidade desativado.
	if len(slowProviders) > 0 && !s.App.IsGameJobCancelled(gameName) {
		chosen := slowProviders[0]
		s.App.Logf("FALLBACK: Todas as fontes apresentaram velocidade baixa. Retomando download irrestrito em '%s'...", chosen)
		s.App.LogStatus(gameName, "Processing", fmt.Sprintf("Retomando download via %s...", chosen))
		s.App.SetSpeedCheckBypass(gameName, true)
		defer s.App.SetSpeedCheckBypass(gameName, false)

		s.cleanupGameScratch(gameName)
		retryErr := executeProvider(chosen)
		if errors.Is(retryErr, app.ErrJobCancelled) {
			s.cleanupGameScratch(gameName)
			return
		}
		if retryErr == nil {
			s.cleanupCompletedLocalScratch(gameName)
			s.App.Logf("FALLBACK SUCCESS (Unrestricted): %s for %s", chosen, gameName)
			return
		}
		if errors.Is(retryErr, ErrLocalDelivery) {
			s.App.LogStatus(gameName, "Error", "Falha no dispositivo local. O download concluido foi preservado para nova tentativa: "+retryErr.Error())
			return
		}
		lastErr = retryErr
		recordError(chosen+" (retry)", retryErr)
	}

	s.cleanupGameScratch(gameName)
	message := fmt.Sprintf("Download falhou em todas as fontes. Ultimo erro: %v", lastErr)
	if len(providerErrors) > 0 {
		message = "Download falhou em todas as fontes. Erros: " + strings.Join(providerErrors, " | ")
	}
	s.App.LogStatus(gameName, "Error", message)
}
