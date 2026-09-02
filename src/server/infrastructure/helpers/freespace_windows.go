//go:build windows

package helpers

import (
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

// FreeSpaceBytes returns the number of bytes available to the caller on the
// volume that contains path. Uses GetDiskFreeSpaceExW so per-user quotas are
// respected.
func FreeSpaceBytes(path string) (uint64, error) {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	var freeAvail, total, totalFree uint64
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("GetDiskFreeSpaceExW")
	r1, _, e1 := proc.Call(
		uintptr(unsafe.Pointer(p)),
		uintptr(unsafe.Pointer(&freeAvail)),
		uintptr(unsafe.Pointer(&total)),
		uintptr(unsafe.Pointer(&totalFree)),
	)
	if r1 == 0 {
		return 0, e1
	}
	return freeAvail, nil
}

// VolumeFileSystem returns the filesystem name (e.g. "NTFS", "FAT32", "exFAT")
// of the volume that contains path.
func VolumeFileSystem(path string) string {
	vol := filepath.VolumeName(path)
	if vol == "" {
		vol = path
	}
	if !strings.HasSuffix(vol, "\\") {
		vol += "\\"
	}
	p, err := syscall.UTF16PtrFromString(vol)
	if err != nil {
		return ""
	}
	fsBuf := make([]uint16, 32)
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("GetVolumeInformationW")
	r1, _, _ := proc.Call(
		uintptr(unsafe.Pointer(p)),
		0, 0, 0, 0, 0,
		uintptr(unsafe.Pointer(&fsBuf[0])),
		uintptr(len(fsBuf)),
	)
	if r1 == 0 {
		return ""
	}
	return syscall.UTF16ToString(fsBuf)
}

// IsFATVolume returns true if the volume containing path is FAT, FAT32, or FAT16.
func IsFATVolume(path string) bool {
	fs := strings.ToUpper(VolumeFileSystem(path))
	return strings.HasPrefix(fs, "FAT")
}
