//go:build !windows

package app

import (
	"os"
	"syscall"
)

func lockFileHandle(f *os.File) error {
	return syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
}

func unlockFileHandle(f *os.File) error {
	return syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
}
