package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const homeLockFileName = ".godsend.lock"

// AcquireHomeLock acquires an exclusive lock on ToolsDir (.godsend.lock).
// If another instance of the backend is already running on this directory,
// it returns an error identifying the active owner.
func (a *App) AcquireHomeLock() error {
	a.homeLockMu.Lock()
	defer a.homeLockMu.Unlock()

	if a.homeLockFile != nil {
		return nil
	}
	if a.ToolsDir == "" {
		return nil
	}

	if err := os.MkdirAll(a.ToolsDir, 0755); err != nil {
		return fmt.Errorf("create data directory: %w", err)
	}

	lockPath := filepath.Join(a.ToolsDir, homeLockFileName)
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		return fmt.Errorf("open home lock file %s: %w", lockPath, err)
	}

	if err := lockFileHandle(f); err != nil {
		_ = f.Close()
		existingPID := "unknown"
		if data, readErr := os.ReadFile(lockPath); readErr == nil {
			trimmed := strings.TrimSpace(string(data))
			if trimmed != "" {
				existingPID = trimmed
			}
		}
		return fmt.Errorf("data directory %s is locked by another instance of godsend (pid %s)", a.ToolsDir, existingPID)
	}

	// Acquired lock! Write current PID into lock file for easy diagnosis.
	_ = f.Truncate(0)
	_, _ = f.Seek(0, 0)
	_, _ = f.WriteString(fmt.Sprintf("%d\n", os.Getpid()))
	_ = f.Sync()

	a.homeLockFile = f
	return nil
}

// ReleaseHomeLock unlocks and closes the lock file on ToolsDir.
func (a *App) ReleaseHomeLock() {
	a.homeLockMu.Lock()
	defer a.homeLockMu.Unlock()

	if a.homeLockFile != nil {
		_ = unlockFileHandle(a.homeLockFile)
		_ = a.homeLockFile.Close()
		a.homeLockFile = nil
	}
}

// HasHomeLock reports whether this App instance currently holds the exclusive lock on ToolsDir.
func (a *App) HasHomeLock() bool {
	a.homeLockMu.Lock()
	defer a.homeLockMu.Unlock()
	return a.homeLockFile != nil
}
