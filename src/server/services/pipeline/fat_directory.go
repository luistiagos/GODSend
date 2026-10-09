package pipeline

import (
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"syscall"
	"unicode/utf16"
)

// fatMaxDirectoryEntries is fastfat's cap on a directory: 64 Ki entries of 32
// bytes (2 MiB). Past it, a name that finds no contiguous run of free entries
// fails with ERROR_CANNOT_MAKE (dirsup.c::FatCreateNewDirent).
const fatMaxDirectoryEntries = 64 * 1024

// fatErrorCannotMake is ERROR_CANNOT_MAKE (82), the only way fastfat reports a
// directory at its entry cap. It is checked only on FAT volumes, which exist
// only on Windows here (helpers.IsFATVolume is false elsewhere).
const fatErrorCannotMake = syscall.Errno(82)

const fatInvalidShortNameChars = "\"*+,/:;<=>?[\\]| "

// fatDirentCount is how many 32-byte entries a name takes in a FAT directory:
// one for a name that is a valid 8.3 name with base and extension each all
// upper or all lower case (Windows keeps the case in flags), otherwise one per
// 13 UTF-16 units of long name plus the 8.3 alias.
func fatDirentCount(name string) int {
	if fatFitsShortName(name) {
		return 1
	}
	units := len(utf16.Encode([]rune(name)))
	return 1 + (units+12)/13
}

func fatFitsShortName(name string) bool {
	if strings.HasPrefix(name, ".") || strings.Count(name, ".") > 1 {
		return false
	}
	base, ext, _ := strings.Cut(name, ".")
	if len(base) < 1 || len(base) > 8 || len(ext) > 3 || strings.ContainsAny(name, fatInvalidShortNameChars) {
		return false
	}
	for _, r := range name {
		if r > 0x7f {
			return false
		}
	}
	for _, part := range []string{base, ext} {
		if part != strings.ToUpper(part) && part != strings.ToLower(part) {
			return false
		}
	}
	return true
}

// isFATDirectoryFull reports the directory-cap failure. Errno 82 means
// something else outside Windows, hence the GOOS guard.
func isFATDirectoryFull(err error) bool {
	return runtime.GOOS == "windows" && errors.Is(err, fatErrorCannotMake)
}

// localWriteErrorText is the device error shown to the user. Go formats a
// Windows errno in English; ERROR_CANNOT_MAKE in particular read as "The
// directory or file cannot be created", which says nothing about the cause.
func localWriteErrorText(err error) string {
	if isFATDirectoryFull(err) {
		return "o Windows recusou criar o arquivo porque a pasta atingiu o limite de 65.536 entradas do FAT32 (erro 82)"
	}
	return err.Error()
}

// checkFATDirectoryLimits fails, before any byte is written, when a folder of
// the copy needs more entries as final names than a FAT directory holds.
// Folders are checked in name order so the message is stable.
func checkFATDirectoryLimits(dstDir string, children map[string]map[string]string) error {
	folders := make([]string, 0, len(children))
	for folder := range children {
		folders = append(folders, folder)
	}
	sort.Strings(folders)
	for _, folder := range folders {
		need := fatFolderEntriesNeeded(children[folder])
		if need <= fatMaxDirectoryEntries {
			continue
		}
		shown, err := filepath.Rel(dstDir, folder)
		if err != nil || shown == "." {
			shown = filepath.Base(folder)
		}
		return fmt.Errorf("%w: a pasta '%s' do jogo tem %d itens que ocupam %d entradas de diretorio, acima do limite de %d do FAT32 do pendrive (jogos assim devem ser instalados no formato GOD)",
			ErrFAT32DirectoryLimit, filepath.ToSlash(shown), len(children[folder]), need, fatMaxDirectoryEntries)
	}
	return nil
}

// localManifestChildren maps every destination folder of the manifest to the
// names (files and subfolders) the copy puts directly in it: lower-cased name,
// because FAT matches names without case, to the real name, whose case decides
// the entry count. Folder keys are built exactly as copyTreeLocal builds dst,
// filepath.Dir(filepath.Join(dstDir, relativePath)).
func localManifestChildren(dstDir string, entries []localCopyEntry) map[string]map[string]string {
	children := make(map[string]map[string]string)
	add := func(folder, name string) {
		set := children[folder]
		if set == nil {
			set = make(map[string]string)
			children[folder] = set
		}
		set[strings.ToLower(name)] = name
	}
	for _, entry := range entries {
		path := filepath.Join(dstDir, entry.relativePath)
		add(filepath.Dir(path), filepath.Base(path))
		for folder := filepath.Dir(path); folder != dstDir && strings.HasPrefix(folder, dstDir); folder = filepath.Dir(folder) {
			add(filepath.Dir(folder), filepath.Base(folder))
		}
	}
	return children
}

// fatFolderEntriesNeeded counts the entries a folder needs to hold names, plus
// "." and "..".
func fatFolderEntriesNeeded(names map[string]string) int {
	total := 2
	for _, name := range names {
		total += fatDirentCount(name)
	}
	return total
}
