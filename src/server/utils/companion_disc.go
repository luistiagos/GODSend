package utils

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ReadXEXExecInfo reads the execution-info header of an Xbox 360 executable on disk:
// Title ID, disc number and disc count.
func ReadXEXExecInfo(execPath string) (*TitleExecInfo, error) {
	f, err := os.Open(execPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	buf := make([]byte, 64*1024)
	n, err := io.ReadFull(f, buf)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, err
	}
	data := buf[:n]
	if len(data) < 4 || string(data[:4]) != xex2Magic {
		return nil, fmt.Errorf("%s: not an XEX2 executable", execPath)
	}
	return parseXEX2(data)
}

// FolderXEXExecInfo reads the default.xex directly inside dir, whatever its letter case.
func FolderXEXExecInfo(dir string) (*TitleExecInfo, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.EqualFold(entry.Name(), "default.xex") {
			return ReadXEXExecInfo(filepath.Join(dir, entry.Name()))
		}
	}
	return nil, fmt.Errorf("%s: no default.xex", dir)
}

// CompanionDiscFolders returns the folders below gameDir that hold another disc of the same
// title: a default.xex with gameDir's Title ID and a different disc number. Some scene rips
// nest one disc inside the other — the ZTM release of Grand Theft Auto V keeps the install
// disc (Disc 1) in a "Disc2" folder under the playable one — and such a folder is neither
// part of the game to copy nor hidden from the search for install content.
func CompanionDiscFolders(gameDir string) []string {
	game, err := FolderXEXExecInfo(gameDir)
	if err != nil {
		return nil
	}
	gameDir = filepath.Clean(gameDir)
	var found []string
	_ = filepath.Walk(gameDir, func(p string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() || !strings.EqualFold(info.Name(), "default.xex") {
			return nil
		}
		dir := filepath.Dir(p)
		if dir == gameDir {
			return nil
		}
		other, err := ReadXEXExecInfo(p)
		if err == nil && other.TitleID == game.TitleID && other.DiscNumber != game.DiscNumber {
			found = append(found, dir)
		}
		return nil
	})
	return found
}

// WithinAnyDir reports whether path is one of dirs or sits under one of them.
func WithinAnyDir(path string, dirs []string) bool {
	for _, dir := range dirs {
		rel, err := filepath.Rel(dir, path)
		if err == nil && (rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))) {
			return true
		}
	}
	return false
}
