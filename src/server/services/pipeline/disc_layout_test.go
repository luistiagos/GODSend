package pipeline

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"godsend/app"
)

func writeTestDirEntry(image []byte, tableSector, targetSector uint32, name string, directory bool, size uint32) {
	const sectorSz = 2048
	table := image[tableSector*sectorSz:]
	binary.LittleEndian.PutUint16(table[0:], 0)
	binary.LittleEndian.PutUint16(table[2:], 0)
	binary.LittleEndian.PutUint32(table[4:], targetSector)
	binary.LittleEndian.PutUint32(table[8:], size)
	if directory {
		table[12] = 0x10 // XDVDFS directory attribute flag
	}
	table[13] = byte(len(name))
	copy(table[14:], name)
	entryEnd := (14 + len(name) + 3) &^ 3
	binary.LittleEndian.PutUint16(table[entryEnd:], 0xffff)
	binary.LittleEndian.PutUint16(table[entryEnd+2:], 0xffff)
}

func buildBatmanContentTestISO(t *testing.T) string {
	t.Helper()
	const sectorSz = 2048
	const rootSector = 0x21
	image := make([]byte, 0x42*sectorSz)
	descriptor := image[0x20*sectorSz:]
	copy(descriptor, "MICROSOFT*XBOX*MEDIA")
	binary.LittleEndian.PutUint32(descriptor[20:], rootSector)
	binary.LittleEndian.PutUint32(descriptor[24:], sectorSz)

	// Content tree: content/0000000000000000/57520828/00000002/CONTENT_PACKAGE
	// Root has NO default.xex or default.xbe
	writeTestDirEntry(image, rootSector, 0x22, "content", true, sectorSz)
	writeTestDirEntry(image, 0x22, 0x23, "0000000000000000", true, sectorSz)
	writeTestDirEntry(image, 0x23, 0x24, "57520828", true, sectorSz)
	writeTestDirEntry(image, 0x24, 0x25, "00000002", true, sectorSz)
	writeTestDirEntry(image, 0x25, 0x26, "CONTENT_PACKAGE", false, 0x400)

	packageHeader := image[0x26*sectorSz:]
	copy(packageHeader, "LIVE")
	binary.BigEndian.PutUint32(packageHeader[0x0360:], 0x57520828)

	path := filepath.Join(t.TempDir(), "batman_origins_disc2.iso")
	if err := os.WriteFile(path, image, 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func buildNoExecutableNoContentISO(t *testing.T) string {
	t.Helper()
	const sectorSz = 2048
	const rootSector = 0x21
	image := make([]byte, 0x30*sectorSz)
	descriptor := image[0x20*sectorSz:]
	copy(descriptor, "MICROSOFT*XBOX*MEDIA")
	binary.LittleEndian.PutUint32(descriptor[20:], rootSector)
	binary.LittleEndian.PutUint32(descriptor[24:], sectorSz)

	// Root has only an unrelated folder: no default.xex and no content/
	writeTestDirEntry(image, rootSector, 0x22, "other", true, sectorSz)

	path := filepath.Join(t.TempDir(), "empty.iso")
	if err := os.WriteFile(path, image, 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestResolveISOInstallTypeContentDiscWithoutDefaultXex(t *testing.T) {
	service := &Service{App: app.NewApp()}
	isoPath := buildBatmanContentTestISO(t)
	gameName := "Batman - Arkham Origins (Brazil) (En,Es,Pt) (Disco 2)"

	resolved, err := service.resolveISOInstallType(gameName, isoPath, "god")
	if err != nil {
		t.Fatalf("expected content disc to resolve without error, got: %v", err)
	}
	if resolved != "content" {
		t.Fatalf("expected resolved type 'content', got %q", resolved)
	}
}

func TestResolveISOInstallTypeRejectsNoExecutableNoContentDisc(t *testing.T) {
	service := &Service{App: app.NewApp()}
	isoPath := buildNoExecutableNoContentISO(t)
	gameName := "Unknown Game (Disc 2)"

	resolved, err := service.resolveISOInstallType(gameName, isoPath, "god")
	if err == nil {
		t.Fatalf("expected error for disc without executable and without content, got resolved=%q", resolved)
	}
	if !strings.Contains(err.Error(), "no game executable") {
		t.Fatalf("expected error message to mention 'no game executable', got: %v", err)
	}
}

func TestResolveISOInstallTypeRejectsCorruptISO(t *testing.T) {
	service := &Service{App: app.NewApp()}
	corruptPath := filepath.Join(t.TempDir(), "corrupt.iso")
	if err := os.WriteFile(corruptPath, []byte("this is not a valid xgd or xdvdfs iso"), 0644); err != nil {
		t.Fatal(err)
	}

	_, err := service.resolveISOInstallType("Batman - Arkham Origins (Brazil) (En,Es,Pt) (Disco 2)", corruptPath, "god")
	if err == nil {
		t.Fatal("expected corrupt ISO to fail validation")
	}
	if !strings.Contains(err.Error(), "validar tipo do disco:") {
		t.Fatalf("expected error to start with 'validar tipo do disco:', got: %v", err)
	}
}

func TestResolveISOInstallTypeRejectsXexWhenNoExecutable(t *testing.T) {
	service := &Service{App: app.NewApp()}
	isoPath := buildBatmanContentTestISO(t)
	gameName := "Batman - Arkham Origins (Brazil) (En,Es,Pt) (Disco 2)"

	_, err := service.resolveISOInstallType(gameName, isoPath, "xex")
	if err == nil {
		t.Fatal("expected requested xex on disc without default.xex to fail")
	}
	if !strings.Contains(err.Error(), "no game executable") {
		t.Fatalf("expected error to mention 'no game executable', got: %v", err)
	}
}

func TestProcessContentInstallFromISOWithoutDefaultXex(t *testing.T) {
	myApp := app.NewApp()
	tempDir := t.TempDir()
	myApp.ToolsDir = tempDir
	myApp.TempDir = filepath.Join(tempDir, "temp")
	myApp.ReadyDir = filepath.Join(tempDir, "ready")
	os.MkdirAll(myApp.TempDir, 0755)
	os.MkdirAll(myApp.ReadyDir, 0755)
	service := &Service{App: myApp}

	isoPath := buildBatmanContentTestISO(t)
	gameName := "Batman - Arkham Origins (Brazil) (En,Es,Pt) (Disco 2)"
	safeName := "Batman_Origins_Disc2"

	err := service.processContentInstallFromISO(gameName, safeName, isoPath, nil)
	if err != nil {
		t.Fatalf("processContentInstallFromISO failed: %v", err)
	}

	gameDir := filepath.Join(myApp.GetReadyDir(), safeName)
	part1 := filepath.Join(gameDir, safeName+"_Part1.7z")
	if _, err := os.Stat(part1); err != nil {
		t.Fatalf("expected packaged 7z at %s: %v", part1, err)
	}
}

func buildAc4Disc2XexISO(t *testing.T) string {
	t.Helper()
	const sectorSz = 2048
	const rootSector = 0x21
	image := make([]byte, 0x30*sectorSz)
	descriptor := image[0x20*sectorSz:]
	copy(descriptor, "MICROSOFT*XBOX*MEDIA")
	binary.LittleEndian.PutUint32(descriptor[20:], rootSector)
	binary.LittleEndian.PutUint32(descriptor[24:], sectorSz)

	// Root directory with default.xex pointing to sector 0x22
	writeTestDirEntry(image, rootSector, 0x22, "default.xex", false, 0x200)

	// Mock XEX2 binary at sector 0x22
	xex := image[0x22*sectorSz:]
	copy(xex[:4], "XEX2")
	binary.BigEndian.PutUint32(xex[20:], 1)          // fieldCount = 1
	binary.BigEndian.PutUint32(xex[24:], 0x00040006) // key = xex2ExecInfoKey
	binary.BigEndian.PutUint32(xex[28:], 32)         // val = offset 32

	// Execution-info at offset 32:
	// MediaID (0), Version (4), BaseVersion (8), TitleID (12), Platform (16), ExecType (17), DiscNum (18), DiscCount (19)
	binary.BigEndian.PutUint32(xex[32+12:], 0x555308C2) // TitleID AC IV
	xex[32+18] = 2                                      // DiscNumber = 2
	xex[32+19] = 2                                      // DiscCount = 2

	path := filepath.Join(t.TempDir(), "ac4_disc2.iso")
	if err := os.WriteFile(path, image, 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestResolveISOInstallTypePromotesNoGodDiscToXex(t *testing.T) {
	service := &Service{App: app.NewApp()}
	isoPath := buildAc4Disc2XexISO(t)
	gameName := "Assassins Creed IV Black Flag [RF][DVD2]"

	// When user or UI requested "god", it must automatically promote to "xex" without error
	resolved, err := service.resolveISOInstallType(gameName, isoPath, "god")
	if err != nil {
		t.Fatalf("expected No-GOD disc requiring XEX to resolve without error, got: %v", err)
	}
	if resolved != "xex" {
		t.Fatalf("expected resolved type 'xex', got %q", resolved)
	}
}

