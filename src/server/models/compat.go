// compat.go — verified multi-disc compatibility hints.
package models

import (
	"regexp"
	"strconv"
	"strings"
)

// DiscCompatRec holds the recommended install method for a known disc.
type DiscCompatRec struct {
	InstallType string // "god", "content", or "xex"
	Notes       string
}

type discCompatKey struct {
	TitleID    uint32
	DiscNumber byte
}

// DiscCompatTable contains only disc-specific exceptions verified against the
// compatibility notes linked from docs/reference/multi-disc-compatibility.md.
// The ISO structure probe remains authoritative once the image is available.
var DiscCompatTable = map[discCompatKey]DiscCompatRec{
	{0x5345085E, 1}: {InstallType: "content", Notes: "Alien: Isolation Disc 1 is the installation/content disc"},
	{0x555308C2, 2}: {InstallType: "xex", Notes: "Assassin's Creed IV Disc 2 is a No-GOD multiplayer disc; extract as XEX"},
	{0x57520802, 2}: {InstallType: "content", Notes: "Batman: Arkham City GOTY Disc 2 contains DLC"},
	{0x57520828, 2}: {InstallType: "content", Notes: "Batman: Arkham Origins Disc 2 contains installable content"},
	{0x454109BA, 1}: {InstallType: "content", Notes: "Battlefield 4 Disc 1 is the installation/content disc"},
	{0x545407D8, 2}: {InstallType: "content", Notes: "BioShock bonus disc contains installable content"},
	{0x54540861, 2}: {InstallType: "content", Notes: "BioShock 2 bonus disc contains installable content"},
	{0x5454085D, 2}: {InstallType: "content", Notes: "BioShock Infinite bonus disc contains installable content"},
	{0x41560914, 2}: {InstallType: "content", Notes: "Call of Duty: Advanced Warfare Disc 2 contains installable content"},
	{0x415608FC, 2}: {InstallType: "content", Notes: "Call of Duty: Ghosts Disc 2 contains installable content"},
	{0x465307E4, 2}: {InstallType: "content", Notes: "Dark Souls II: Scholar of the First Sin Disc 2 contains installable content"},
	{0x425307E3, 2}: {InstallType: "content", Notes: "Dishonored GOTY Disc 2 contains DLC"},
	{0x43430814, 2}: {InstallType: "content", Notes: "Dragon's Dogma: Dark Arisen Disc 2 contains installable content"},
	{0x425307D1, 2}: {InstallType: "content", Notes: "Oblivion GOTY Disc 2 contains DLC"},
	{0x425307E6, 2}: {InstallType: "content", Notes: "Skyrim Legendary Edition Disc 2 contains DLC"},
	{0x425307D5, 2}: {InstallType: "content", Notes: "Fallout 3 GOTY Disc 2 contains DLC"},
	{0x425307E0, 2}: {InstallType: "content", Notes: "Fallout: New Vegas Ultimate Edition Disc 2 contains DLC"},
	{0x4D5307EA, 2}: {InstallType: "content", Notes: "Forza Motorsport 2 bonus disc contains installable content"},
	{0x4D53084D, 2}: {InstallType: "content", Notes: "Forza Motorsport 3 Disc 2 is a Content Install Disc"},
	{0x4D530910, 2}: {InstallType: "content", Notes: "Forza Motorsport 4 Disc 2 is a Content Install Disc"},
	{0x545408A7, 1}: {InstallType: "content", Notes: "Grand Theft Auto V Disc 1 is the installation/content disc"},
	{0x545407E6, 2}: {InstallType: "content", Notes: "Mafia II bonus disc contains installable content"},
	{0x4D5307E8, 2}: {InstallType: "content", Notes: "Mass Effect bonus disc contains installable content"},
	{0x4B4E085E, 1}: {InstallType: "content", Notes: "Metal Gear Solid V Disc 1 is the installation/content disc"},
	{0x5451086D, 1}: {InstallType: "content", Notes: "Saints Row: The Third Full Package Disc 1 contains installable content"},
	{0x4B4D07F6, 1}: {InstallType: "content", Notes: "Saints Row IV National Treasure Edition Disc 1 contains installable content"},
	{0x555308B6, 2}: {InstallType: "god", Notes: "Splinter Cell Blacklist Disc 2 is mixed: GOD plus embedded content"},
}

// DiscCompat returns a verified hint for a specific disc. Unknown discs default
// to GOD; after download, the backend inspects the ISO and overrides this hint
// when it finds real STFS install packages.
func DiscCompat(titleID uint32, discNumber byte) DiscCompatRec {
	if rec, ok := DiscCompatTable[discCompatKey{TitleID: titleID, DiscNumber: discNumber}]; ok {
		return rec
	}
	return DiscCompatRec{InstallType: "god", Notes: "Default seguro; a estrutura da ISO sera validada apos o download"}
}

