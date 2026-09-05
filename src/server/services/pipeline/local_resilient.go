package pipeline

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"godsend/app"
	"godsend/infrastructure/helpers"
	"godsend/models"
)

var (
	// ErrLocalDelivery identifies destination failures. Download-provider
	// fallback must not handle these as a failed source download.
	ErrLocalDelivery = errors.New("falha no dispositivo local")
	// ErrLocalSourceLost requests regeneration from the retained ISO.
	ErrLocalSourceLost = errors.New("arquivos temporarios locais foram perdidos")
	// ErrFAT32FileSizeLimit indicates a single file exceeds FAT32's 4 GB limit.
	// Provider fallback should switch to an ISO/GOD provider rather than halting as a hardware fault.
	ErrFAT32FileSizeLimit = errors.New("arquivo excede o limite de 4 GB do FAT32")
)

const localDeviceIdentityFile = ".xbox-downloader/xbox-companion-device-id"

var localDevicePollInterval = 2 * time.Second

type localCopyEntry struct {
	sourcePath   string
	relativePath string
	size         int64
	sha256       string
}

func newLocalDeviceID() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// ensureLocalDeviceIdentity writes a durable identity on first use. If a
// different device later receives the same drive letter, its marker will not
// match and the job remains paused instead of writing to the wrong disk.
func ensureLocalDeviceIdentity(root, expectedID string) (string, error) {
	if st, err := os.Stat(root); err != nil || !st.IsDir() {
		if err == nil {
			err = fmt.Errorf("destino nao e uma pasta")
		}
		return "", err
	}
	marker := filepath.Join(root, filepath.FromSlash(localDeviceIdentityFile))
	if data, err := os.ReadFile(marker); err == nil {
		id := strings.TrimSpace(string(data))
		if id != "" {
			if expectedID != "" && id != expectedID {
				return "", fmt.Errorf("outro dispositivo esta montado em %s", root)
			}
			return id, nil
		}
	}
	if expectedID != "" {
		return "", fmt.Errorf("o dispositivo esperado nao esta montado em %s", root)
	}
	id, err := newLocalDeviceID()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(marker), 0755); err != nil {
		return "", err
	}
	tmp := marker + ".new"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return "", err
	}
	if _, err := f.Write([]byte(id + "\n")); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return "", err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return "", err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	_ = os.Remove(marker)
	if err := os.Rename(tmp, marker); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return id, nil
}

// PrepareLocalDevice creates/reads the identity marker while the user-selected
// drive is known to be connected. The returned ID is retained with the job.
func PrepareLocalDevice(root string) (string, error) {
	return ensureLocalDeviceIdentity(root, "")
}

func localDeviceMatches(root, expectedID string) bool {
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(localDeviceIdentityFile)))
	return err == nil && strings.TrimSpace(string(data)) == expectedID
}

func isLikelyLocalDeviceError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	for _, fragment := range []string{
		"device which does not exist",
		"device is not connected",
		"device not connected",
		"device is not ready",
		"the device is not ready",
		"i/o device error",
		"input/output error",
		"specified path does not exist",
		"system cannot find the path",
		"network name is no longer available",
	} {
		if strings.Contains(message, fragment) {
			return true
		}
	}
	return false
}

// isLikelyLocalStorageError separates destination/storage failures from bad
// provider data. Retrying another provider cannot fix a full, read-only or
// unavailable processing volume, so the downloaded source must be retained.
func isLikelyLocalStorageError(err error) bool {
	if err == nil {
		return false
	}
	if isLikelyLocalDeviceError(err) {
		return true
	}
	message := strings.ToLower(err.Error())
	for _, fragment := range []string{
		"no space left on device",
		"not enough space on the disk",
		"there is not enough space on the disk",
		"not enough disk space available",
		"disk full",
		"espaco insuficiente",
		"espaço insuficiente",
		"disco cheio",
		"write protected",
		"write-protected",
		"read-only file system",
		"somente leitura",
		"access is denied",
		"access denied",
		"acesso negado",
		"permission denied",
		"data error (cyclic redundancy check)",
		"cyclic redundancy check",
		"the semaphore timeout period has expired",
	} {
		if strings.Contains(message, fragment) {
			return true
		}
	}
	return false
}

func classifyLocalStorageFailure(connection *models.XboxConnection, phase string, err error) error {
	if err == nil || connection == nil || connection.Mode != "local" || !isLikelyLocalStorageError(err) {
		return err
	}
	return fmt.Errorf("%w: fase %s: %v", ErrLocalDelivery, phase, err)
}

