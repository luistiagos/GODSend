package cache

import (
	"path/filepath"
	"strings"
	"unicode"

	"godsend/infrastructure/helpers"
)

// NormalizeTitleForMatching returns a stable comparison key for catalog titles.
// It removes source metadata tags like regions/languages while keeping edition
// words such as "GOTY" or "Game of the Year".
func NormalizeTitleForMatching(title string) string {
	title = cleanTitleName(title)
	if title == "" {
		return ""
	}
	title = stripMetadataGroups(title)
	title = strings.Map(normalizeTitleRune, title)
	normalized := strings.Join(strings.Fields(strings.ToLower(title)), " ")
	normalized = strings.NewReplacer(
		"game of the year edition", "goty",
		"game of the year", "goty",
		"goty edition", "goty",
	).Replace(normalized)
	return strings.Join(strings.Fields(normalized), " ")
}

// titleMatchScore ranks variants which share the same normalized base title.
// Region, language and disc metadata make the result deterministic without
// preventing a cross-provider fallback when an exact variant is unavailable.
func titleMatchScore(catalogTitle, requestedTitle string) int {
	if !TitleMatches(catalogTitle, requestedTitle) {
		return -1
	}
	if strings.EqualFold(cleanTitleName(catalogTitle), cleanTitleName(requestedTitle)) {
		return 1 << 30
	}

	catalogMetadata := titleMetadataTokens(catalogTitle)
	requestedMetadata := titleMetadataTokens(requestedTitle)
	score := 1000
	for token := range catalogMetadata {
		if _, ok := requestedMetadata[token]; ok {
			score += 4
		} else {
			score--
		}
	}
	for token := range requestedMetadata {
		if _, ok := catalogMetadata[token]; !ok {
			score--
		}
	}
	return score
}

func cleanTitleName(title string) string {
	title = strings.TrimSpace(helpers.DecodeMinervaName(title))
	if ext := filepath.Ext(title); ext != "" {
		title = strings.TrimSuffix(title, ext)
	}
	return strings.TrimSpace(title)
}

func titleMetadataTokens(title string) map[string]struct{} {
	tokens := make(map[string]struct{})
	runes := []rune(cleanTitleName(title))
	for i := 0; i < len(runes); i++ {
		open := runes[i]
		if open != '(' && open != '[' {
			continue
		}
		close := ')'
		if open == '[' {
			close = ']'
		}
		end := -1
		for j := i + 1; j < len(runes); j++ {
			if runes[j] == close {
				end = j
				break
			}
		}
		if end == -1 {
			continue
		}
		groupTokens := splitMetadataGroup(string(runes[i+1 : end]))
		if metadataTokensOnly(groupTokens) {
			for _, token := range groupTokens {
				tokens[token] = struct{}{}
			}
		}
		i = end
	}
	return tokens
}

// TitleMatches compares two catalog titles after removing source metadata.
// Edition words remain significant so a base release does not match a GOTY entry.
func TitleMatches(catalogTitle, requestedTitle string) bool {
	catalog := NormalizeTitleForMatching(catalogTitle)
	requested := NormalizeTitleForMatching(requestedTitle)
	if catalog == "" || requested == "" {
		return false
	}
	if catalog == requested {
		return true
	}
	catalogCompact := strings.ReplaceAll(catalog, " ", "")
	requestedCompact := strings.ReplaceAll(requested, " ", "")
	if len(catalogCompact) >= 4 && catalogCompact == requestedCompact {
		return true
	}
	return false
}

func stripMetadataGroups(title string) string {
	var b strings.Builder
	runes := []rune(title)
	for i := 0; i < len(runes); i++ {
		open := runes[i]
		if open != '(' && open != '[' {
			b.WriteRune(open)
			continue
		}
		close := ')'
		if open == '[' {
			close = ']'
		}
		end := -1
		for j := i + 1; j < len(runes); j++ {
			if runes[j] == close {
				end = j
				break
			}
		}
		if end == -1 {
			b.WriteRune(open)
			continue
		}
		group := string(runes[i+1 : end])
		if !isMetadataGroup(group) {
			b.WriteRune(' ')
			b.WriteString(group)
			b.WriteRune(' ')
		}
		i = end
	}
	return b.String()
}

func isMetadataGroup(group string) bool {
	return metadataTokensOnly(splitMetadataGroup(group))
}

func splitMetadataGroup(group string) []string {
	group = strings.ToLower(group)
	group = strings.NewReplacer(
		"/", " ",
		"\\", " ",
		"-", " ",
		"_", " ",
		".", " ",
		";", " ",
		",", " ",
	).Replace(group)
	return strings.Fields(group)
}

func metadataTokensOnly(tokens []string) bool {
	if len(tokens) == 0 {
		return true
	}
	for _, token := range tokens {
		if isMetadataToken(token) {
			continue
		}
		return false
	}
	return true
}

func isMetadataToken(token string) bool {
	if token == "" {
		return true
	}
	if _, ok := metadataTitleTokens[token]; ok {
		return true
	}
	if isDigits(token) {
		return true
	}
	if strings.HasPrefix(token, "v") && isVersionDigits(strings.TrimPrefix(token, "v")) {
		return true
	}
	if strings.HasPrefix(token, "rev") && isVersionDigits(strings.TrimPrefix(token, "rev")) {
		return true
	}
	return false
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

func isVersionDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !unicode.IsDigit(r) && r != '.' {
			return false
		}
	}
	return true
}

func normalizeTitleRune(r rune) rune {
	switch r {
	case '\'', '`', 0x2018, 0x2019:
		return -1
	case '-', '_', ':', ';', ',', '.', '/', '\\', '|', '+':
		return ' '
	case 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212:
		return ' '
	default:
		if unicode.IsSpace(r) {
			return ' '
		}
		return unicode.ToLower(r)
	}
}

var metadataTitleTokens = map[string]struct{}{
	"asia":      {},
	"ar":        {},
	"au":        {},
	"australia": {},
	"beta":      {},
	"br":        {},
	"brazil":    {},
	"canada":    {},
	"cn":        {},
	"cs":        {},
	"da":        {},
	"de":        {},
	"demo":      {},
	"disc":      {},
	"disk":      {},
	"dlc":       {},
	"en":        {},
	"el":        {},
	"es":        {},
	"eu":        {},
	"europe":    {},
	"fi":        {},
	"fr":        {},
	"france":    {},
	"germany":   {},
	"hu":        {},
	"it":        {},
	"italy":     {},
	"ja":        {},
	"jp":        {},
	"japan":     {},
	"jpn":       {},
	"ko":        {},
	"korea":     {},
	"latin":     {},
	"nl":        {},
	"no":        {},
	"ntsc":      {},
	"pal":       {},
	"pl":        {},
	"promo":     {},
	"pt":        {},
	"region":    {},
	"rev":       {},
	"rf":        {},
	"ru":        {},
	"russia":    {},
	"se":        {},
	"sk":        {},
	"spain":     {},
	"sv":        {},
	"the":       {},
	"tw":        {},
	"tr":        {},
	"u":         {},
	"uk":        {},
	"us":        {},
	"usa":       {},
	"world":     {},
	"x360":      {},
	"xbla":      {},
	"xblig":     {},
	"xbox":      {},
	"zh":        {},
}
