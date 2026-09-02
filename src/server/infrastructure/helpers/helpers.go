// helpers.go — utility functions (network, filesystem, Xbox header parsing).
package helpers

import (
	"bufio"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"godsend/app"
	"godsend/utils"
)

// SanitizeFilename replaces filesystem-unsafe characters.
func SanitizeFilename(n string) string {
	if n == "" {
		return ""
	}
	return regexp.MustCompile(`[<>:"/\\|?*]`).ReplaceAllString(n, " -")
}

// CopyFileBuffered copies src to dst using buffered I/O.
func CopyFileBuffered(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	bw := bufio.NewWriterSize(out, app.CopyBufferSize)
	if _, err = io.Copy(bw, bufio.NewReaderSize(in, app.CopyBufferSize)); err != nil {
		return err
	}
	return bw.Flush()
}

// DetectGodStructure returns the TitleID and MediaID from a GOD directory.
func DetectGodStructure(godDir string) (string, string, error) {
	entries, err := os.ReadDir(godDir)
	if err != nil {
		return "", "", err
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		titleID := e.Name()
		titlePath := filepath.Join(godDir, titleID)
		subs, err := os.ReadDir(titlePath)
		if err != nil {
			continue
		}
		for _, s := range subs {
			if !s.IsDir() {
				continue
			}
			ct := s.Name()
			if len(ct) != 8 || !IsHexString(ct) {
				continue
			}
			ctPath := filepath.Join(titlePath, ct)
			ctEntries, err := os.ReadDir(ctPath)
			if err != nil {
				continue
			}
			for _, f := range ctEntries {
				if f.IsDir() {
					continue
				}
				n := f.Name()
				if strings.HasPrefix(strings.ToUpper(n), "DATA") {
					continue
				}
				return titleID, n, nil
			}
		}
		for _, s := range subs {
			if s.IsDir() {
				continue
			}
			n := s.Name()
			if strings.HasPrefix(strings.ToUpper(n), "DATA") {
				continue
			}
			return titleID, n, nil
		}
	}
	return "", "", fmt.Errorf("GOD structure not found")
}

// ValidateGodStructure locates a GOD package and verifies its LIVE header plus
// every MHT/SHT/data hash before the package can be delivered to the console.
func ValidateGodStructure(godDir string) (string, string, error) {
	entries, err := os.ReadDir(godDir)
	if err != nil {
		return "", "", err
	}
	var validationErr error
	for _, entry := range entries {
		if !entry.IsDir() || len(entry.Name()) != 8 || !IsHexString(entry.Name()) {
			continue
		}
		titleID := strings.ToUpper(entry.Name())
		info, err := utils.ValidateGODContentDir(filepath.Join(godDir, entry.Name()), titleID)
		if err == nil {
			return info.TitleID, info.MediaID, nil
		}
		validationErr = err
	}
	if validationErr != nil {
		return "", "", validationErr
	}
	return "", "", fmt.Errorf("GOD structure not found")
}

// IsHexString returns true if all characters in s are hex digits.
func IsHexString(s string) bool {
	for _, c := range s {
		switch {
		case c >= '0' && c <= '9':
		case c >= 'A' && c <= 'F':
		case c >= 'a' && c <= 'f':
		default:
			return false
		}
	}
	return true
}

// ParseXboxHeader reads a LIVE/PIRS/CON header and returns (TitleID hex, ContentType uint32).
func ParseXboxHeader(path string) (string, uint32) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0
	}
	defer f.Close()
	h := make([]byte, 1024)
	n, err := f.Read(h)
	if err != nil || n < 0x368 {
		return "", 0
	}
	magic := string(h[0:4])
	if magic != "LIVE" && magic != "PIRS" && magic != "CON " {
		return "", 0
	}
	return strings.ToUpper(hex.EncodeToString(h[0x360:0x364])), binary.BigEndian.Uint32(h[0x344:0x348])
}

