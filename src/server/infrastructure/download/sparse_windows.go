//go:build windows

package download

import (
	"os"
	"syscall"
	"unsafe"
)

const (
	fsctlSetSparse = 0x000900C4
)

type fileSetSparseBuffer struct {
	SetSparse byte
}

// prepareSparseDestFile attempts to mark the open file as NTFS sparse via
// FSCTL_SET_SPARSE before pre-sizing it. Without this flag, out-of-order writes
// past EOF on NTFS force Windows to synchronously zero-fill the gap, stalling
// multi-GB downloads for seconds to tens of seconds.
//
// On filesystems that do not support sparse files (exFAT, FAT32, some network
// shares), FSCTL_SET_SPARSE fails and boundedWindow=true tells the planner to
// keep writes inside a bounded window ahead of the contiguous prefix.
func prepareSparseDestFile(file *os.File) (isSparse bool, boundedWindow bool) {
	if file == nil {
		return false, true
	}
	if err := setWindowsSparseFlag(file, true); err != nil {
		return false, true
	}
	return true, false
}

// clearSparseDestFile removes the NTFS sparse attribute once every byte of the
// file has been written so downstream tools see a normal allocated file.
func clearSparseDestFile(file *os.File) {
	if file == nil {
		return
	}
	_ = setWindowsSparseFlag(file, false)
}

func setWindowsSparseFlag(file *os.File, enable bool) error {
	var buf fileSetSparseBuffer
	if enable {
		buf.SetSparse = 1
	}
	var bytesReturned uint32
	return syscall.DeviceIoControl(
		syscall.Handle(file.Fd()),
		fsctlSetSparse,
		(*byte)(unsafe.Pointer(&buf)),
		uint32(unsafe.Sizeof(buf)),
		nil,
		0,
		&bytesReturned,
		nil,
	)
}
