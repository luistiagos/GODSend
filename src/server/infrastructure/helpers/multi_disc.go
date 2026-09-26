// multi_disc.go — multi-disc XEX rips. A scene rip of a two-disc release ships the whole
// release inside one archive ("Disc1", "Disc2"), and the XEX install paths keep only the
// folder that holds default.xex. Everything beside it — the install disc a title like Grand
// Theft Auto V needs in order to boot — went to the extraction scratch with the rest of the
// archive, so the console received half a game named after the rip's placeholder folder.
package helpers

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// ContentPlaceholderTitleID is the generic retail-installer XEX title. It names the
// installer, never the game whose content it carries, so it can never address a
// destination folder on the console.
const ContentPlaceholderTitleID = "FFED2000"

// profileFolder is the "all profiles" account folder every console content path goes
// through: Content/0000000000000000/<TitleID>/<contentType>/.
const profileFolder = "0000000000000000"

// defaultContentTypeDir is the content-type folder secondary-disc installs use when the
// package header does not declare one.
const defaultContentTypeDir = "00000002"

// genericDiscFolderName matches the placeholder folders scene rips use for each disc of a
// multi-disc release ("Disc2", "DVD 1", "Game Disc", "Disco 2"). They name a position in the release,
// not a game, so they must never become the name of an installed game.
var genericDiscFolderName = regexp.MustCompile(`(?i)^(?:(?:game|install(?:ation)?|content|bonus|play)[ _.-]*)?(?:disco|disc|disk|dvd|cd)[ _.-]*[0-9]*$`)

// IsGenericDiscFolderName reports whether name is a rip's disc placeholder rather than a title.
func IsGenericDiscFolderName(name string) bool {
	return genericDiscFolderName.MatchString(strings.TrimSpace(name))
}

// CompanionContent is one install-disc payload found beside the playable folder of a
// multi-disc rip, already addressed the way the console expects it.
type CompanionContent struct {
	Dir     string // directory holding the package files and any "<package>.data" subtree
	TitleID string // parent title the package belongs to
	TypeDir string // content-type directory, e.g. "00000002"
}

// FindCompanionContentPayloads returns every Content/0000000000000000/<TitleID>/<type>
// payload under dir that lives outside excludeDir — the folder already being installed as
// the game. The parent Title ID comes from the package header whenever it parses, because a
// retail installer addresses its own tree under the placeholder FFED2000 while the console
// looks the content up by the game's real Title ID.
func FindCompanionContentPayloads(dir, excludeDir string) []CompanionContent {
	if dir == "" {
		return nil
	}
	var found []CompanionContent
	_ = filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err != nil || info == nil || !info.IsDir() {
			return nil
		}
		if excludeDir != "" && isWithinDir(p, excludeDir) {
			return filepath.SkipDir
		}
		if !strings.EqualFold(info.Name(), profileFolder) ||
			!strings.EqualFold(filepath.Base(filepath.Dir(p)), "Content") {
			return nil
		}
		found = append(found, readProfileTree(p)...)
		return filepath.SkipDir
	})
	return found
}

// isWithinDir reports whether path is base or sits under it.
func isWithinDir(path, base string) bool {
	rel, err := filepath.Rel(base, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

// readProfileTree lists the payloads under one Content/0000000000000000 folder.
func readProfileTree(profileDir string) []CompanionContent {
	titleEntries, err := os.ReadDir(profileDir)
	if err != nil {
		return nil
	}
	var payloads []CompanionContent
	for _, titleEntry := range titleEntries {
		if !titleEntry.IsDir() {
			continue
		}
		titleDir := filepath.Join(profileDir, titleEntry.Name())
		typeEntries, err := os.ReadDir(titleDir)
		if err != nil {
			continue
		}
		before := len(payloads)
		for _, typeEntry := range typeEntries {
			if !typeEntry.IsDir() || len(typeEntry.Name()) != 8 || !IsHexString(typeEntry.Name()) {
				continue
			}
			if payload, ok := describePayload(filepath.Join(titleDir, typeEntry.Name()), titleEntry.Name(), typeEntry.Name()); ok {
				payloads = append(payloads, payload)
			}
		}
		if len(payloads) == before {
			// Some rips drop the content-type folder and leave the package directly under the
			// Title ID; the package header still says which folder the console expects.
			if payload, ok := describePayload(titleDir, titleEntry.Name(), ""); ok {
				payloads = append(payloads, payload)
			}
		}
	}
	return payloads
}

// describePayload resolves where a directory of package files belongs on the console. The
// header of the first package naming a real game wins over the folder names, which a retail
// installer writes as FFED2000; the folder names are the fallback when no header does.
func describePayload(dir, folderTitleID, folderTypeDir string) (CompanionContent, bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return CompanionContent{}, false
	}
	titleID := strings.ToUpper(folderTitleID)
	typeDir := strings.ToUpper(folderTypeDir)
	parsed := false
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		headerTitleID, contentType := ParseXboxHeader(filepath.Join(dir, entry.Name()))
		if headerTitleID == "" {
			continue
		}
		parsed = true
		if !isRealTitleID(headerTitleID) {
			// A Kinect or speech package can sit beside the real one, and os.ReadDir is
			// ordered by name, so the first package read is not necessarily the game's.
			continue
		}
		titleID = headerTitleID
		if ct := fmt.Sprintf("%08X", contentType); ct != "00000000" {
			typeDir = ct
		}
		break
	}
	if !parsed || !isRealTitleID(titleID) {
		return CompanionContent{}, false
	}
	if len(typeDir) != 8 || !IsHexString(typeDir) {
		typeDir = defaultContentTypeDir
	}
	return CompanionContent{Dir: dir, TitleID: titleID, TypeDir: typeDir}, true
}

