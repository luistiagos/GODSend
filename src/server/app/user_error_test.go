package app

import (
	"strings"
	"testing"

	"godsend/models"
)

func TestFormatErrorForUserTranslatesTechnicalErrors(t *testing.T) {
	cases := []struct {
		name      string
		raw       string
		wantMatch string
		forbidden []string
	}{
		{
			name:      "download network error",
			raw:       `Download failed: Get "https://archive.org/download/x.zip": dial tcp: lookup archive.org: no such host`,
			wantMatch: "internet",
			forbidden: []string{"dial tcp", "https://", "Download failed"},
		},
		{
			name:      "ftp connect error",
			raw:       "FTP connect: dial tcp 192.168.1.50:21: i/o timeout",
			wantMatch: "Aurora",
			forbidden: []string{"dial tcp", "i/o timeout", "FTP connect"},
		},
		{
			name:      "missing local ISO",
			raw:       `No ISO in Transfer folder for "Halo 3"`,
			wantMatch: "Transfer",
			forbidden: []string{"No ISO in Transfer folder"},
		},
		{
			name:      "catalog miss",
			raw:       "Not found in Minerva Archive",
			wantMatch: "catálogo",
			forbidden: []string{"Not found in Minerva"},
		},
		{
			name:      "corrupt archive extract",
			raw:       "Extract failed: 7z unexpected EOF",
			wantMatch: "baixado veio incompleto ou danificado",
			forbidden: []string{"Extract failed", "unexpected EOF"},
		},
		{
			name:      "FAT32 4GB limit",
			raw:       "formato XEX possui arquivo de 5.10 GB incompativel com pendrive FAT32 (limite 4 GB)",
			wantMatch: "GOD",
			forbidden: []string{"FAT32"},
		},
		{
			name:      "panic recovery",
			raw:       "Erro interno ao processar: runtime error: invalid memory address",
			wantMatch: "tentar novamente",
			forbidden: []string{"invalid memory"},
		},
		{
			name:      "minerva zero seeders stall",
			raw:       "Minerva torrent failed: Minerva sem fontes ativas (peers: 50, seeders: 0) por 45s: download estagnado sem dados, alternando para o próximo provedor",
			wantMatch: "sem seeders ativos",
			forbidden: []string{"Minerva torrent failed", "Download failed"},
		},
		{
			name:      "preserves layman Portuguese message",
			raw:       "Não há espaço no disco do PC (C:) para extrair o jogo: são necessários 7.00 GB e há 2.00 GB livres. Libere espaço e tente novamente; o download já concluído é reaproveitado.",
			wantMatch: "Libere espaço",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := FormatErrorForUser(tc.raw)
			if !strings.Contains(strings.ToLower(got), strings.ToLower(tc.wantMatch)) {
				t.Fatalf("FormatErrorForUser(%q) = %q, want substring %q", tc.raw, got, tc.wantMatch)
			}
			for _, bad := range tc.forbidden {
				if strings.Contains(got, bad) {
					t.Fatalf("FormatErrorForUser(%q) leaked technical text %q in %q", tc.raw, bad, got)
				}
			}
		})
	}
}

func TestLogStatusTranslatesErrorForQueue(t *testing.T) {
	a := NewApp()
	a.LogStatus("Halo 3", "Error", `Download failed: Get "https://example.com/a.7z": dial tcp 1.2.3.4:443: i/o timeout`)
	v, ok := a.JobQueue.Load("Halo 3")
	if !ok {
		t.Fatal("expected Halo 3 in JobQueue")
	}
	gs := v.(models.GameStatus)
	if gs.State != "Error" {
		t.Fatalf("expected state Error, got %q", gs.State)
	}
	if strings.Contains(gs.Message, "dial tcp") || strings.Contains(gs.Message, "https://") {
		t.Fatalf("LogStatus leaked technical detail to JobQueue: %q", gs.Message)
	}
	if !strings.Contains(gs.Message, "internet") {
		t.Fatalf("expected friendly internet guidance in JobQueue, got %q", gs.Message)
	}
}
