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