// BucketAndZip splits a GOD directory into partitioned 7z archives.
func BucketAndZip(a *app.App, src, dest, gameName, safeName string) (string, string, error) {
	titleID, mediaID, err := DetectGodStructure(src)
	if err != nil {
		return "", "", err
	}
	staging := filepath.Join(a.TempDir, safeName+"_staging")
	os.RemoveAll(staging)
	os.MkdirAll(staging, 0755)
	var parts []string
	var curSize int64
	pn := 1
	cpd := filepath.Join(staging, fmt.Sprintf("%s_Part%d", safeName, pn))
	os.MkdirAll(cpd, 0755)
	contentDir := filepath.Join(src, titleID)
	err = filepath.Walk(contentDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(contentDir, path)
		if curSize+info.Size() > app.MaxPartSize && curSize > 0 {
			pname := fmt.Sprintf("%s_Part%d.7z", safeName, pn)
			if err := utils.CreateZipFromDir(cpd, filepath.Join(dest, pname)); err != nil {
				return err
			}
			parts = append(parts, pname)
			pn++
			curSize = 0
			cpd = filepath.Join(staging, fmt.Sprintf("%s_Part%d", safeName, pn))
			os.MkdirAll(cpd, 0755)
		}
		dp := filepath.Join(cpd, rel)
		os.MkdirAll(filepath.Dir(dp), 0755)
		if err := CopyFileBuffered(path, dp); err != nil {
			return err
		}
		curSize += info.Size()
		return nil
	})
	if err != nil {
		os.RemoveAll(staging)
		return "", "", err
	}
	if curSize > 0 {
		pname := fmt.Sprintf("%s_Part%d.7z", safeName, pn)
		if err := utils.CreateZipFromDir(cpd, filepath.Join(dest, pname)); err != nil {
			os.RemoveAll(staging)
			return "", "", err
		}
		parts = append(parts, pname)
	}
	os.RemoveAll(staging)
	a.GamePartsMap.Store(gameName, parts)
	return titleID, mediaID, nil
}

// DecodeMinervaName decodes HTML entities that appear in Minerva No-Intro filenames
// (e.g. &#39; → ', &amp; → &) so the display name is clean.
func DecodeMinervaName(s string) string {
	s = strings.ReplaceAll(s, "&#39;", "'")
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&lt;", "<")
	s = strings.ReplaceAll(s, "&gt;", ">")
	s = strings.ReplaceAll(s, "&quot;", "\"")
	return s
}

// FindFileByExt walks dir and returns the first file with the given extension.
func FindFileByExt(dir, ext string) string {
	var found string
	filepath.Walk(dir, func(p string, i os.FileInfo, e error) error {
		if e != nil || i.IsDir() {
			return nil
		}
		if strings.EqualFold(filepath.Ext(p), ext) {
			found = p
			return io.EOF
		}
		return nil
	})
	return found
}

// FindXEXFolder walks dir and returns the path of the folder directly
// containing a default.xex file.
func FindXEXFolder(dir string) string {
	var xexFolder string
	filepath.Walk(dir, func(p string, i os.FileInfo, e error) error {
		if e != nil || i.IsDir() {
			return nil
		}
		if strings.EqualFold(filepath.Base(p), "default.xex") {
			xexFolder = filepath.Dir(p)
			return io.EOF
		}
		return nil
	})
	return xexFolder
}

// FindTitleIDInDir attempts to detect the 8-character hex TitleID of a game in dir (GOD, XEX, or STFS).
func FindTitleIDInDir(dir string) string {
	if dir == "" {
		return ""
	}
	// 1. Try default.xex or default.xbe directly in dir
	for _, name := range []string{"default.xex", "default.xbe", "Default.xex", "Default.xbe"} {
		p := filepath.Join(dir, name)
		if tid, err := utils.ExtractTitleIDFromFile(p); err == nil && len(tid) == 8 && IsHexString(tid) {
			return strings.ToUpper(tid)
		}
	}

	// 2. Try GOD structure detection
	if tid, _, err := DetectGodStructure(dir); err == nil && len(tid) == 8 && IsHexString(tid) {
		return strings.ToUpper(tid)
	}

	// 3. Search first two levels of subdirectories for default.xex / default.xbe or STFS headers
	var foundTID string
	filepath.Walk(dir, func(p string, i os.FileInfo, e error) error {
		if e != nil {
			return nil
		}
		if i.IsDir() {
			// Don't walk excessively deep
			rel, _ := filepath.Rel(dir, p)
			if strings.Count(rel, string(filepath.Separator)) > 3 {
				return filepath.SkipDir
			}
			return nil
		}
		baseLower := strings.ToLower(i.Name())
		if baseLower == "default.xex" || baseLower == "default.xbe" || strings.HasSuffix(baseLower, ".xex") {
			if tid, err := utils.ExtractTitleIDFromFile(p); err == nil && len(tid) == 8 && IsHexString(tid) {
				foundTID = strings.ToUpper(tid)
				return io.EOF
			}
		}
		if tid, _ := ParseXboxHeader(p); tid != "" && len(tid) == 8 && IsHexString(tid) {
			foundTID = strings.ToUpper(tid)
			return io.EOF
		}
		return nil
	})

	return foundTID
}

