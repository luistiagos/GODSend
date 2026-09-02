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
	recordError := func(provider string, err error) {
		if err == nil {
			return
		}
		lastErr = err
		providerErrors = append(providerErrors, fmt.Sprintf("%s: %v", provider, err))
	}
	for _, p := range providers {
		p = strings.TrimSpace(strings.ToLower(p))
		s.cleanupGameScratch(gameName)
		s.App.Logf("FALLBACK: Trying provider '%s' for game '%s'", p, gameName)

		switch p {
		case "huggingface":
			if platform == "xbox360" {
				entry, ok := cacheService.FindHuggingFaceEntry(s.App, gameName, platform)
				if !ok && !cacheService.HasHuggingFaceCatalog(s.App, platform) && s.HuggingFace != nil {
					s.App.Logf("FALLBACK: HuggingFace catalog empty in memory, building for %s...", platform)
					s.HuggingFace.Build(platform)
					entry, ok = cacheService.FindHuggingFaceEntry(s.App, gameName, platform)
				}

				if !ok {
					lastErr = fmt.Errorf("jogo nao encontrado no catalogo")
					recordError("HuggingFace", lastErr)
					s.App.Logf("FALLBACK: %v — tentando próximo provedor", lastErr)
					continue
				}

				lastErr = s.ProcessHuggingFaceGameWithErr(gameName, entry.FileName)
				if errors.Is(lastErr, app.ErrJobCancelled) {
					s.cleanupGameScratch(gameName)
					return
				}
				if lastErr == nil {
					s.cleanupCompletedLocalScratch(gameName)
					s.App.Logf("FALLBACK SUCCESS: HuggingFace for %s", gameName)
					return
				}
				if isFAT32LimitError(lastErr) {
					s.App.Logf("FALLBACK WARNING: HuggingFace falhou por limite de 4 GB do FAT32 para %s — alternando para provedor ISO/GOD", gameName)
					recordError("HuggingFace", lastErr)
					continue
				}
				if errors.Is(lastErr, ErrLocalDelivery) {
					s.App.LogStatus(gameName, "Error", "Falha no dispositivo local. O download concluido foi preservado para nova tentativa: "+lastErr.Error())
					return
				}
				if isDownloadTooSlowError(lastErr) {
					s.App.Logf("FALLBACK WARNING: HuggingFace cancelado por velocidade baixa (< 1.0 MB/s) para %s — alternando provedor", gameName)
				} else {
					s.App.Logf("FALLBACK ERROR: HuggingFace falhou para %s: %v — alternando provedor", gameName, lastErr)
				}
				recordError("HuggingFace", lastErr)
			} else {
				s.App.Logf("FALLBACK: HuggingFace ignorado porque a plataforma é %s", platform)
			}

		case "ia", "internet_archive", "internetarchive":
			if platform == "games" {
				lastErr = s.ProcessGenericGameWithErr(gameName)
			} else if platform == "digital" || platform == "xbla" || platform == "dlc" || platform == "xblig" {
				lastErr = s.ProcessDigitalWithErr(gameName, platform)
			} else {
				lastErr = s.ProcessGameWithErr(gameName, platform)
			}
			if errors.Is(lastErr, app.ErrJobCancelled) {
				s.cleanupGameScratch(gameName)
				return
			}
			if lastErr == nil {
				s.cleanupCompletedLocalScratch(gameName)
				s.App.Logf("FALLBACK SUCCESS: Internet Archive for %s", gameName)
				return
			}
			if isFAT32LimitError(lastErr) {
				s.App.Logf("FALLBACK WARNING: Internet Archive falhou por limite de 4 GB do FAT32 para %s — alternando provedor", gameName)
				recordError("Internet Archive", lastErr)
				continue
			}
			if errors.Is(lastErr, ErrLocalDelivery) {
				s.App.LogStatus(gameName, "Error", "Falha no dispositivo local. O download concluido foi preservado para nova tentativa: "+lastErr.Error())
				return
			}
			if isDownloadTooSlowError(lastErr) {
				s.App.Logf("FALLBACK WARNING: Internet Archive cancelado por velocidade baixa (< 1.0 MB/s) para %s — alternando provedor", gameName)
			} else {
				s.App.Logf("FALLBACK ERROR: Internet Archive falhou para %s: %v — alternando provedor", gameName, lastErr)
			}
			recordError("Internet Archive", lastErr)

		case "minerva":
			var entry models.MinervaEntry
			var ok bool
			if s.Minerva != nil {
				entry, ok = s.Minerva.FindEntry(gameName, platform)
			}
			if !ok {
				lastErr = fmt.Errorf("jogo nao encontrado no catalogo")
				recordError("Minerva", lastErr)
				s.App.Logf("FALLBACK: %v", lastErr)
				continue
			}

			effPlatform := platform
			if entry.Platform != "" {
				effPlatform = entry.Platform
			}

			if effPlatform == "games" {
				lastErr = s.ProcessMinervaGenericGameWithErr(gameName, entry)
			} else if effPlatform == "digital" || effPlatform == "xbla" || effPlatform == "dlc" || effPlatform == "xblig" {
				lastErr = s.ProcessMinervaDigitalWithErr(gameName, entry, effPlatform)
			} else {
				lastErr = s.ProcessMinervaGameWithErr(gameName, entry, effPlatform)
			}
			if errors.Is(lastErr, app.ErrJobCancelled) {
				s.cleanupGameScratch(gameName)
				return
			}
			if lastErr == nil {
				s.cleanupCompletedLocalScratch(gameName)
				s.App.Logf("FALLBACK SUCCESS: Minerva for %s", gameName)
				return
			}
			if isFAT32LimitError(lastErr) {
				s.App.Logf("FALLBACK WARNING: Minerva falhou por limite de 4 GB do FAT32 para %s — alternando provedor", gameName)
				recordError("Minerva", lastErr)
				continue
			}
			if errors.Is(lastErr, ErrLocalDelivery) {
				s.App.LogStatus(gameName, "Error", "Falha no dispositivo local. O material baixado foi preservado para nova tentativa: "+lastErr.Error())
				return
			}
			if isDownloadTooSlowError(lastErr) {
				s.App.Logf("FALLBACK WARNING: Minerva Torrent cancelado por velocidade baixa (< 1.0 MB/s) para %s — alternando provedor", gameName)
			} else {
				s.App.Logf("FALLBACK ERROR: Minerva falhou para %s: %v", gameName, lastErr)
			}
			recordError("Minerva", lastErr)
		}
	}
	s.cleanupGameScratch(gameName)
	message := fmt.Sprintf("Download falhou em todas as fontes. Ultimo erro: %v", lastErr)
	if len(providerErrors) > 0 {
		message = "Download falhou em todas as fontes. Erros: " + strings.Join(providerErrors, " | ")
	}
	s.App.LogStatus(gameName, "Error", message)
}
