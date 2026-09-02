package utils

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMaxXDVDFSUsedPrefixIncludesDeclaredFileExtent(t *testing.T) {
	const rootSector = 0x21
	const fileSector = 0x40
	const fileSize = 1234
	image := make([]byte, (fileSector+1)*xdvdfsSectorSz)
	table := image[rootSector*xdvdfsSectorSz:]
	binary.LittleEndian.PutUint16(table[0:], 0)
	binary.LittleEndian.PutUint16(table[2:], 0)
	binary.LittleEndian.PutUint32(table[4:], fileSector)
	binary.LittleEndian.PutUint32(table[8:], fileSize)
	table[12] = 0x20
	table[13] = 8
	copy(table[14:], "game.bin")
	entryEnd := 24
	binary.LittleEndian.PutUint16(table[entryEnd:], 0xffff)
	binary.LittleEndian.PutUint16(table[entryEnd+2:], 0xffff)

	path := filepath.Join(t.TempDir(), "image.iso")
	if err := os.WriteFile(path, image, 0644); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got, err := maxXDVDFSUsedPrefix(f, 0, rootSector, xdvdfsSectorSz)
	if err != nil {
		t.Fatal(err)
	}
	want := uint64(fileSector*xdvdfsSectorSz + fileSize)
	if got != want {
		t.Fatalf("got max prefix %d, want %d", got, want)
	}
}

func writeTestXDVDFSDir(image []byte, tableSector, targetSector uint32, name string, directory bool, size uint32) {
	table := image[tableSector*xdvdfsSectorSz:]
	binary.LittleEndian.PutUint16(table[0:], 0)
	binary.LittleEndian.PutUint16(table[2:], 0)
	binary.LittleEndian.PutUint32(table[4:], targetSector)
	binary.LittleEndian.PutUint32(table[8:], size)
	if directory {
		table[12] = xdvdfsAttrDir
	}
	table[13] = byte(len(name))
	copy(table[14:], name)
	entryEnd := (14 + len(name) + 3) &^ 3
	binary.LittleEndian.PutUint16(table[entryEnd:], 0xffff)
	binary.LittleEndian.PutUint16(table[entryEnd+2:], 0xffff)
}

