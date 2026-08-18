//go:build !windows

package app

import (
	"os"
	"syscall"
)

type fixedVolume struct {
	root string
	free uint64
}

// bestFixedVolume is Windows-only; elsewhere the default staging path under
// ToolsDir is kept unchanged.
func bestFixedVolume() string { return "" }

func fixedLargeFileVolumes() []fixedVolume { return nil }

func processIsRunning(pid int) bool {
	if pid <= 0 {
		return false
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return process.Signal(syscall.Signal(0)) == nil
}
