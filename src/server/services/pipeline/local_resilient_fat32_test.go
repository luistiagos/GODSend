//go:build windows

package pipeline

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"syscall"
	"testing"
	"time"

	"godsend/app"
	"godsend/infrastructure/helpers"
	"godsend/models"
)

// errorCannotMake is ERROR_CANNOT_MAKE: fastfat's answer when a directory
// already has 65,536 entries of 32 bytes and a name needs a contiguous run
// that is not there.
const errorCannotMake = syscall.Errno(82)

// fat32FacesNames reproduces the shape of EA FC 26's data/sceneassets/faces:
// 7,238 names of 39 characters (4 entries each) and 5,908 of 40 (5 entries),
// 58,494 entries with "." and "..". They fit as final names; the old
// <name>.xbox-companion-part scheme fragments the folder and fails near #12,569
// at 8 KiB clusters (scripts/fat32-dirent-sim.py).
func fat32FacesNames() []string {
	names := make([]string, 0, 13146)
	for i := 10000; i < 10000+7238; i++ {
		names = append(names, fmt.Sprintf("face_%d_0_0_0_0_0_0_0_0_textures.rx3", i))
	}
	for i := 100000; i < 100000+5908; i++ {
		names = append(names, fmt.Sprintf("face_%d_0_0_0_0_0_0_0_0_textures.rx3", i))
	}
	sort.Strings(names) // filepath.Walk order
	return names
}

// fat32TestRoot returns a fresh folder on the FAT32 volume named by
// GODSEND_FAT32_TEST_DIR (e.g. a spare pendrive). The test writes ~26 thousand
// empty files there and removes the folder at the end.
func fat32TestRoot(t *testing.T) string {
	t.Helper()
	base := os.Getenv("GODSEND_FAT32_TEST_DIR")
	if base == "" {
		t.Skip("GODSEND_FAT32_TEST_DIR nao definido: teste em FAT32 real desligado")
	}
	if !helpers.IsFATVolume(base) {
		t.Fatalf("GODSEND_FAT32_TEST_DIR=%s nao esta num volume FAT", base)
	}
	root := filepath.Join(base, fmt.Sprintf("godsend-fat32-test-%d", time.Now().UnixNano()))
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(root); err != nil {
			t.Errorf("limpeza de %s falhou: %v", root, err)
		}
	})
	return root
}

// Controle: o esquema antigo (temporario ao lado do destino, depois rename)
// esgota a pasta e o rename falha com ERROR_CANNOT_MAKE — o erro do print.
func TestFAT32LegacyPartSuffixExhaustsDirectory(t *testing.T) {
	root := fat32TestRoot(t)
	folder := filepath.Join(root, "faces")
	if err := os.MkdirAll(folder, 0755); err != nil {
		t.Fatal(err)
	}
	names := fat32FacesNames()
	for i, name := range names {
		dst := filepath.Join(folder, name)
		partial := dst + legacyLocalPartSuffix
		err := os.WriteFile(partial, nil, 0644)
		if err == nil {
			err = os.Rename(partial, dst)
		}
		if err != nil {
			if !errors.Is(err, errorCannotMake) {
				t.Fatalf("arquivo #%d %s: esperava ERROR_CANNOT_MAKE, veio %v", i+1, name, err)
			}
			if i < 12000 {
				t.Fatalf("falhou cedo demais (#%d); o volume ja estava sujo? %v", i+1, err)
			}
			t.Logf("esquema antigo falhou no arquivo #%d (%d gravados) %s: %v", i+1, i, name, err)
			return
		}
	}
	t.Fatalf("premissa mudou: o esquema antigo gravou os %d nomes sem estourar a pasta", len(names))
}

// A correcao: copyTreeLocal grava o temporario na staging do dispositivo e a
// pasta do jogo recebe so nomes finais, que cabem.
func TestFAT32CopyTreeLocalFitsLargeDirectory(t *testing.T) {
	root := fat32TestRoot(t)
	source := filepath.Join(t.TempDir(), "faces")
	if err := os.MkdirAll(source, 0755); err != nil {
		t.Fatal(err)
	}
	names := fat32FacesNames()
	for _, name := range names {
		if err := os.WriteFile(filepath.Join(source, name), nil, 0644); err != nil {
			t.Fatal(err)
		}
	}
	deviceID, err := PrepareLocalDevice(root)
	if err != nil {
		t.Fatal(err)
	}
	a := app.NewApp()
	a.XboxConnections.Store("FAT32", models.XboxConnection{Mode: "local", LocalRoot: root, LocalDeviceID: deviceID})
	service := &Service{App: a}
	destination := filepath.Join(root, "Games", "EA FC 26", "faces")
	start := time.Now()
	if err := service.copyTreeLocal(source, destination, root, "FAT32", "XEX"); err != nil {
		t.Fatalf("copyTreeLocal falhou: %v", err)
	}
	t.Logf("%d arquivos gravados em %s", len(names), time.Since(start).Round(time.Second))

	written, err := os.ReadDir(destination)
	if err != nil {
		t.Fatal(err)
	}
	if len(written) != len(names) {
		t.Fatalf("esperava %d arquivos na pasta, encontrou %d", len(names), len(written))
	}
	staged, err := os.ReadDir(filepath.Join(root, filepath.FromSlash(localStagingDir)))
	if err != nil {
		t.Fatal(err)
	}
	if len(staged) != 0 {
		t.Fatalf("staging deveria terminar vazia, tem %d arquivos", len(staged))
	}
}
