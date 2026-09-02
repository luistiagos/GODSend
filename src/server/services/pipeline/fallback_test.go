package pipeline

import (
	"errors"
	"fmt"
	"testing"

	"godsend/app"
)

func TestIsFAT32LimitErrorNilSafe(t *testing.T) {
	if isFAT32LimitError(nil) {
		t.Fatal("expected nil error to return false for isFAT32LimitError")
	}
	if !isFAT32LimitError(ErrFAT32FileSizeLimit) {
		t.Fatal("expected ErrFAT32FileSizeLimit to return true")
	}
	wrapped := fmt.Errorf("wrap: %w", ErrFAT32FileSizeLimit)
	if !isFAT32LimitError(wrapped) {
		t.Fatal("expected wrapped ErrFAT32FileSizeLimit to return true")
	}
	customStr := errors.New("arquivo excede o limite maximo de 4 GB para particao")
	if !isFAT32LimitError(customStr) {
		t.Fatal("expected message containing 4 GB limit to return true")
	}
	otherErr := errors.New("network timeout")
	if isFAT32LimitError(otherErr) {
		t.Fatal("expected unrelated error to return false")
	}
}

func TestIsDownloadTooSlowErrorNilSafe(t *testing.T) {
	if isDownloadTooSlowError(nil) {
		t.Fatal("expected nil error to return false for isDownloadTooSlowError")
	}
	if !isDownloadTooSlowError(app.ErrDownloadTooSlow) {
		t.Fatal("expected ErrDownloadTooSlow to return true")
	}
	wrapped := fmt.Errorf("download: %w", app.ErrDownloadTooSlow)
	if !isDownloadTooSlowError(wrapped) {
		t.Fatal("expected wrapped ErrDownloadTooSlow to return true")
	}
	customStr := errors.New("download muito lento cancelado")
	if !isDownloadTooSlowError(customStr) {
		t.Fatal("expected message containing muito lento to return true")
	}
	otherErr := errors.New("checksum mismatch")
	if isDownloadTooSlowError(otherErr) {
		t.Fatal("expected unrelated error to return false")
	}
}
