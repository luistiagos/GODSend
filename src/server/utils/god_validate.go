package utils

import (
	"bytes"
	"crypto/sha1"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// GODPackageInfo is the metadata confirmed by ValidateGODContentDir.
type GODPackageInfo struct {
	TitleID     string
	MediaID     string
	ContentType uint32
	BlockCount  uint64
	PartCount   uint64
	TotalSize   int64
}

// ValidateGODContentDir validates the complete GOD/STFS hash chain under a
// Title ID directory. It catches packages that look complete by filename but
// would be rejected by the console when it verifies the MHT/SHT hashes.
func ValidateGODContentDir(contentDir, expectedTitleID string) (*GODPackageInfo, error) {
	expectedTitleID = strings.ToUpper(strings.TrimSpace(expectedTitleID))
	if len(expectedTitleID) != 8 || !isHexName(expectedTitleID) {
		return nil, fmt.Errorf("GOD invalido: Title ID esperado %q", expectedTitleID)
	}

	var contentType uint32
	var contentTypeName string
	for _, candidate := range []struct {
		name  string
		value uint32
	}{
		{name: "00007000", value: 0x00007000},
		{name: "00005000", value: 0x00005000},
	} {
		if st, err := os.Stat(filepath.Join(contentDir, candidate.name)); err == nil && st.IsDir() {
			if contentTypeName != "" {
				return nil, fmt.Errorf("GOD invalido: mais de um tipo de conteudo em %s", contentDir)
			}
			contentTypeName = candidate.name
			contentType = candidate.value
		}
	}
	if contentTypeName == "" {
		return nil, fmt.Errorf("GOD invalido: pasta 00007000/00005000 ausente em %s", contentDir)
	}

	typeDir := filepath.Join(contentDir, contentTypeName)
	entries, err := os.ReadDir(typeDir)
	if err != nil {
		return nil, fmt.Errorf("GOD invalido: ler %s: %w", typeDir, err)
	}
	var mediaID string
	for _, entry := range entries {
		if entry.IsDir() || strings.HasSuffix(strings.ToLower(entry.Name()), ".data") {
			continue
		}
		name := strings.ToUpper(entry.Name())
		if len(name) != 8 || !isHexName(name) {
			continue
		}
		if mediaID != "" {
			return nil, fmt.Errorf("GOD invalido: mais de um cabecalho de conteudo em %s", typeDir)
		}
		mediaID = name
	}
	if mediaID == "" {
		return nil, fmt.Errorf("GOD invalido: cabecalho LIVE ausente em %s", typeDir)
	}

	headerPath := filepath.Join(typeDir, mediaID)
	header, err := os.ReadFile(headerPath)
	if err != nil {
		return nil, fmt.Errorf("GOD invalido: ler cabecalho %s: %w", mediaID, err)
	}
	if len(header) != conHeaderSz {
		return nil, fmt.Errorf("GOD invalido: cabecalho %s tem %d bytes; esperado %d", mediaID, len(header), conHeaderSz)
	}
	if string(header[:4]) != "LIVE" {
		return nil, fmt.Errorf("GOD invalido: cabecalho %s nao possui assinatura LIVE", mediaID)
	}
	if got := binary.BigEndian.Uint32(header[0x0344:]); got != contentType {
		return nil, fmt.Errorf("GOD invalido: tipo de conteudo do cabecalho %08X difere da pasta %s", got, contentTypeName)
	}
	headerTitleID := fmt.Sprintf("%08X", binary.BigEndian.Uint32(header[0x0360:]))
	if headerTitleID != expectedTitleID {
		return nil, fmt.Errorf("GOD invalido: Title ID do cabecalho %s difere de %s", headerTitleID, expectedTitleID)
	}
	if contentType == 0x00007000 {
		headerMediaID := fmt.Sprintf("%08X", binary.BigEndian.Uint32(header[0x0354:]))
		if headerMediaID != mediaID {
			return nil, fmt.Errorf("GOD invalido: Media ID do cabecalho %s difere do arquivo %s", headerMediaID, mediaID)
		}
	}
	headerDigest := sha1.Sum(header[0x0344:0x0b000])
	if !bytes.Equal(header[0x032c:0x0340], headerDigest[:]) {
		return nil, fmt.Errorf("GOD invalido: hash SHA-1 do cabecalho %s nao confere", mediaID)
	}

	blockCount := uint64(header[0x0392])<<16 | uint64(header[0x0393])<<8 | uint64(header[0x0394])
	partCount := uint64(binary.LittleEndian.Uint32(header[0x03a0:]))
	if blockCount == 0 || partCount == 0 {
		return nil, fmt.Errorf("GOD invalido: contagem vazia de blocos/partes")
	}
	expectedPartCount := (blockCount + godBlocksPerPart - 1) / godBlocksPerPart
	if partCount != expectedPartCount {
		return nil, fmt.Errorf("GOD invalido: cabecalho declara %d partes para %d blocos; esperado %d", partCount, blockCount, expectedPartCount)
	}

	dataDir := filepath.Join(typeDir, mediaID+".data")
	dataEntries, err := os.ReadDir(dataDir)
	if err != nil {
		return nil, fmt.Errorf("GOD invalido: pasta de dados %s ausente: %w", mediaID+".data", err)
	}
	if uint64(len(dataEntries)) != partCount {
		return nil, fmt.Errorf("GOD invalido: pasta de dados contem %d arquivos; esperado %d", len(dataEntries), partCount)
	}
	for index, entry := range dataEntries {
		expectedName := fmt.Sprintf("Data%04d", index)
		if entry.IsDir() || !strings.EqualFold(entry.Name(), expectedName) {
			return nil, fmt.Errorf("GOD invalido: parte inesperada %q; esperado %s", entry.Name(), expectedName)
		}
	}

	mhts := make([][godHashListSz]byte, partCount)
	partSizes := make([]int64, partCount)
	remainingBlocks := blockCount
	for part := uint64(0); part < partCount; part++ {
		blocksInPart := remainingBlocks
		if blocksInPart > godBlocksPerPart {
			blocksInPart = godBlocksPerPart
		}
		path := filepath.Join(dataDir, fmt.Sprintf("Data%04d", part))
		size, mht, validateErr := validateGODPart(path, blocksInPart, part == partCount-1)
		if validateErr != nil {
			return nil, fmt.Errorf("GOD invalido: Data%04d: %w", part, validateErr)
		}
		partSizes[part] = size
		mhts[part] = mht
		remainingBlocks -= blocksInPart
	}

	for part := int(partCount) - 1; part >= 0; part-- {
		blocksInPart := uint64(godBlocksPerPart)
		if uint64(part) == partCount-1 {
			blocksInPart = blockCount - uint64(part)*godBlocksPerPart
		}
		subparts := (blocksInPart + godBlocksPerSP - 1) / godBlocksPerSP
		usedHashes := subparts
		if part+1 < int(partCount) {
			nextDigest := sha1.Sum(mhts[part+1][:])
			start := subparts * sha1.Size
			if !bytes.Equal(mhts[part][start:start+sha1.Size], nextDigest[:]) {
				return nil, fmt.Errorf("GOD invalido: Data%04d nao aponta para o hash de Data%04d", part, part+1)
			}
			usedHashes++
		}
		if !allZero(mhts[part][usedHashes*sha1.Size:]) {
			return nil, fmt.Errorf("GOD invalido: Data%04d possui lixo apos a tabela MHT", part)
		}
	}
	rootDigest := sha1.Sum(mhts[0][:])
	if !bytes.Equal(header[0x037d:0x0391], rootDigest[:]) {
		return nil, fmt.Errorf("GOD invalido: hash raiz MHT do cabecalho nao confere")
	}

	var totalSize int64
	for _, size := range partSizes {
		totalSize += size
	}
	headerSizeUnits := binary.BigEndian.Uint32(header[0x03a4:])
	if uint32(totalSize/0x100) != headerSizeUnits {
		return nil, fmt.Errorf("GOD invalido: tamanho total do cabecalho %d difere dos arquivos %d", uint64(headerSizeUnits)*0x100, totalSize)
	}

	return &GODPackageInfo{
		TitleID: expectedTitleID, MediaID: mediaID, ContentType: contentType,
		BlockCount: blockCount, PartCount: partCount, TotalSize: totalSize,
	}, nil
}

func validateGODPart(path string, blockCount uint64, isLastPart bool) (int64, [godHashListSz]byte, error) {
	var mht [godHashListSz]byte
	f, err := os.Open(path)
	if err != nil {
		return 0, mht, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return 0, mht, err
	}
	if _, err := io.ReadFull(f, mht[:]); err != nil {
		return 0, mht, fmt.Errorf("ler MHT: %w", err)
	}

	subpartCount := (blockCount + godBlocksPerSP - 1) / godBlocksPerSP
	minimumSize := int64(godHashListSz) + int64(subpartCount)*godHashListSz + int64(blockCount-1)*godBlockSz + 1
	maximumSize := int64(godHashListSz) + int64(subpartCount)*godHashListSz + int64(blockCount)*godBlockSz
	if !isLastPart {
		minimumSize = maximumSize
	}
	if st.Size() < minimumSize || st.Size() > maximumSize {
		return 0, mht, fmt.Errorf("tamanho %d fora do intervalo esperado %d..%d", st.Size(), minimumSize, maximumSize)
	}

	remainingBlocks := blockCount
	for subpart := uint64(0); subpart < subpartCount; subpart++ {
		var sht [godHashListSz]byte
		if _, err := io.ReadFull(f, sht[:]); err != nil {
			return 0, mht, fmt.Errorf("ler SHT %d: %w", subpart, err)
		}
		expectedSHTDigest := sha1.Sum(sht[:])
		start := subpart * sha1.Size
		if !bytes.Equal(mht[start:start+sha1.Size], expectedSHTDigest[:]) {
			return 0, mht, fmt.Errorf("hash MHT da subparte %d nao confere", subpart)
		}

		blocksInSubpart := remainingBlocks
		if blocksInSubpart > godBlocksPerSP {
			blocksInSubpart = godBlocksPerSP
		}
		for block := uint64(0); block < blocksInSubpart; block++ {
			readSize := int64(godBlockSz)
			isFinalBlock := isLastPart && subpart == subpartCount-1 && block == blocksInSubpart-1
			if isFinalBlock {
				position, seekErr := f.Seek(0, io.SeekCurrent)
				if seekErr != nil {
					return 0, mht, seekErr
				}
				readSize = st.Size() - position
			}
			if readSize <= 0 || readSize > godBlockSz {
				return 0, mht, fmt.Errorf("bloco final com tamanho invalido %d", readSize)
			}
			buf := make([]byte, readSize)
			if _, err := io.ReadFull(f, buf); err != nil {
				return 0, mht, fmt.Errorf("ler bloco %d da subparte %d: %w", block, subpart, err)
			}
			digest := sha1.Sum(buf)
			hashStart := block * sha1.Size
			if !bytes.Equal(sht[hashStart:hashStart+sha1.Size], digest[:]) {
				return 0, mht, fmt.Errorf("hash SHT do bloco %d da subparte %d nao confere", block, subpart)
			}
		}
		if !allZero(sht[blocksInSubpart*sha1.Size:]) {
			return 0, mht, fmt.Errorf("SHT %d possui lixo apos os hashes", subpart)
		}
		remainingBlocks -= blocksInSubpart
	}
	if position, err := f.Seek(0, io.SeekCurrent); err != nil || position != st.Size() {
		return 0, mht, fmt.Errorf("dados residuais apos a ultima subparte")
	}
	return st.Size(), mht, nil
}

func isHexName(value string) bool {
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'A' && char <= 'F') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return value != ""
}

func allZero(value []byte) bool {
	for _, b := range value {
		if b != 0 {
			return false
		}
	}
	return true
}