func (s *Service) waitForLocalDevice(root, expectedID, gameName string) error {
	s.App.Logf("LOCAL: dispositivo %s desconectado; aguardando reconexao", root)
	lastLog := time.Time{}
	for {
		if s.App.IsGameJobCancelled(gameName) {
			return app.ErrJobCancelled
		}
		if localDeviceMatches(root, expectedID) {
			s.App.Logf("LOCAL: dispositivo %s reconectado; retomando gravacao", root)
			s.App.LogStatus(gameName, "Processing", "Dispositivo reconectado. Retomando e verificando arquivos...")
			return nil
		}
		if lastLog.IsZero() || time.Since(lastLog) >= 30*time.Second {
			s.App.LogStatus(gameName, "Processing", "Pendrive/HD desconectado. Reconecte o mesmo dispositivo para retomar automaticamente...")
			lastLog = time.Now()
		}
		time.Sleep(localDevicePollInterval)
	}
}

type progressWriter struct {
	onWrite func(n int64)
}

func (pw *progressWriter) Write(p []byte) (int, error) {
	n := len(p)
	if n > 0 && pw.onWrite != nil {
		pw.onWrite(int64(n))
	}
	return n, nil
}

func hashLocalFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	buf := make([]byte, app.CopyBufferSize)
	if _, err := io.CopyBuffer(h, f, buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func localFileMatches(path string, entry *localCopyEntry) (bool, error) {
	st, err := os.Stat(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !st.Mode().IsRegular() || st.Size() != entry.size {
		return false, nil
	}
	if entry.sha256 == "" {
		srcHash, srcErr := hashLocalFile(entry.sourcePath)
		if srcErr != nil {
			return false, srcErr
		}
		entry.sha256 = srcHash
	}
	hash, err := hashLocalFile(path)
	return err == nil && hash == entry.sha256, err
}

func buildLocalCopyManifest(srcDir string) ([]localCopyEntry, int64, error) {
	entries := make([]localCopyEntry, 0, 64)
	var totalSize int64
	err := filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		entries = append(entries, localCopyEntry{
			sourcePath: path, relativePath: rel, size: info.Size(), sha256: "",
		})
		totalSize += info.Size()
		return nil
	})
	return entries, totalSize, err
}

