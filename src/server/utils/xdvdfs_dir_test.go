package utils

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// Tests for [[backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio-e-extrai-iso-incompleta-sem-erro_2026-10-09T20-20]]:
// a zero-byte file (size == 0, sector != 0, as extract-xiso writes it) must not end the directory sector.

type testDirEntry struct {
	name   string
	sector uint32
	size   uint32
	dir    bool
}

// writeTestDirTable writes entries sequentially (4-byte aligned) at the start of buf,
// followed by the 0xFFFF padding marker, and returns the bytes used.
func writeTestDirTable(buf []byte, entries []testDirEntry) int {
	pos := 0
	for _, e := range entries {
		binary.LittleEndian.PutUint16(buf[pos:], 0)
		binary.LittleEndian.PutUint16(buf[pos+2:], 0)
		binary.LittleEndian.PutUint32(buf[pos+4:], e.sector)
		binary.LittleEndian.PutUint32(buf[pos+8:], e.size)
		if e.dir {
			buf[pos+12] = xdvdfsAttrDir
		}
		buf[pos+13] = byte(len(e.name))
		copy(buf[pos+14:], e.name)
		pos = (pos + 14 + len(e.name) + 3) &^ 3
	}
	binary.LittleEndian.PutUint16(buf[pos:], 0xffff)
	binary.LittleEndian.PutUint16(buf[pos+2:], 0xffff)
	return pos
}

func entryNames(entries []xdvdfsDirEntry) []string {
	var names []string
	for _, e := range entries {
		names = append(names, e.name)
	}
	return names
}

func TestParseDirSectorKeepsEntriesAfterZeroByteFile(t *testing.T) {
	sector := make([]byte, xdvdfsSectorSz)
	for i := range sector {
		sector[i] = 0xff
	}
	writeTestDirTable(sector, []testDirEntry{
		{name: "default.xex", sector: 0x30, size: 64},
		{name: "a.txt", sector: 0x31, size: 0},
		{name: "b.txt", sector: 0x31, size: 5},
		{name: "c.txt", sector: 0x32, size: 7},
	})
	got := parseDirSector(sector)
	want := []string{"default.xex", "a.txt", "b.txt", "c.txt"}
	if len(got) != len(want) {
		t.Fatalf("got entries %v, want %v", entryNames(got), want)
	}
	for i, name := range want {
		if got[i].name != name {
			t.Fatalf("got entries %v, want %v", entryNames(got), want)
		}
	}
	if got[1].size != 0 || got[1].sector != 0x31 {
		t.Fatalf("zero-byte entry parsed as %+v", got[1])
	}
}

func TestParseDirSectorStopsAtZeroFilledEntry(t *testing.T) {
	sector := make([]byte, xdvdfsSectorSz)
	pos := writeTestDirTable(sector, []testDirEntry{{name: "default.xex", sector: 0x30, size: 64}})
	// Replace the 0xFFFF marker with zero fill, as a sector padded with zeros would look.
	for i := pos; i < len(sector); i++ {
		sector[i] = 0
	}
	got := parseDirSector(sector)
	if len(got) != 1 || got[0].name != "default.xex" {
		t.Fatalf("got entries %v, want [default.xex]", entryNames(got))
	}
}

// buildZeroByteFileTestISO lays out a root with a zero-byte file before default.xex and
// another one before the remaining files and a subdirectory, all in one sector.
func buildZeroByteFileTestISO(t *testing.T) string {
	t.Helper()
	const (
		rootSector = 0x21
		subSector  = 0x22
		xexSector  = 0x23
		z1Sector   = 0x24
		z2Sector   = 0x25
		innerSect  = 0x26
		imageSects = 0x27
	)
	xexDir := t.TempDir()
	writeDiscXEX(t, xexDir, 0x454109F4, 1)
	xex, err := os.ReadFile(filepath.Join(xexDir, "default.xex"))
	if err != nil {
		t.Fatal(err)
	}

	image := make([]byte, imageSects*xdvdfsSectorSz)
	descriptor := image[0x20*xdvdfsSectorSz:]
	copy(descriptor, xdvdfsMagic)
	binary.LittleEndian.PutUint32(descriptor[20:], rootSector)
	binary.LittleEndian.PutUint32(descriptor[24:], xdvdfsSectorSz)
	writeTestDirTable(image[rootSector*xdvdfsSectorSz:], []testDirEntry{
		{name: "aaa.ini", sector: xexSector, size: 0},
		{name: "default.xex", sector: xexSector, size: uint32(len(xex))},
		{name: "vazio.bin", sector: z1Sector, size: 0},
		{name: "z1.txt", sector: z1Sector, size: 2},
		{name: "z2.txt", sector: z2Sector, size: 3},
		{name: "sub", sector: subSector, size: xdvdfsSectorSz, dir: true},
	})
	writeTestDirTable(image[subSector*xdvdfsSectorSz:], []testDirEntry{
		{name: "inner.txt", sector: innerSect, size: 4},
	})
	copy(image[xexSector*xdvdfsSectorSz:], xex)
	copy(image[z1Sector*xdvdfsSectorSz:], "z1")
	copy(image[z2Sector*xdvdfsSectorSz:], "z2!")
	copy(image[innerSect*xdvdfsSectorSz:], "deep")

	path := filepath.Join(t.TempDir(), "zero-byte.iso")
	if err := os.WriteFile(path, image, 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestProbeISODiscInfoFindsExecutableAfterZeroByteFile(t *testing.T) {
	info, err := ProbeISODiscInfo(buildZeroByteFileTestISO(t))
	if err != nil {
		t.Fatalf("ProbeISODiscInfo: %v", err)
	}
	if info.TitleID != 0x454109F4 {
		t.Fatalf("got TitleID %08X, want 454109F4", info.TitleID)
	}
}

func TestExtractXEXFolderFromISOExtractsEveryFileAroundZeroByteFiles(t *testing.T) {
	dest := filepath.Join(t.TempDir(), "xex")
	if err := ExtractXEXFolderFromISO(buildZeroByteFileTestISO(t), dest); err != nil {
		t.Fatalf("ExtractXEXFolderFromISO: %v", err)
	}
	want := map[string]int64{
		"aaa.ini":                         0,
		"default.xex":                     64,
		"vazio.bin":                       0,
		"z1.txt":                          2,
		"z2.txt":                          3,
		filepath.Join("sub", "inner.txt"): 4,
	}
	got := map[string]int64{}
	err := filepath.Walk(dest, func(path string, fi os.FileInfo, err error) error {
		if err != nil || fi.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(dest, path)
		got[rel] = fi.Size()
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	var gotNames []string
	for name := range got {
		gotNames = append(gotNames, name)
	}
	sort.Strings(gotNames)
	if len(got) != len(want) {
		t.Fatalf("extracted %v, want %d files", gotNames, len(want))
	}
	for name, size := range want {
		if gotSize, ok := got[name]; !ok || gotSize != size {
			t.Fatalf("extracted %v; %s: size %d present=%v, want size %d", gotNames, name, gotSize, ok, size)
		}
	}
}

func TestMaxXDVDFSUsedPrefixSeesExtentAfterZeroByteFile(t *testing.T) {
	const rootSector = 0x21
	const fileSector = 0x40
	const fileSize = 1234
	image := make([]byte, (fileSector+1)*xdvdfsSectorSz)
	writeTestDirTable(image[rootSector*xdvdfsSectorSz:], []testDirEntry{
		// A zero-byte extent occupies nothing, even if its sector lies past the image.
		{name: "empty.bin", sector: 0x7fffffff, size: 0},
		{name: "game.bin", sector: fileSector, size: fileSize},
	})
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
