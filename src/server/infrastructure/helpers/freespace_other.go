//go:build !windows

package helpers

import "syscall"

// FreeSpaceBytes returns the number of bytes available to an unprivileged user
// on the filesystem that contains path.
func FreeSpaceBytes(path string) (uint64, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, err
	}
	// Bavail is uint64 on both linux and darwin; Bsize differs in width, so widen.
	return uint64(st.Bavail) * uint64(st.Bsize), nil
}

// VolumeFileSystem returns empty string on non-windows platforms.
func VolumeFileSystem(path string) string {
	return ""
}

// IsFATVolume returns false on non-windows platforms by default.
func IsFATVolume(path string) bool {
	return false
}
