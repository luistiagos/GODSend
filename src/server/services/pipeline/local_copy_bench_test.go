//go:build windows

package pipeline

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"godsend/app"
	"godsend/infrastructure/helpers"
)

// Medicao do passo 1 de docs/bugs/*/pipeline-jogo-xex-com-145-mil-arquivos-*:
// quanto custa por arquivo gravar num pendrive FAT32 com o copyLocalEntry real
// e com as alternativas (sem Sync por arquivo, direto no nome final). Desligado
// sem GODSEND_FAT32_TEST_DIR e GODSEND_BENCH_SRC; leva de minutos a horas.

type benchCopyFunc func(entry *localCopyEntry, root, dst string) error

func benchCopyFile(entry *localCopyEntry, path string, syncFile bool) error {
	in, err := os.Open(entry.sourcePath)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	hasher := sha256.New()
	buf := make([]byte, app.CopyBufferSize)
	copied, copyErr := io.CopyBuffer(io.MultiWriter(out, hasher), in, buf)
	var syncErr error
	if syncFile {
		syncErr = out.Sync()
	}
	closeErr := out.Close()
	for _, e := range []error{copyErr, syncErr, closeErr} {
		if e != nil {
			return e
		}
	}
	if copied != entry.size {
		return fmt.Errorf("%s: gravados %d de %d bytes", path, copied, entry.size)
	}
	return nil
}

var benchVariants = map[string]benchCopyFunc{
	"atual": func(entry *localCopyEntry, root, dst string) error {
		return copyLocalEntry(entry, root, dst, nil)
	},
	"sem-sync": func(entry *localCopyEntry, root, dst string) error {
		partial := localStagingPath(root, dst)
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(partial), 0755); err != nil {
			return err
		}
		if err := benchCopyFile(entry, partial, false); err != nil {
			return err
		}
		if st, err := os.Stat(partial); err != nil || st.Size() != entry.size {
			return fmt.Errorf("staging %s divergente: %v", partial, err)
		}
		_ = os.Remove(dst)
		return os.Rename(partial, dst)
	},
	"direto": func(entry *localCopyEntry, root, dst string) error {
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			return err
		}
		return benchCopyFile(entry, dst, false)
	},
	"direto-sync": func(entry *localCopyEntry, root, dst string) error {
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			return err
		}
		return benchCopyFile(entry, dst, true)
	},
}

// benchDiskWrites reads the cumulative write count and bytes of a volume
// ("F:") from the same counter used in the bug's evidence.
func benchDiskWrites(volume string) (int64, int64, error) {
	query := fmt.Sprintf(`$d = Get-CimInstance Win32_PerfRawData_PerfDisk_LogicalDisk -Filter "Name='%s'"; "$($d.DiskWritesPerSec) $($d.DiskWriteBytesPerSec)"`, volume)
	out, err := exec.Command("powershell", "-NoProfile", "-Command", query).Output()
	if err != nil {
		return 0, 0, err
	}
	fields := strings.Fields(string(out))
	if len(fields) != 2 {
		return 0, 0, fmt.Errorf("contador do volume %s ilegivel: %q", volume, out)
	}
	writes, err := strconv.ParseInt(fields[0], 10, 64)
	if err != nil {
		return 0, 0, err
	}
	bytes, err := strconv.ParseInt(fields[1], 10, 64)
	return writes, bytes, err
}

