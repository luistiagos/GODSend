//go:build !windows

package download

import "os"

// prepareSparseDestFile returns (true, false) on Unix-like filesystems (ext4,
// APFS, XFS, F2FS, tmpfs), where Truncate + WriteAt naturally creates sparse
// holes without synchronous zero-fill.
func prepareSparseDestFile(_ *os.File) (isSparse bool, boundedWindow bool) {
	return true, false
}

func clearSparseDestFile(_ *os.File) {}
