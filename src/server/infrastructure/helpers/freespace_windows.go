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

// FlushVolumeBuffers opens the volume handle (e.g. `\\.\E:`) and calls
// FlushFileBuffers on Windows to ensure all pending directory and file system
// allocation table buffers are committed to the physical storage device.
func FlushVolumeBuffers(path string) error {
	vol := filepath.VolumeName(path)
	if vol == "" {
		return nil
	}
	vol = strings.TrimSuffix(vol, "\\")
	vol = strings.TrimSuffix(vol, "/")
	devicePath := `\\.\` + vol
	p, err := syscall.UTF16PtrFromString(devicePath)
	if err != nil {
		return err
	}

	const (
		genericReadWrite = 0xC0000000 // GENERIC_READ | GENERIC_WRITE
		fileShareAll     = 0x00000007 // FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
		openExisting     = 3
	)

	handle, err := syscall.CreateFile(
		p,
		genericReadWrite,
		fileShareAll,
		nil,
		openExisting,
		0,
		0,
	)
	if err != nil {
		// If opening volume with write permission fails (e.g. without admin rights),
		// fall back safely without failing the whole process.
		return nil
	}
	defer syscall.CloseHandle(handle)

	return syscall.FlushFileBuffers(handle)
}

