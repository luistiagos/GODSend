package utils

import (
	"io"
	"time"
)

// ExtractionProgress counts uncompressed bytes written (or verified and reused)
// and committed files. TotalBytes is -1 for sequential formats such as RAR.
// Done is only set after all entries have passed validation and been committed.
type ExtractionProgress struct {
	Bytes      int64
	TotalBytes int64
	Files      int
	Done       bool
}

type archiveProgress struct {
	ExtractionProgress
	callback func(ExtractionProgress)
	last     time.Time
}

func newArchiveProgress(callback func(ExtractionProgress)) *archiveProgress {
	return &archiveProgress{ExtractionProgress: ExtractionProgress{TotalBytes: -1}, callback: callback}
}

func (p *archiveProgress) report(force bool) {
	if p.callback == nil {
		return
	}
	now := time.Now()
	if force || now.Sub(p.last) >= time.Second {
		p.last = now
		p.callback(p.ExtractionProgress)
	}
}

func (p *archiveProgress) addBytes(n int64) {
	p.Bytes += n
	p.report(false)
}

func (p *archiveProgress) commitFile() {
	p.Files++
	p.report(false)
}

// Wrap the destination rather than the reader: only successful writes count,
// and a multi-GB single entry publishes progress before it finishes.
type extractionProgressWriter struct {
	io.Writer
	progress *archiveProgress
}

func (w extractionProgressWriter) Write(b []byte) (int, error) {
	n, err := w.Writer.Write(b)
	w.progress.addBytes(int64(n))
	return n, err
}
