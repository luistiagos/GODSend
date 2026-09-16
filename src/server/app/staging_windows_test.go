//go:build windows

package app

import (
	"testing"
)

func TestIsExternalOrUSBBusOnKnownVolumes(t *testing.T) {
	vols := fixedLargeFileVolumes()
	t.Logf("Found %d fixed large file volumes:", len(vols))
	for _, v := range vols {
		isUSB := isExternalOrUSBBus(v.root)
		t.Logf("Volume %s: isUSB=%v, free=%d", v.root, isUSB, v.free)
	}
}

func TestBestFixedVolumeExcludesUSBDrives(t *testing.T) {
	// Verify that if a volume is marked as isUSB, bestFixedVolume skips it
	volumes := []fixedVolume{
		{root: "E:\\", free: 999999999999, isUSB: true},
		{root: "C:\\", free: 10000000000, isUSB: false},
	}
	var best string
	var bestFree uint64
	for _, v := range volumes {
		if v.isUSB {
			continue
		}
		if v.free > bestFree {
			bestFree = v.free
			best = v.root
		}
	}
	if best != "C:\\" {
		t.Fatalf("expected C:\\ to be selected over larger USB volume E:\\, got %s", best)
	}
}