// benchDrain waits until the volume stops writing for 3 s and returns when
// the last write was seen, so a variant without Sync is not timed before the
// writes it postponed.
// GODSEND_BENCH_DRAIN_MAX caps the wait (default 5m): a system disk never goes
// quiet, so a dry run there needs a short cap.
func benchDrain(t *testing.T, volume string) (time.Time, int64, int64) {
	t.Helper()
	writes, bytes, err := benchDiskWrites(volume)
	if err != nil {
		t.Fatal(err)
	}
	maxWait := 5 * time.Minute
	if v := os.Getenv("GODSEND_BENCH_DRAIN_MAX"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			t.Fatalf("GODSEND_BENCH_DRAIN_MAX=%q invalido", v)
		}
		maxWait = d
	}
	lastChange := time.Now()
	deadline := time.Now().Add(maxWait)
	for time.Since(lastChange) < 3*time.Second && time.Now().Before(deadline) {
		time.Sleep(time.Second)
		w, b, err := benchDiskWrites(volume)
		if err != nil {
			t.Fatal(err)
		}
		if w != writes {
			writes, bytes, lastChange = w, b, time.Now()
		}
	}
	return lastChange, writes, bytes
}

func TestFAT32LocalCopyBench(t *testing.T) {
	base := os.Getenv("GODSEND_FAT32_TEST_DIR")
	src := os.Getenv("GODSEND_BENCH_SRC")
	if base == "" || src == "" {
		t.Skip("GODSEND_FAT32_TEST_DIR e GODSEND_BENCH_SRC nao definidos: medicao de gravacao local desligada")
	}
	if !helpers.IsFATVolume(base) && os.Getenv("GODSEND_BENCH_ALLOW_NONFAT") != "1" {
		t.Fatalf("GODSEND_FAT32_TEST_DIR=%s nao esta num volume FAT", base)
	}
	maxFiles := 1000
	if v := os.Getenv("GODSEND_BENCH_MAX_FILES"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			t.Fatalf("GODSEND_BENCH_MAX_FILES=%q invalido", v)
		}
		maxFiles = n
	}
	order := []string{"atual", "sem-sync", "direto", "direto-sync"}
	if v := os.Getenv("GODSEND_BENCH_VARIANTS"); v != "" {
		order = strings.Split(v, ",")
	}
	entries, _, err := buildLocalCopyManifest(src)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) > maxFiles {
		entries = entries[:maxFiles]
	}
	var totalSize int64
	for _, e := range entries {
		totalSize += e.size
	}
	volume := strings.TrimSuffix(filepath.VolumeName(base), `\`)
	root := filepath.Join(base, fmt.Sprintf("godsend-bench-%d", time.Now().UnixNano()))
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(root); err != nil {
			t.Errorf("limpeza de %s falhou: %v", root, err)
		}
	})
	t.Logf("origem %s: %d arquivos, %.1f MB; destino %s", src, len(entries), float64(totalSize)/1e6, root)

	for _, name := range order {
		copyFunc, ok := benchVariants[name]
		if !ok {
			t.Fatalf("variante %q desconhecida", name)
		}
		dstDir := filepath.Join(root, name)
		_, startWrites, startBytes := benchDrain(t, volume)
		start := time.Now()
		for i := range entries {
			entry := entries[i]
			entry.sha256 = ""
			if err := copyFunc(&entry, root, filepath.Join(dstDir, entry.relativePath)); err != nil {
				t.Fatalf("%s: arquivo %d/%d %s: %v", name, i+1, len(entries), entry.relativePath, err)
			}
		}
		loopEnd := time.Now()
		lastWrite, endWrites, endBytes := benchDrain(t, volume)
		end := loopEnd
		if lastWrite.After(end) {
			end = lastWrite
		}
		elapsed := end.Sub(start)
		writes := endWrites - startWrites
		t.Logf("%-12s %8.1fs (laco %6.1fs)  %7.1f arq/min  %5.2f MB/s  %7d escritas  %5.1f escr/arq  %7.1f MB no disco",
			name, elapsed.Seconds(), loopEnd.Sub(start).Seconds(),
			float64(len(entries))/elapsed.Minutes(), float64(totalSize)/1e6/elapsed.Seconds(),
			writes, float64(writes)/float64(len(entries)), float64(endBytes-startBytes)/1e6)
		if err := os.RemoveAll(dstDir); err != nil {
			t.Fatal(err)
		}
	}
}
