//go:build windows

// staging_windows.go — pick the roomiest fixed drive for torrent download staging.
package app

import (
	"strings"
	"syscall"
	"unsafe"
)

// bestFixedVolume returns the root (e.g. "D:\\") of the fixed, large-file-capable
// (NTFS/exFAT) local drive with the most free space, or "" if none qualifies.
// Removable drives and FAT/FAT32 volumes are skipped so multi-GB download staging
// never lands on a pendrive or trips FAT32's 4 GB per-file limit.
func bestFixedVolume() string {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	getLogicalDrives := kernel32.NewProc("GetLogicalDrives")
	getDriveType := kernel32.NewProc("GetDriveTypeW")
	getVolInfo := kernel32.NewProc("GetVolumeInformationW")
	getFreeSpace := kernel32.NewProc("GetDiskFreeSpaceExW")

	const driveFixed = 3
	mask, _, _ := getLogicalDrives.Call()

	var best string
	var bestFree uint64
	for i := 0; i < 26; i++ {
		if mask&(1<<uint(i)) == 0 {
			continue
		}
		root := string(rune('A'+i)) + ":\\"
		rp, err := syscall.UTF16PtrFromString(root)
		if err != nil {
			continue
		}
		if dt, _, _ := getDriveType.Call(uintptr(unsafe.Pointer(rp))); dt != driveFixed {
			continue
		}
		// Read the filesystem name only (NULL volume-name buffer is allowed).
		fsBuf := make([]uint16, 32)
		if r1, _, _ := getVolInfo.Call(
			uintptr(unsafe.Pointer(rp)),
			0, 0, 0, 0, 0,
			uintptr(unsafe.Pointer(&fsBuf[0])),
			uintptr(len(fsBuf)),
		); r1 == 0 {
			continue
		}
		fs := syscall.UTF16ToString(fsBuf)
		if !strings.EqualFold(fs, "NTFS") && !strings.EqualFold(fs, "exFAT") {
			continue // skip FAT/FAT32 (4 GB file limit) and anything unrecognized
		}
		var freeAvail, total, totalFree uint64
		if r2, _, _ := getFreeSpace.Call(
			uintptr(unsafe.Pointer(rp)),
			uintptr(unsafe.Pointer(&freeAvail)),
			uintptr(unsafe.Pointer(&total)),
			uintptr(unsafe.Pointer(&totalFree)),
		); r2 == 0 {
			continue
		}
		if freeAvail > bestFree {
			bestFree = freeAvail
			best = root
		}
	}
	return best
}
