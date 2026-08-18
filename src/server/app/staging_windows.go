//go:build windows

// staging_windows.go — pick the roomiest fixed drive for torrent download staging.
package app

import (
	"strings"
	"syscall"
	"unsafe"
)

type fixedVolume struct {
	root string
	free uint64
}

// fixedLargeFileVolumes returns every fixed NTFS/exFAT volume and its currently
// available space. The same inventory drives stale-scratch cleanup and final
// volume selection so those decisions cannot diverge.
func fixedLargeFileVolumes() []fixedVolume {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	getLogicalDrives := kernel32.NewProc("GetLogicalDrives")
	getDriveType := kernel32.NewProc("GetDriveTypeW")
	getVolInfo := kernel32.NewProc("GetVolumeInformationW")
	getFreeSpace := kernel32.NewProc("GetDiskFreeSpaceExW")

	const driveFixed = 3
	mask, _, _ := getLogicalDrives.Call()
	volumes := make([]fixedVolume, 0, 4)
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
			continue
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
		volumes = append(volumes, fixedVolume{root: root, free: freeAvail})
	}
	return volumes
}

// bestFixedVolume returns the root (e.g. "D:\\") of the fixed, large-file-capable
// (NTFS/exFAT) local drive with the most free space, or "" if none qualifies.
// Removable drives and FAT/FAT32 volumes are skipped so multi-GB download staging
// never lands on a pendrive or trips FAT32's 4 GB per-file limit.
func bestFixedVolume() string {
	var best string
	var bestFree uint64
	for _, volume := range fixedLargeFileVolumes() {
		if volume.free > bestFree {
			bestFree = volume.free
			best = volume.root
		}
	}
	return best
}

func processIsRunning(pid int) bool {
	if pid <= 0 {
		return false
	}
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	openProcess := kernel32.NewProc("OpenProcess")
	getExitCodeProcess := kernel32.NewProc("GetExitCodeProcess")
	closeHandle := kernel32.NewProc("CloseHandle")

	const processQueryLimitedInformation = 0x1000
	handle, _, _ := openProcess.Call(processQueryLimitedInformation, 0, uintptr(pid))
	if handle == 0 {
		return false
	}
	defer closeHandle.Call(handle)
	var exitCode uint32
	if ok, _, _ := getExitCodeProcess.Call(handle, uintptr(unsafe.Pointer(&exitCode))); ok == 0 {
		return false
	}
	const stillActive = 259
	return exitCode == stillActive
}
