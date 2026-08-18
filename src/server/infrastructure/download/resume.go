package download

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const downloadResumeVersion = 1

type downloadResumeMarker struct {
	Version       int      `json:"version"`
	Mode          string   `json:"mode"`
	URL           string   `json:"url"`
	Validator     string   `json:"validator,omitempty"`
	TotalSize     int64    `json:"total_size"`
	SegmentSize   int64    `json:"segment_size,omitempty"`
	Completed     []bool   `json:"completed,omitempty"`
	SegmentHashes []string `json:"segment_hashes,omitempty"`
}

func resumeMarkerPath(dest string) string {
	return dest + ".xbox-companion-resume.json"
}

func loadResumeMarker(dest, urlStr, mode string, totalSize, segmentSize int64) (*downloadResumeMarker, bool) {
	data, err := os.ReadFile(resumeMarkerPath(dest))
	if err != nil {
		return nil, false
	}
	var marker downloadResumeMarker
	if json.Unmarshal(data, &marker) != nil ||
		marker.Version != downloadResumeVersion || marker.Mode != mode ||
		marker.URL != urlStr || marker.TotalSize != totalSize || marker.SegmentSize != segmentSize {
		return nil, false
	}
	st, err := os.Stat(dest)
	if err != nil || !st.Mode().IsRegular() {
		return nil, false
	}
	if mode == "chunked" && st.Size() != totalSize {
		return nil, false
	}
	if mode == "single" && (st.Size() < 0 || st.Size() > totalSize) {
		return nil, false
	}
	return &marker, true
}

func loadSingleResume(dest, urlStr string) (*downloadResumeMarker, int64, bool) {
	data, err := os.ReadFile(resumeMarkerPath(dest))
	if err != nil {
		return nil, 0, false
	}
	var marker downloadResumeMarker
	if json.Unmarshal(data, &marker) != nil || marker.Version != downloadResumeVersion ||
		marker.Mode != "single" || marker.URL != urlStr || marker.TotalSize <= 0 {
		return nil, 0, false
	}
	st, err := os.Stat(dest)
	if err != nil || !st.Mode().IsRegular() || st.Size() <= 0 || st.Size() >= marker.TotalSize {
		return nil, 0, false
	}
	return &marker, st.Size(), true
}

func finishedSingleResume(dest, urlStr string) bool {
	data, err := os.ReadFile(resumeMarkerPath(dest))
	if err != nil {
		return false
	}
	var marker downloadResumeMarker
	if json.Unmarshal(data, &marker) != nil || marker.Version != downloadResumeVersion ||
		marker.Mode != "single" || marker.URL != urlStr || marker.TotalSize <= 0 {
		return false
	}
	st, err := os.Stat(dest)
	return err == nil && st.Mode().IsRegular() && st.Size() == marker.TotalSize
}

func writeResumeMarker(dest string, marker *downloadResumeMarker) error {
	if marker == nil {
		return fmt.Errorf("marcador de retomada ausente")
	}
	marker.Version = downloadResumeVersion
	data, err := json.Marshal(marker)
	if err != nil {
		return err
	}
	path := resumeMarkerPath(dest)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	tmp := path + ".new"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	if _, err := f.Write(append(data, '\n')); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	// Windows Rename cannot replace an existing file.
	_ = os.Remove(path)
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func removeDownloadResume(dest string) {
	_ = os.Remove(resumeMarkerPath(dest))
}