// FindGODPackage walks dir and looks for a GOD directory or an STFS container
// file with its associated .data directory. It structures the package into a standard
// godDir layout (<dir>/_god_prepared/<titleID>/00007000/<mediaID> + .data) and returns
// (godDir, titleID, mediaID, nil).
func FindGODPackage(dir string) (string, string, string, error) {
	if tid, mid, err := DetectGodStructure(dir); err == nil && len(tid) == 8 && IsHexString(tid) {
		return dir, tid, mid, nil
	}

	var foundContainer string
	var foundDataDir string
	var foundTID string
	var foundMID string

	_ = filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			// If folder ends with .data, check if parent directory has the container file
			if strings.HasSuffix(strings.ToLower(info.Name()), ".data") {
				base := strings.TrimSuffix(info.Name(), filepath.Ext(info.Name()))
				containerCandidate := filepath.Join(filepath.Dir(p), base)
				if st, err := os.Stat(containerCandidate); err == nil && !st.IsDir() {
					tid, _ := ParseXboxHeader(containerCandidate)
					if tid == "" || len(tid) != 8 {
						tid = FindTitleIDInDir(filepath.Dir(containerCandidate))
					}
					if tid != "" && len(tid) == 8 && IsHexString(tid) {
						foundContainer = containerCandidate
						foundDataDir = p
						foundTID = strings.ToUpper(tid)
						foundMID = base
						return io.EOF
					}
				}
			}
			return nil
		}
		// Also check if file is an STFS container with a companion .data directory
		if info.Size() >= 0x368 {
			dataDirCandidate := p + ".data"
			if st, err := os.Stat(dataDirCandidate); err == nil && st.IsDir() {
				tid, _ := ParseXboxHeader(p)
				if tid == "" || len(tid) != 8 {
					tid = FindTitleIDInDir(filepath.Dir(p))
				}
				if tid != "" && len(tid) == 8 && IsHexString(tid) {
					foundContainer = p
					foundDataDir = dataDirCandidate
					foundTID = strings.ToUpper(tid)
					foundMID = filepath.Base(p)
					return io.EOF
				}
			}
		}
		return nil
	})

	if foundContainer == "" || foundTID == "" || foundMID == "" {
		return "", "", "", fmt.Errorf("GOD package not found in %s", dir)
	}

	// Prepare standard GOD root: <dir>/_god_prepared/<titleID>/00007000/
	godPreparedRoot := filepath.Join(dir, "_god_prepared")
	godSubDir := filepath.Join(godPreparedRoot, foundTID, "00007000")
	if err := os.MkdirAll(godSubDir, 0755); err != nil {
		return "", "", "", err
	}

	destContainer := filepath.Join(godSubDir, foundMID)
	destDataDir := filepath.Join(godSubDir, foundMID+".data")

	// If source is not already inside destContainer, move or link it
	if !sameFilePath(foundContainer, destContainer) {
		_ = os.Rename(foundContainer, destContainer)
	}
	if !sameFilePath(foundDataDir, destDataDir) {
		_ = os.Rename(foundDataDir, destDataDir)
	}

	return godPreparedRoot, foundTID, foundMID, nil
}

func sameFilePath(a, b string) bool {
	absA, errA := filepath.Abs(a)
	absB, errB := filepath.Abs(b)
	if errA != nil || errB != nil {
		return strings.EqualFold(a, b)
	}
	return strings.EqualFold(filepath.Clean(absA), filepath.Clean(absB))
}

// FindContentPackage walks dir and looks for an STFS content file (e.g. XBLA, DLC, Digital).
// Returns (containerFilePath, titleID, contentTypeDir, nil).
func FindContentPackage(dir string) (string, string, string, error) {
	var foundFile string
	var foundTID string
	var foundTypeDir string

	_ = filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if info.Size() >= 0x368 && !strings.HasSuffix(strings.ToLower(info.Name()), ".xex") && !strings.HasSuffix(strings.ToLower(info.Name()), ".iso") {
			tid, ct := ParseXboxHeader(p)
			if tid != "" && len(tid) == 8 && IsHexString(tid) {
				typeDir := fmt.Sprintf("%08X", ct)
				if typeDir == "00000000" {
					typeDir = "00000002"
				}
				foundFile = p
				foundTID = strings.ToUpper(tid)
				foundTypeDir = typeDir
				return io.EOF
			}
		}
		return nil
	})

	if foundFile == "" || foundTID == "" {
		return "", "", "", fmt.Errorf("STFS content package not found in %s", dir)
	}
	return foundFile, foundTID, foundTypeDir, nil
}