// InstallPackageHeaderLen is how much of a package InstallPackageProblem needs to read.
const InstallPackageHeaderLen = 0x3AD

// InstallPackageProblem says why a package cannot be one of titleID's install packages, or
// returns "" when it can. header is the start of the package — at least
// InstallPackageHeaderLen bytes — and size the length of the whole file.
//
// Identity comes from the header, never from the file name: any file dropped under the
// title's folder would otherwise pass. Truncation comes from the sizes an STFS header
// declares. The content size, on every retail LIVE/PIRS package checked, is exactly the file
// length minus the header rounded up to a 4 KiB block, so it catches a cut of a single byte.
// Homebrew and CON containers leave it zero; for those only the allocated blocks bound the
// length, and a cut shorter than the interleaved hash tables goes unseen.
func InstallPackageProblem(header []byte, size int64, titleID string, contentType uint32) string {
	if len(header) < InstallPackageHeaderLen {
		return "cabeçalho ilegível"
	}
	if magic := string(header[:4]); magic != "LIVE" && magic != "PIRS" && magic != "CON " {
		return "não é um pacote do Xbox 360"
	}
	if got := strings.ToUpper(hex.EncodeToString(header[0x360:0x364])); !strings.EqualFold(got, titleID) {
		return "pertence ao TitleID " + got
	}
	if got := binary.BigEndian.Uint32(header[0x344:0x348]); got != contentType {
		return fmt.Sprintf("tem o tipo de conteúdo %08X", got)
	}
	if binary.BigEndian.Uint32(header[0x3A9:0x3AD]) != 0 {
		// SVOD keeps its data in a ".data" folder beside the header, so the file size of the
		// header says nothing about completeness.
		return ""
	}
	dataStart := (int64(binary.BigEndian.Uint32(header[0x340:0x344])) + 0xFFF) &^ 0xFFF
	need := dataStart + int64(binary.BigEndian.Uint32(header[0x395:0x399]))*0x1000
	if declared := int64(binary.BigEndian.Uint64(header[0x34C:0x354])); declared > 0 && dataStart+declared > need {
		need = dataStart + declared
	}
	if size < need {
		return fmt.Sprintf("truncado (%d de %d bytes)", size, need)
	}
	return ""
}

// PackageProbe reads one package of an install set: the start of the file, the size of the
// whole file, and whether it exists at all.
type PackageProbe func(name string) (header []byte, size int64, found bool)

// InstallSetProblem checks every package of an install set, returning "" only when all of
// them are present and pass InstallPackageProblem.
func InstallSetProblem(titleID string, contentType uint32, packages []string, probe PackageProbe) string {
	var missing, bad []string
	for _, name := range packages {
		header, size, found := probe(name)
		if !found {
			missing = append(missing, name)
			continue
		}
		if problem := InstallPackageProblem(header, size, titleID, contentType); problem != "" {
			bad = append(bad, name+" "+problem)
		}
	}
	var parts []string
	if len(missing) > 0 {
		parts = append(parts, "faltam "+strings.Join(missing, ", "))
	}
	return strings.Join(append(parts, bad...), "; ")
}

// LocalPackageProbe reads packages from a local folder, matching names case-insensitively
// because FAT32 and the console do.
func LocalPackageProbe(dir string) PackageProbe {
	entries, _ := os.ReadDir(dir)
	return func(name string) ([]byte, int64, bool) {
		for _, entry := range entries {
			if entry.IsDir() || !strings.EqualFold(entry.Name(), name) {
				continue
			}
			info, err := entry.Info()
			if err != nil {
				return nil, 0, true
			}
			return readFileHead(filepath.Join(dir, entry.Name()), InstallPackageHeaderLen), info.Size(), true
		}
		return nil, 0, false
	}
}

// readFileHead returns the first n bytes of path, or nil when the file is shorter.
func readFileHead(path string, n int) []byte {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	head := make([]byte, n)
	if _, err := io.ReadFull(f, head); err != nil {
		return nil
	}
	return head
}

// isRealTitleID rejects the IDs that identify an installer or the dashboard instead of a
// game: either one would send the payload to a folder the console never reads for the title.
func isRealTitleID(titleID string) bool {
	if len(titleID) != 8 || !IsHexString(titleID) {
		return false
	}
	switch strings.ToUpper(titleID) {
	case ContentPlaceholderTitleID, SystemTitleID, "00000000", "FFFFFFFF":
		return false
	}
	return true
}
