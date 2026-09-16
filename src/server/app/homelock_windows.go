//go:build windows

package app

import (
	"os"
	"syscall"
	"unsafe"
)

const (
	lockfileFailImmediately = 0x00000001
	lockfileExclusiveLock   = 0x00000002
)

func lockFileHandle(f *os.File) error {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	procLockFileEx := kernel32.NewProc("LockFileEx")

	// Lock at offset 4096 (beyond file content) so bytes 0..4095 can be read
	// by other processes to discover the PID of the locking process.
	var overlapped syscall.Overlapped
	overlapped.Offset = 4096
	r1, _, err := procLockFileEx.Call(
		f.Fd(),
		uintptr(lockfileExclusiveLock|lockfileFailImmediately),
		0,
		1, // numberOfBytesToLockLow
		0, // numberOfBytesToLockHigh
		uintptr(unsafe.Pointer(&overlapped)),
	)
	if r1 == 0 {
		if err != nil && err != syscall.Errno(0) {
			return err
		}
		return syscall.EINVAL
	}
	return nil
}

func unlockFileHandle(f *os.File) error {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	procUnlockFileEx := kernel32.NewProc("UnlockFileEx")

	var overlapped syscall.Overlapped
	overlapped.Offset = 4096
	r1, _, err := procUnlockFileEx.Call(
		f.Fd(),
		0,
		1,
		0,
		uintptr(unsafe.Pointer(&overlapped)),
	)
	if r1 == 0 {
		if err != nil && err != syscall.Errno(0) {
			return err
		}
		return syscall.EINVAL
	}
	return nil
}
