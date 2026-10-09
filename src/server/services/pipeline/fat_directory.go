package pipeline

import (
	"errors"
	"path/filepath"
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

// isFATDirectoryFull reports the directory-cap failure. Callers must have
// established that the destination is a FAT volume.
func isFATDirectoryFull(err error) bool {
	return errors.Is(err, fatErrorCannotMake)
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
