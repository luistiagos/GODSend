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

var (
	// Matches (Disc 1), [Disc 2], (DVD 1), (CD 2), (Disk 1), (Disc 1 of 2), etc.
	discTagPattern = regexp.MustCompile(`(?i)\s*[\(\[]\s*(?:disc|disk|dvd|cd)\s*([0-9]+)(?:\s*(?:of|\/)\s*([0-9]+))?\s*[\)\]]`)
	// Matches trailing Disc 1, DVD 2, CD 3 without parens (e.g. "Game Disc 1")
	discTrailingPattern = regexp.MustCompile(`(?i)\s+[-_]?\s*\b(?:disc|disk|dvd|cd)\s*([0-9]+)\b`)
	// discSubtitlePattern matches a bracketed group that names the ROLE of a disc inside one
	// release — "(Play Disc)", "(Single-Player Campaign)", "(Install-Multiplayer)", "[DLC]" —
	// as opposed to the region, language and edition groups that tell two releases apart. The
	// role has to come off before two discs of the same release can be recognised as siblings,
	// and an exact list of phrases could not keep up: catalog rows carry free text such as
	// "(Campaign Part 1 & Multiplayer)" and "(Additional Content Packs Install Disc)". Matching
	// a role KEYWORD anywhere inside the group covers those; the groups that must survive
	// ("(USA, Europe)", "(En,Fr,De)", "(Triple Pack)", "(Volume 1)") carry none of them.
	//
	// The second branch — "play" or "game" as the WHOLE group — exists because the two words are
	// disc roles only when they stand alone. Grand Theft Auto V ships as "(Disc 1) (Install)" and
	// "(Disc 2) (Play)", and the keyword branch strips "(Install)" while leaving "(Play)", so the
	// two halves of the same release produced different titles and only the clicked one was
	// downloaded. Requiring the whole group keeps the release names that merely contain the words
	// — "(Sega Game Toshokan)", "(Game no Kanzume Vol. 1)", "(Required for Play)" — intact; those
	// name a product, and merging them would queue two unrelated games as discs of each other.
	discSubtitlePattern = regexp.MustCompile(`(?i)\s*[\(\[]\s*(?:[^)\]]*\b(?:disc|disk|dlc|campaign|multi-?play(?:er)?|single[- ]?play(?:er)?|co-?op|install(?:er|ation)?|bonus|voice\s*over|dysk\s+z\s+gra|spieldisc|disque\s+de\s+jeu|fukikaeban|jimakuban|igrovoj)\b[^)\]]*|play|game)\s*[\)\]]`)
	// nonRetailMediaPattern names a group that is a SEPARATE PRODUCT, not a disc of the release:
	// a demo, beta, trial or preview ships under the retail title but is not part of it. It has
	// to override discSubtitlePattern because that pattern matches a role keyword ANYWHERE in the
	// group, so "(Multiplayer Demo)" and "(Campaign Beta)" were stripped as if they named a disc
	// role. The demo row then collapsed onto the retail ReleaseTitle — "NBA 2K (USA) (Multiplayer
	// Demo)" became "NBA 2K (USA)" — which was enough for FindCompanionDiscs to call it a sibling
	// disc and for enqueueCompanions to download and install it without anyone asking, and enough
	// for MissingDiscNumbers to count it toward the release.
	//
	// A bare "(Demo)" never had the bug: it carries no role keyword, so discSubtitlePattern never
	// matched it and the group already survived into the title.
	nonRetailMediaPattern = regexp.MustCompile(`(?i)\b(?:demos?|betas?|trial|preview)\b`)
)

// DiscInfo represents parsed disc metadata from a catalog title.
type DiscInfo struct {
	OriginalName string `json:"original_name"`
	ReleaseTitle string `json:"release_title"`
	DiscNumber   byte   `json:"disc_number"`
	DiscCount    byte   `json:"disc_count"`
	Subtitle     string `json:"subtitle,omitempty"`
	IsMultiDisc  bool   `json:"is_multi_disc"`
}

// ExtractDiscInfo parses Redump and custom game names into disc number, count, subtitle and clean release title.
func ExtractDiscInfo(name string) DiscInfo {
	info := DiscInfo{
		OriginalName: name,
		ReleaseTitle: strings.TrimSpace(name),
		DiscNumber:   0,
		DiscCount:    0,
		IsMultiDisc:  false,
	}

	// 1. Check for disc tag with parens/brackets
	if m := discTagPattern.FindStringSubmatch(name); len(m) > 1 {
		if n, err := strconv.Atoi(m[1]); err == nil && n > 0 && n <= 20 {
			info.DiscNumber = byte(n)
			info.IsMultiDisc = true
			if len(m) > 2 && m[2] != "" {
				// Range-checked like the disc number above, and for a sharper reason: the count
				// is the upper bound of the 1..N loop in MissingDiscNumbers, and byte(300) is
				// 44 while byte(255) makes that loop wrap 255→0 and never end.
				if total, err := strconv.Atoi(m[2]); err == nil && total > 0 && total <= 20 {
					info.DiscCount = byte(total)
				}
			}
		}
	} else if m := discTrailingPattern.FindStringSubmatch(name); len(m) > 1 {
		if n, err := strconv.Atoi(m[1]); err == nil && n > 0 && n <= 20 {
			info.DiscNumber = byte(n)
			info.IsMultiDisc = true
		}
	}

	// 2. Read the disc-role subtitle and the release title from the name with the disc-number
	//    tag already removed. "(Disc 1)" is itself a group naming a disc role, so reading the
	//    subtitle off the raw name would report the disc number as the role.
	rel := discTagPattern.ReplaceAllString(name, "")
	for _, m := range discSubtitlePattern.FindAllString(rel, -1) {
		if nonRetailMediaPattern.MatchString(m) {
			continue
		}
		sub := strings.TrimSpace(m)
		sub = strings.Trim(sub, "()[]")
		info.Subtitle = strings.TrimSpace(sub)
		break
	}

	// 3. Compute ReleaseTitle by removing the disc-role groups too — except a group that names a
	//    demo, beta or trial, which tells two releases apart instead of naming a role and has to
	//    survive into the title so the demo never matches the retail row.
	rel = discSubtitlePattern.ReplaceAllStringFunc(rel, func(m string) string {
		if nonRetailMediaPattern.MatchString(m) {
			return m
		}
		return ""
	})
	if info.DiscNumber > 0 && discTrailingPattern.MatchString(rel) {
		rel = discTrailingPattern.ReplaceAllString(rel, "")
	}
	// Normalize spacing
	fields := strings.Fields(rel)
	info.ReleaseTitle = strings.Join(fields, " ")

	return info
}