// copyLocalEntry commits only a fully written and verified file. A valid
// partial file left between copy and rename can be committed on resume.
func copyLocalEntry(entry *localCopyEntry, dst string, onProgress func(bytesCopied int64)) error {
	partial := dst + ".xbox-companion-part"
	if st, err := os.Stat(partial); err == nil && st.Mode().IsRegular() && st.Size() == entry.size {
		if matches, matchErr := localFileMatches(partial, entry); matchErr == nil && matches {
			_ = os.Remove(dst)
			return os.Rename(partial, dst)
		}
	}
	_ = os.Remove(partial)
	if entry.size >= 4294967295 && helpers.IsFATVolume(dst) {
		return fmt.Errorf("%w: o arquivo '%s' possui %.2f GB e excede o limite maximo de 4 GB do sistema FAT32 (jogos com arquivos grandes devem ser instalados no formato GOD)",
			ErrFAT32FileSizeLimit, filepath.Base(dst), float64(entry.size)/(1024*1024*1024))
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	in, err := os.Open(entry.sourcePath)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(partial, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}

	hasher := sha256.New()
	var writer io.Writer = out
	if onProgress != nil {
		writer = io.MultiWriter(out, hasher, &progressWriter{onWrite: onProgress})
	} else {
		writer = io.MultiWriter(out, hasher)
	}

	buf := make([]byte, app.CopyBufferSize)
	copied, copyErr := io.CopyBuffer(writer, in, buf)
	syncErr := out.Sync()
	closeOutErr := out.Close()

	if copyErr != nil {
		_ = os.Remove(partial)
		return copyErr
	}
	if syncErr != nil {
		_ = os.Remove(partial)
		return syncErr
	}
	if closeOutErr != nil {
		_ = os.Remove(partial)
		return closeOutErr
	}
	if copied != entry.size {
		_ = os.Remove(partial)
		return fmt.Errorf("tamanho gravado divergente para %s: esperado %d, gravado %d bytes", filepath.Base(dst), entry.size, copied)
	}

	entry.sha256 = hex.EncodeToString(hasher.Sum(nil))

	if os.Getenv("GODSEND_FULL_VERIFY") == "1" || os.Getenv("GODSEND_FULL_VERIFY") == "true" {
		partHash, hashErr := hashLocalFile(partial)
		if hashErr != nil || partHash != entry.sha256 {
			_ = os.Remove(partial)
			if hashErr != nil {
				return hashErr
			}
			return fmt.Errorf("verificacao SHA-256 falhou para %s", filepath.Base(dst))
		}
	} else {
		partStat, statErr := os.Stat(partial)
		if statErr != nil {
			_ = os.Remove(partial)
			return statErr
		}
		if partStat.Size() != entry.size {
			_ = os.Remove(partial)
			return fmt.Errorf("tamanho do arquivo no disco divergente para %s: esperado %d, encontrado %d", filepath.Base(dst), entry.size, partStat.Size())
		}
	}

	var renameErr error
	for attempt := 0; attempt < 5; attempt++ {
		_ = os.Remove(dst)
		renameErr = os.Rename(partial, dst)
		if renameErr == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	_ = os.Remove(partial)
	return renameErr
}

// copyTreeLocal resumes at file granularity. Completed files are hash checked
// and reused; an interrupted file is copied again from local staging only.
func (s *Service) copyTreeLocal(srcDir, dstDir, root, gameName, label string) error {
	expectedID := ""
	if value, ok := s.App.XboxConnections.Load(gameName); ok {
		connection := value.(models.XboxConnection)
		expectedID = connection.LocalDeviceID
	}
	deviceID, err := ensureLocalDeviceIdentity(root, expectedID)
	if err != nil {
		if expectedID == "" {
			return fmt.Errorf("%w: preparar identidade do destino: %v", ErrLocalDelivery, err)
		}
		if waitErr := s.waitForLocalDevice(root, expectedID, gameName); waitErr != nil {
			return waitErr
		}
		deviceID = expectedID
	}
	expectedID = deviceID
	entries, totalSize, err := buildLocalCopyManifest(srcDir)
	if err != nil {
		if !localDeviceMatches(root, expectedID) {
			if waitErr := s.waitForLocalDevice(root, expectedID, gameName); waitErr != nil {
				return waitErr
			}
			entries, totalSize, err = buildLocalCopyManifest(srcDir)
		}
		if err != nil {
			return fmt.Errorf("%w: %w: %v", ErrLocalDelivery, ErrLocalSourceLost, err)
		}
	}
	if len(entries) == 0 {
		return fmt.Errorf("%w: nenhum arquivo para gravar em %s", ErrLocalDelivery, srcDir)
	}
	isFAT := helpers.IsFATVolume(root)
	for _, entry := range entries {
		if entry.size >= 4294967295 && isFAT {
			return fmt.Errorf("%w: o arquivo '%s' possui %.2f GB e excede o limite maximo de 4 GB do sistema FAT32 do pendrive (jogos com arquivos individuais maiores que 4 GB devem ser instalados no formato GOD)",
				ErrFAT32FileSizeLimit, filepath.Base(entry.sourcePath), float64(entry.size)/(1024*1024*1024))
		}
	}
	remainingSize := totalSize
	for i := range entries {
		dst := filepath.Join(dstDir, entries[i].relativePath)
		if st, stErr := os.Stat(dst); stErr == nil && st.Mode().IsRegular() && st.Size() == entries[i].size {
			remainingSize -= entries[i].size
		}
	}
	if err := s.ensureFreeSpace(root, remainingSize); err != nil {
		return fmt.Errorf("%w: %v", ErrLocalDelivery, err)
	}
	s.App.Logf("LOCAL %s: %d arquivos (%.2f GB) -> %s", label, len(entries), float64(totalSize)/1073741824, dstDir)

	var doneBytes int64
	lastLog := time.Time{}

	updateProgress := func(addedBytes int64, currentFileIndex int) {
		doneBytes += addedBytes
		if lastLog.IsZero() || time.Since(lastLog) >= 500*time.Millisecond || doneBytes >= totalSize {
			pct := float64(0)
			if totalSize > 0 {
				pct = float64(doneBytes) / float64(totalSize) * 100
			}
			if pct > 100 {
				pct = 100
			}
			s.App.LogStatus(gameName, "Processing",
				fmt.Sprintf("Gravando e verificando... %.0f%% (%d/%d)", pct, currentFileIndex+1, len(entries)))
			lastLog = time.Now()
		}
	}

	for index := range entries {
		entry := &entries[index]
		dst := filepath.Join(dstDir, entry.relativePath)
		transientRetries := 0
		var fileCopiedBytes int64
		for {
			if s.App.IsGameJobCancelled(gameName) {
				return app.ErrJobCancelled
			}
			matches, copyErr := localFileMatches(dst, entry)
			if copyErr == nil && matches {
				_ = os.Remove(dst + ".xbox-companion-part")
				updateProgress(entry.size-fileCopiedBytes, index)
				break
			}
			fileCopiedBytes = 0
			if copyErr == nil {
				copyErr = copyLocalEntry(entry, dst, func(n int64) {
					fileCopiedBytes += n
					updateProgress(n, index)
				})
			}
			if copyErr == nil {
				break
			}
			doneBytes -= fileCopiedBytes
			fileCopiedBytes = 0
			if errors.Is(copyErr, ErrFAT32FileSizeLimit) {
				return copyErr
			}
			if !localDeviceMatches(root, expectedID) {
				if waitErr := s.waitForLocalDevice(root, expectedID, gameName); waitErr != nil {
					return waitErr
				}
				if _, srcErr := os.Stat(entry.sourcePath); srcErr != nil {
					return fmt.Errorf("%w: %w: %v", ErrLocalDelivery, ErrLocalSourceLost, srcErr)
				}
				transientRetries = 0
				continue
			}
			sourceHash, sourceErr := hashLocalFile(entry.sourcePath)
			if sourceErr != nil || (entry.sha256 != "" && sourceHash != entry.sha256) {
				if sourceErr == nil {
					sourceErr = fmt.Errorf("SHA-256 da origem mudou")
				}
				return fmt.Errorf("%w: %w: %v", ErrLocalDelivery, ErrLocalSourceLost, sourceErr)
			}
			if transientRetries < 3 {
				transientRetries++
				s.App.Logf("LOCAL [%s]: erro transitorio ao gravar %s (tentativa %d/3): %v", gameName, filepath.Base(entry.sourcePath), transientRetries, copyErr)
				s.App.LogStatus(gameName, "Processing", "Dispositivo respondeu novamente. Repetindo somente o arquivo interrompido...")
				time.Sleep(time.Second)
				continue
			}
			return fmt.Errorf("%w: gravar %s: %v", ErrLocalDelivery, filepath.Base(entry.sourcePath), copyErr)
		}
	}
	_ = helpers.FlushVolumeBuffers(root)
	return nil
}

func (s *Service) copyFileLocal(src, dst, root, gameName, message string) error {
	expectedID := ""
	if value, ok := s.App.XboxConnections.Load(gameName); ok {
		expectedID = value.(models.XboxConnection).LocalDeviceID
	}
	deviceID, err := ensureLocalDeviceIdentity(root, expectedID)
	if err != nil {
		if expectedID == "" {
			return fmt.Errorf("%w: preparar identidade do destino: %v", ErrLocalDelivery, err)
		}
		if waitErr := s.waitForLocalDevice(root, expectedID, gameName); waitErr != nil {
			return waitErr
		}
		deviceID = expectedID
	}
	expectedID = deviceID
	st, err := os.Stat(src)
	if err != nil {
		return fmt.Errorf("%w: origem indisponivel: %v", ErrLocalDelivery, err)
	}
	entry := localCopyEntry{sourcePath: src, relativePath: filepath.Base(dst), size: st.Size(), sha256: ""}
	if err := s.ensureFreeSpace(root, entry.size); err != nil {
		return fmt.Errorf("%w: %v", ErrLocalDelivery, err)
	}
	s.App.LogStatus(gameName, "Processing", message)
	transientRetries := 0
	for {
		if s.App.IsGameJobCancelled(gameName) {
			return app.ErrJobCancelled
		}
		if matches, matchErr := localFileMatches(dst, &entry); matchErr == nil && matches {
			_ = os.Remove(dst + ".xbox-companion-part")
			_ = helpers.FlushVolumeBuffers(root)
			return nil
		}
		if err := copyLocalEntry(&entry, dst, nil); err == nil {
			_ = helpers.FlushVolumeBuffers(root)
			return nil
		} else if localDeviceMatches(root, expectedID) {
			if transientRetries < 3 {
				transientRetries++
				s.App.Logf("LOCAL [%s]: erro transitorio ao gravar %s (tentativa %d/3): %v", gameName, filepath.Base(src), transientRetries, err)
				time.Sleep(time.Second)
				continue
			}
			return fmt.Errorf("%w: gravar %s: %v", ErrLocalDelivery, filepath.Base(src), err)
		}
		if err := s.waitForLocalDevice(root, expectedID, gameName); err != nil {
			return err
		}
		transientRetries = 0
	}
}

