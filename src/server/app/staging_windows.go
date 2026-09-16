//go:build windows

// staging_windows.go — pick the roomiest fixed drive for torrent download staging.
package app

import (
	"strings"
	"syscall"
	"unsafe"
)

type fixedVolume struct {
	root  string
	free  uint64
	isUSB bool
}

// isExternalOrUSBBus checks if a drive volume is on a USB, FireWire, or SD/MMC bus,
// or reports removable media via IOCTL_STORAGE_QUERY_PROPERTY.
// External USB HDDs/SSDs frequently identify as DRIVE_FIXED in Windows, so querying
// the storage property directly is required to avoid auto-selecting an unplugged
// or sleeping external drive as the host machine's scratch space.
func isExternalOrUSBBus(root string) bool {
	driveLetter := strings.TrimRight(root, "\\")
	devicePath := `\\.\` + driveLetter
	pathPtr, err := syscall.UTF16PtrFromString(devicePath)
	if err != nil {
		return false
	}

	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	createFile := kernel32.NewProc("CreateFileW")
	deviceIoControl := kernel32.NewProc("DeviceIoControl")
	closeHandle := kernel32.NewProc("CloseHandle")

	const (
		fileShareRead             = 1
		fileShareWrite            = 2
		openExisting              = 3
		ioctlStorageQueryProperty = 0x002D1400
		busTypeUsb                = 0x07
		busType1394               = 0x04
		busTypeSd                 = 0x0C
		busTypeMmc                = 0x0D
	)

	// DesiredAccess = 0 allows querying device properties without administrative rights
	h, _, _ := createFile.Call(
		uintptr(unsafe.Pointer(pathPtr)),
		0,
		uintptr(fileShareRead|fileShareWrite),
		0,
		uintptr(openExisting),
		0,
		0,
	)
	if h == uintptr(syscall.InvalidHandle) || h == 0 {
		return false
	}
	defer closeHandle.Call(h)

	type storagePropertyQuery struct {
		PropertyID           uint32
		QueryType            uint32
		AdditionalParameters [4]byte
	}

	query := storagePropertyQuery{
		PropertyID: 0, // StorageDeviceProperty
		QueryType:  0, // PropertyStandardQuery
	}

	buf := make([]byte, 1024)
	var bytesReturned uint32

	r1, _, _ := deviceIoControl.Call(
		h,
		uintptr(ioctlStorageQueryProperty),
		uintptr(unsafe.Pointer(&query)),
		uintptr(unsafe.Sizeof(query)),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		uintptr(unsafe.Pointer(&bytesReturned)),
		0,
	)
	if r1 == 0 || bytesReturned < 32 {
		return false
	}

	removable := buf[10] != 0
	busType := *(*uint32)(unsafe.Pointer(&buf[28]))
	return removable || busType == busTypeUsb || busType == busType1394 || busType == busTypeSd || busType == busTypeMmc
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
		volumes = append(volumes, fixedVolume{
			root:  root,
			free:  freeAvail,
			isUSB: isExternalOrUSBBus(root),
		})
	}
	return volumes
}

// bestFixedVolume returns the root (e.g. "D:\\") of the fixed, large-file-capable
// (NTFS/exFAT) local drive with the most free space, or "" if none qualifies.
// Removable drives, USB/external drives (which present as DRIVE_FIXED on Windows), and
// FAT/FAT32 volumes are skipped so multi-GB download staging never lands on a pendrive,
// an external drive that can disconnect or sleep, or trips FAT32's 4 GB per-file limit.
func bestFixedVolume() string {
	var best string
	var bestFree uint64
	for _, volume := range fixedLargeFileVolumes() {
		if volume.isUSB {
			continue
		}
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