// ExtractReleaseTitle returns the edition/region title with disc tags stripped.
func ExtractReleaseTitle(name string) string {
	return ExtractDiscInfo(name).ReleaseTitle
}

// DiscNumberFromName extracts Redump-style Disc/Disk/DVD/CD numbering (1-9).
func DiscNumberFromName(name string) byte {
	return ExtractDiscInfo(name).DiscNumber
}

// IsMultiDiscGameName returns true for any disc-numbered catalog entries.
func IsMultiDiscGameName(name string) bool {
	return ExtractDiscInfo(name).IsMultiDisc
}

// IsSecondaryDisc returns true for Disc 2+ entries.
func IsSecondaryDisc(name string) bool {
	return ExtractDiscInfo(name).DiscNumber >= 2
}

// FindCompanionDiscs finds all discs in a catalog list that belong to the same release title.
func FindCompanionDiscs(gameName string, catalog []string) []string {
	targetInfo := ExtractDiscInfo(gameName)
	targetRel := strings.ToLower(targetInfo.ReleaseTitle)
	if targetRel == "" {
		return []string{gameName}
	}

	type matchItem struct {
		name string
		disc byte
	}
	var matches []matchItem

	for _, g := range catalog {
		info := ExtractDiscInfo(g)
		if strings.ToLower(info.ReleaseTitle) == targetRel {
			matches = append(matches, matchItem{
				name: g,
				disc: info.DiscNumber,
			})
		}
	}

	if len(matches) <= 1 {
		return []string{gameName}
	}

	// Sort by disc number ascending
	for i := 0; i < len(matches); i++ {
		for j := i + 1; j < len(matches); j++ {
			di := matches[i].disc
			dj := matches[j].disc
			if di == 0 {
				di = 1
			}
			if dj == 0 {
				dj = 1
			}
			if di > dj || (di == dj && matches[i].name > matches[j].name) {
				matches[i], matches[j] = matches[j], matches[i]
			}
		}
	}

	result := make([]string, len(matches))
	for i, m := range matches {
		result[i] = m.name
	}
	return result
}

// MissingDiscNumbers lists the discs of primaryGame's release that no row in companions
// supplies — the result of FindCompanionDiscs over the catalogs actually available. It returns
// nil for a single-disc game and for a release whose discs already form a complete 1..N.
//
// A catalog row labelled "Disc 1" is never a one-disc release, so a lone Disc 1 counts as
// incomplete exactly like a lone Disc 2; it simply cannot say how many discs are missing, and
// the floor of 2 reports the one disc that certainly exists.
//
// The queue path and the browse view both read completeness from here: a release the browse
// view calls complete must be the same release the queue can finish, or the warning shown
// before the download would contradict the one shown on delivery.
func MissingDiscNumbers(primaryGame string, companions []string) []int {
	info := ExtractDiscInfo(primaryGame)
	if !info.IsMultiDisc {
		return nil
	}
	found := map[byte]bool{}
	if info.DiscNumber > 0 {
		found[info.DiscNumber] = true
	}
	for _, name := range companions {
		if n := ExtractDiscInfo(name).DiscNumber; n > 0 {
			found[n] = true
		}
	}
	// The "of N" is a property of the release, not of the disc that happens to be the primary:
	// Redump declares it on some rows and omits it on others, so reading it off the clicked disc
	// alone would call the same release complete or incomplete depending on which half was
	// clicked, and the browse view cannot know in advance which one that will be.
	expected := byte(DeclaredDiscCount(append([]string{primaryGame}, companions...)))
	for n := range found {
		if n > expected {
			expected = n
		}
	}
	if expected < 2 {
		expected = 2
	}
	var missing []int
	for n := byte(1); n <= expected; n++ {
		if !found[n] {
			missing = append(missing, int(n))
		}
	}
	return missing
}

// DeclaredDiscCount returns the highest "of N" any of the names declares ("(Disc 1 of 3)"),
// or 0 when no row in the release says how many discs it has.
func DeclaredDiscCount(names []string) int {
	count := 0
	for _, name := range names {
		if c := int(ExtractDiscInfo(name).DiscCount); c > count {
			count = c
		}
	}
	return count
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
	if IsSecondaryDisc(name) && (strings.Contains(lower, "watch dogs") || strings.Contains(lower, "watch_dogs")) {
		return "Watch Dogs requer combinar os arquivos installation1/installation2 dos dois discos; a instalacao automatica de um disco isolado foi bloqueada"
	}
	return ""
}