func buildInstallDiscTestISO(t *testing.T, withContent bool) string {
	t.Helper()
	const rootSector = 0x21
	image := make([]byte, 0x42*xdvdfsSectorSz)
	descriptor := image[0x20*xdvdfsSectorSz:]
	copy(descriptor, xdvdfsMagic)
	binary.LittleEndian.PutUint32(descriptor[20:], rootSector)
	binary.LittleEndian.PutUint32(descriptor[24:], xdvdfsSectorSz)
	if withContent {
		writeTestXDVDFSDir(image, rootSector, 0x22, "content", true, xdvdfsSectorSz)
		writeTestXDVDFSDir(image, 0x22, 0x23, "0000000000000000", true, xdvdfsSectorSz)
		writeTestXDVDFSDir(image, 0x23, 0x24, "FFED2000", true, xdvdfsSectorSz)
		writeTestXDVDFSDir(image, 0x24, 0x25, "FFFFFFFF", true, xdvdfsSectorSz)
		writeTestXDVDFSDir(image, 0x25, 0x26, "PACKAGE", false, 0x400)
		packageHeader := image[0x26*xdvdfsSectorSz:]
		copy(packageHeader, "LIVE")
		binary.BigEndian.PutUint32(packageHeader[0x0360:], 0x4D53084D)
	} else {
		writeTestXDVDFSDir(image, rootSector, 0x22, "default.xex", false, 0x400)
	}
	path := filepath.Join(t.TempDir(), "layout.iso")
	if err := os.WriteFile(path, image, 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestProbeISOInstallLayoutFindsPlaceholderContentTree(t *testing.T) {
	path := buildInstallDiscTestISO(t, true)
	info := &TitleExecInfo{TitleID: 0xFFED2000, DiscNumber: 2, DiscCount: 2}
	layout, err := ProbeISOInstallLayout(path, info)
	if err != nil {
		t.Fatal(err)
	}
	if !layout.HasInstallableContent || layout.ContentTitleID != 0x4D53084D || layout.ContentType != "FFFFFFFF" {
		t.Fatalf("unexpected layout: %+v", layout)
	}
}

func TestProbeISOInstallLayoutDoesNotClassifyPlayableDiscAsContent(t *testing.T) {
	path := buildInstallDiscTestISO(t, false)
	layout, err := ProbeISOInstallLayout(path, &TitleExecInfo{TitleID: 0x4D5307FA, DiscNumber: 2, DiscCount: 4})
	if err != nil {
		t.Fatal(err)
	}
	if layout.HasInstallableContent {
		t.Fatalf("playable continuation disc classified as content: %+v", layout)
	}
}

func TestGODDataSizePreservesTGMACEPaddingOnly(t *testing.T) {
	if got := godDataSizeForTitle(0x434107D2, 100, 200); got != 200 {
		t.Fatalf("TGM ACE size=%d, want 200", got)
	}
	if got := godDataSizeForTitle(0x4D53084D, 100, 200); got != 100 {
		t.Fatalf("normal title size=%d, want 100", got)
	}
}

func buildValidTestGOD(t *testing.T) (string, string) {
	t.Helper()
	root := t.TempDir()
	titleID := "4D5309C9"
	mediaID := "1234ABCD"
	typeDir := filepath.Join(root, "00007000")
	dataDir := filepath.Join(typeDir, mediaID+".data")
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		t.Fatal(err)
	}

	sourcePath := filepath.Join(t.TempDir(), "source.bin")
	sourceSize := godSPSz + godBlockSz + 137
	source := make([]byte, sourceSize)
	for index := range source {
		source[index] = byte((index*31 + 7) % 251)
	}
	if err := os.WriteFile(sourcePath, source, 0644); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	blockCount := uint64((len(source) + godBlockSz - 1) / godBlockSz)
	partPath := filepath.Join(dataDir, "Data0000")
	partSize, err := writeGODPart(f, 0, 0, blockCount, partPath)
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		t.Fatalf("write part: %v; close: %v", err, closeErr)
	}
	mht, err := buildMHTChain(dataDir, 1)
	if err != nil {
		t.Fatal(err)
	}
	info := &TitleExecInfo{
		MediaID: 0x1234ABCD, TitleID: 0x4D5309C9,
		Platform: 2, ExecutableType: 0, DiscNumber: 1, DiscCount: 1,
	}
	if err := writeConHeader(filepath.Join(typeDir, mediaID), info, blockCount, 1, []int64{partSize}, mht, "Forza Horizon"); err != nil {
		t.Fatal(err)
	}
	return root, titleID
}

func TestValidateGODContentDirAcceptsCompleteHashTree(t *testing.T) {
	root, titleID := buildValidTestGOD(t)
	info, err := ValidateGODContentDir(root, titleID)
	if err != nil {
		t.Fatal(err)
	}
	if info.MediaID != "1234ABCD" || info.PartCount != 1 || info.BlockCount < 2 {
		t.Fatalf("unexpected package info: %+v", info)
	}
}

func TestValidateGODContentDirRejectsCorruptGameData(t *testing.T) {
	root, titleID := buildValidTestGOD(t)
	partPath := filepath.Join(root, "00007000", "1234ABCD.data", "Data0000")
	f, err := os.OpenFile(partPath, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteAt([]byte{0xff}, godHashListSz+godHashListSz+17); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateGODContentDir(root, titleID); err == nil || !strings.Contains(err.Error(), "hash SHT") {
		t.Fatalf("expected SHT corruption error, got %v", err)
	}
}

func TestValidateGODContentDirRejectsCorruptHeader(t *testing.T) {
	root, titleID := buildValidTestGOD(t)
	headerPath := filepath.Join(root, "00007000", "1234ABCD")
	f, err := os.OpenFile(headerPath, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteAt([]byte{0x01}, 0x0400); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateGODContentDir(root, titleID); err == nil || !strings.Contains(err.Error(), "cabecalho") {
		t.Fatalf("expected header corruption error, got %v", err)
	}
}
