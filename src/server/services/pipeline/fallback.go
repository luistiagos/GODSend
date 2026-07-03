// fallback.go — Pipeline to sequentially try multiple download providers with fallback.
package pipeline

import (
	"fmt"
	"strings"
)

// ProcessGameWithFallback sequentially tries the given providers in priority order for the game download and installation.
func (s *Service) ProcessGameWithFallback(gameName, platform string, providers []string) {
	s.App.Logf("=== Fallback Pipeline: %s (%s) ===", gameName, platform)
	var lastErr error
	for _, p := range providers {
		p = strings.TrimSpace(strings.ToLower(p))
		s.App.Logf("FALLBACK: Trying provider '%s' for game '%s'", p, gameName)
		switch p {
		case "huggingface":
			if platform == "xbox360" {
				s.App.GameEntryMapMu.RLock()
				entry, ok := s.App.GameEntryMap["hf_"+platform+"\x00"+strings.ToLower(gameName)]
				s.App.GameEntryMapMu.RUnlock()
				if !ok {
					lastErr = fmt.Errorf("HuggingFace: jogo não encontrado no catálogo")
					s.App.Logf("FALLBACK ERROR: %v", lastErr)
					continue
				}
				lastErr = s.ProcessHuggingFaceGameWithErr(gameName, entry.FileName)
				if lastErr == nil {
					s.App.Logf("FALLBACK SUCCESS: HuggingFace for %s", gameName)
					return
				}
				s.App.Logf("FALLBACK ERROR: HuggingFace failed for %s: %v", gameName, lastErr)
			} else {
				s.App.Logf("FALLBACK: HuggingFace skip because platform is %s", platform)
			}
		case "ia", "internet_archive", "internetarchive":
			if platform == "games" {
				lastErr = s.ProcessGenericGameWithErr(gameName)
			} else if platform == "digital" || platform == "xbla" || platform == "dlc" || platform == "xblig" {
				lastErr = s.ProcessDigitalWithErr(gameName, platform)
			} else {
				lastErr = s.ProcessGameWithErr(gameName, platform)
			}
			if lastErr == nil {
				s.App.Logf("FALLBACK SUCCESS: Internet Archive for %s", gameName)
				return
			}
			s.App.Logf("FALLBACK ERROR: Internet Archive failed for %s: %v", gameName, lastErr)
		case "minerva":
			s.App.MinervaEntryMapMu.RLock()
			entry, ok := s.App.MinervaEntryMap[strings.ToLower(gameName)]
			s.App.MinervaEntryMapMu.RUnlock()
			if !ok {
				// Try fuzzy match
				s.App.MinervaEntryMapMu.RLock()
				for k, e := range s.App.MinervaEntryMap {
					if strings.Contains(k, strings.ToLower(gameName)) {
						entry = e
						ok = true
						break
					}
				}
				s.App.MinervaEntryMapMu.RUnlock()
			}
			if !ok {
				lastErr = fmt.Errorf("Minerva: jogo não encontrado no catálogo")
				s.App.Logf("FALLBACK ERROR: %v", lastErr)
				continue
			}

			if platform == "games" {
				lastErr = s.ProcessMinervaGenericGameWithErr(gameName, entry)
			} else if platform == "digital" || platform == "xbla" || platform == "dlc" || platform == "xblig" {
				lastErr = s.ProcessMinervaDigitalWithErr(gameName, entry, platform)
			} else {
				lastErr = s.ProcessMinervaGameWithErr(gameName, entry, platform)
			}
			if lastErr == nil {
				s.App.Logf("FALLBACK SUCCESS: Minerva for %s", gameName)
				return
			}
			s.App.Logf("FALLBACK ERROR: Minerva failed for %s: %v", gameName, lastErr)
		}
	}
	s.App.LogStatus(gameName, "Error", fmt.Sprintf("Download falhou em todas as fontes. Último erro: %v", lastErr))
}