var multiDiscNumberPattern = regexp.MustCompile(`(?i)(?:disc|disk|dvd|cd)\s*([2-9])\b`)

// DiscNumberFromName extracts Redump-style Disc/Disk/DVD/CD numbering.
func DiscNumberFromName(name string) byte {
	match := multiDiscNumberPattern.FindStringSubmatch(name)
	if len(match) != 2 {
		return 0
	}
	n, err := strconv.Atoi(match[1])
	if err != nil {
		return 0
	}
	return byte(n)
}

// IsMultiDiscGameName returns true for Disc 2+ catalog entries.
func IsMultiDiscGameName(name string) bool {
	return DiscNumberFromName(name) >= 2
}

type titleNameHint struct {
	titleID   uint32
	required  []string
	forbidden []string
}

// These hints are fallbacks for placeholder-XEX content discs. Package headers
// inside the ISO are preferred and normally provide the real parent Title ID.
var titleNameHints = []titleNameHint{
	{0x4D530910, []string{"forza", "motorsport", "4"}, nil},
	{0x4D530910, []string{"forza 4"}, nil},
	{0x4D53084D, []string{"forza", "motorsport", "3"}, nil},
	{0x4D53084D, []string{"forza 3"}, nil},
	{0x4D5307EA, []string{"forza", "motorsport", "2"}, nil},
	{0x4D5307EA, []string{"forza 2"}, nil},
	{0x5454087C, []string{"borderlands", "2"}, []string{"pre-sequel"}},
	{0x545407E7, []string{"borderlands"}, []string{"borderlands 2", "pre-sequel"}},
	{0x555308C2, []string{"assassin's creed iv", "black flag"}, nil},
	{0x57520802, []string{"batman", "arkham city"}, nil},
	{0x57520828, []string{"batman", "arkham origins"}, nil},
	{0x5454085D, []string{"bioshock", "infinite"}, []string{"bioshock 2"}},
	{0x54540861, []string{"bioshock", "2"}, []string{"infinite"}},
	{0x545407D8, []string{"bioshock"}, []string{"bioshock 2", "infinite"}},
	{0x465307E4, []string{"dark souls ii", "scholar"}, nil},
	{0x425307E3, []string{"dishonored", "game of the year"}, nil},
	{0x43430814, []string{"dragon's dogma", "dark arisen"}, nil},
	{0x425307D1, []string{"oblivion", "game of the year"}, nil},
	{0x425307E6, []string{"skyrim", "legendary"}, nil},
	{0x425307D5, []string{"fallout 3", "game of the year"}, nil},
	{0x425307E0, []string{"fallout", "new vegas", "ultimate"}, nil},
	{0x545407E6, []string{"mafia", "ii"}, nil},
	{0x4D5307E8, []string{"mass effect"}, []string{"mass effect 2", "mass effect 3"}},
	{0x5451086D, []string{"saints row", "third", "full package"}, nil},
	{0x4B4D07F6, []string{"saints row iv", "national treasure"}, nil},
}

// GuessTitleIDFromMultiDiscName maps known catalog names to verified Title IDs.
func GuessTitleIDFromMultiDiscName(name string) uint32 {
	lower := strings.ToLower(name)
	for _, hint := range titleNameHints {
		matches := true
		for _, required := range hint.required {
			if !strings.Contains(lower, required) {
				matches = false
				break
			}
		}
		if !matches {
			continue
		}
		for _, forbidden := range hint.forbidden {
			if strings.Contains(lower, forbidden) {
				matches = false
				break
			}
		}
		if matches {
			return hint.titleID
		}
	}
	return 0
}

// IsContentDiscPlaceholderTitleID returns true for generic installer XEX IDs.
func IsContentDiscPlaceholderTitleID(tid uint32) bool {
	return tid == 0xFFED2000
}

// UnsupportedMultiDiscReason identifies retail layouts the current one-ISO
// pipeline cannot produce correctly. Refusing them is safer than a boot-failing
// GOD that appears ready.
func UnsupportedMultiDiscReason(name string) string {
	lower := strings.ToLower(name)
	if IsMultiDiscGameName(name) && (strings.Contains(lower, "watch dogs") || strings.Contains(lower, "watch_dogs")) {
		return "Watch Dogs requer combinar os arquivos installation1/installation2 dos dois discos; a instalacao automatica de um disco isolado foi bloqueada"
	}
	return ""
}
