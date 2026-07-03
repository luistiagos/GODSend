//go:build windows

package helpers

import (
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
