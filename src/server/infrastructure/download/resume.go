package download

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"godsend/app"
)

const downloadResumeVersion = 1

// resumeRange describes one contiguous byte range [Start, End) in a dynamic
// parallel download, with bytes in [Start, Cursor) already durable on disk.
type resumeRange struct {
	Start  int64 `json:"start"`
	Cursor int64 `json:"cursor"`
	End    int64 `json:"end"`
}

type downloadResumeMarker struct {
	Version       int           `json:"version"`
	Mode          string        `json:"mode"`
	URL           string        `json:"url"`
	Validator     string        `json:"validator,omitempty"`
	TotalSize     int64         `json:"total_size"`
	SegmentSize   int64         `json:"segment_size,omitempty"`
	Completed     []bool        `json:"completed,omitempty"`
	SegmentHashes []string      `json:"segment_hashes,omitempty"`
	Ranges        []resumeRange `json:"ranges,omitempty"`
}

func resumeMarkerPath(dest string) string {
	return dest + app.DownloadResumeSuffix
}

func validateDynamicRanges(ranges []resumeRange, totalSize int64) bool {
	if totalSize <= 0 || len(ranges) == 0 {
		return false
	}
	var expectedStart int64
	for _, r := range ranges {
		if r.Start != expectedStart || r.Cursor < r.Start || r.Cursor > r.End || r.End > totalSize || r.End < r.Start {
			return false
		}
		expectedStart = r.End
	}
	return expectedStart == totalSize
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

// loadDynamicResume loads either a modern "dynamic" range map or a legacy v1
// "chunked" segment map (re-validating legacy SHA-256 hashes against disk so
// corrupted legacy segments are repaired seamlessly).
func loadDynamicResume(dest, urlStr string, totalSize int64) ([]resumeRange, string, bool) {
	data, err := os.ReadFile(resumeMarkerPath(dest))
	if err != nil {
		return nil, "", false
	}
	var marker downloadResumeMarker
	if json.Unmarshal(data, &marker) != nil || marker.Version != downloadResumeVersion ||
		marker.URL != urlStr || marker.TotalSize != totalSize || totalSize <= 0 {
		return nil, "", false
	}
	st, err := os.Stat(dest)
	if err != nil || !st.Mode().IsRegular() {
		return nil, "", false
	}

	switch marker.Mode {
	case "single":
		// Preserve durable single-stream prefix if a previous attempt fell back to
		// single-stream (e.g. transient probe failure) before parallel resumed.
		if st.Size() <= 0 || st.Size() > totalSize {
			return nil, "", false
		}
		return []resumeRange{{
			Start:  0,
			Cursor: st.Size(),
			End:    totalSize,
		}}, marker.Validator, true

	case "dynamic":
		if !validateDynamicRanges(marker.Ranges, totalSize) {
			return nil, "", false
		}
		// File must contain every byte claimed as durable.
		var maxDurable int64
		for _, r := range marker.Ranges {
			if r.Cursor > r.Start && r.Cursor > maxDurable {
				maxDurable = r.Cursor
			}
		}
		if st.Size() < maxDurable {
			return nil, "", false
		}
		return marker.Ranges, marker.Validator, true

	case "chunked":
		if marker.SegmentSize <= 0 || st.Size() != totalSize {
			return nil, "", false
		}
		expectedCount := int((totalSize + marker.SegmentSize - 1) / marker.SegmentSize)
		if len(marker.Completed) != expectedCount || len(marker.SegmentHashes) != expectedCount {
			return nil, "", false
		}
		f, openErr := os.Open(dest)
		if openErr != nil {
			return nil, "", false
		}
		defer f.Close()

		ranges := make([]resumeRange, 0, expectedCount)
		for idx := 0; idx < expectedCount; idx++ {
			start := int64(idx) * marker.SegmentSize
			end := start + marker.SegmentSize
			if end > totalSize {
				end = totalSize
			}
			cursor := start
			if marker.Completed[idx] {
				hash, hashErr := sha256FileRange(f, start, end-start)
				if hashErr == nil && hash == marker.SegmentHashes[idx] {
					cursor = end
				}
			}
			ranges = append(ranges, resumeRange{
				Start:  start,
				Cursor: cursor,
				End:    end,
			})
		}
		return ranges, marker.Validator, true
	}
	return nil, "", false
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

// finishedResume reports a resume marker whose file is already full and
// durable: a single-stream download synced to its total size, a legacy chunked
// download with every segment confirmed, or a dynamic download whose ranges
// cover [0, TotalSize) with every Cursor == End.
func finishedResume(dest, urlStr string) bool {
	data, err := os.ReadFile(resumeMarkerPath(dest))
	if err != nil {
		return false
	}
	var marker downloadResumeMarker
	if json.Unmarshal(data, &marker) != nil || marker.Version != downloadResumeVersion ||
		marker.URL != urlStr || marker.TotalSize <= 0 {
		return false
	}
	switch marker.Mode {
	case "single":
	case "chunked":
		if marker.SegmentSize <= 0 || len(marker.SegmentHashes) != len(marker.Completed) ||
			int64(len(marker.Completed)) != (marker.TotalSize+marker.SegmentSize-1)/marker.SegmentSize {
			return false
		}
		for _, done := range marker.Completed {
			if !done {
				return false
			}
		}
	case "dynamic":
		if !validateDynamicRanges(marker.Ranges, marker.TotalSize) {
			return false
		}
		for _, r := range marker.Ranges {
			if r.Cursor != r.End {
				return false
			}
		}
	default:
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
