package utils

import (
	"context"
	"io"
	"sync"
	"time"
)

// ExtractionProgress counts uncompressed bytes written (or verified and reused)
// and committed files. TotalBytes is -1 for sequential formats such as RAR.
// Done is only set after all entries have passed validation and been committed.
type ExtractionProgress struct {
	Bytes            int64
	TotalBytes       int64
	Files            int
	Done             bool
	CurrentFile      string
	CurrentFileBytes int64
	CurrentFileSize  int64
	ActiveOp         string
}

type extractionTrackerKey struct{}

// ExtractionTracker exposes a thread-safe live snapshot of an ongoing extraction.
type ExtractionTracker struct {
	mu       sync.RWMutex
	progress *archiveProgress
}

// ContextWithExtractionTracker attaches an ExtractionTracker to ctx so callers
// can inspect live progress and active I/O phase even if extraction stalls.
func ContextWithExtractionTracker(ctx context.Context) (context.Context, *ExtractionTracker) {
	if ctx == nil {
		ctx = context.Background()
	}
	tracker := &ExtractionTracker{}
	return context.WithValue(ctx, extractionTrackerKey{}, tracker), tracker
}

func (t *ExtractionTracker) attach(p *archiveProgress) {
	if t == nil {
		return
	}
	t.mu.Lock()
	t.progress = p
	t.mu.Unlock()
}

// Snapshot returns the current extraction counters, active entry, and I/O op.
func (t *ExtractionTracker) Snapshot() ExtractionProgress {
	if t == nil {
		return ExtractionProgress{TotalBytes: -1}
	}
	t.mu.RLock()
	p := t.progress
	t.mu.RUnlock()
	if p == nil {
		return ExtractionProgress{TotalBytes: -1}
	}
	return p.snapshot()
}

type archiveProgress struct {
	mu sync.Mutex
	ExtractionProgress
	ctx      context.Context
	callback func(ExtractionProgress)
	last     time.Time
}

func newArchiveProgress(callback func(ExtractionProgress)) *archiveProgress {
	return newArchiveProgressWithContext(context.Background(), callback)
}

func newArchiveProgressWithContext(ctx context.Context, callback func(ExtractionProgress)) *archiveProgress {
	if ctx == nil {
		ctx = context.Background()
	}
	p := &archiveProgress{
		ExtractionProgress: ExtractionProgress{TotalBytes: -1},
		ctx:                ctx,
		callback:           callback,
	}
	if tracker, ok := ctx.Value(extractionTrackerKey{}).(*ExtractionTracker); ok && tracker != nil {
		tracker.attach(p)
	}
	return p
}

func (p *archiveProgress) cancelled() error {
	if p == nil || p.ctx == nil {
		return nil
	}
	return p.ctx.Err()
}

func (p *archiveProgress) snapshot() ExtractionProgress {
	if p == nil {
		return ExtractionProgress{TotalBytes: -1}
	}
	p.mu.Lock()
	snap := p.ExtractionProgress
	p.mu.Unlock()
	return snap
}

func (p *archiveProgress) setTotalBytes(total int64) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.TotalBytes = total
	p.mu.Unlock()
}

func (p *archiveProgress) startEntry(name string, size int64) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.CurrentFile = name
	p.CurrentFileBytes = 0
	p.CurrentFileSize = size
	p.ActiveOp = "entry"
	p.mu.Unlock()
}

func (p *archiveProgress) ensureEntryName(name string, size int64) {
	if p == nil {
		return
	}
	p.mu.Lock()
	if p.CurrentFile == "" {
		p.CurrentFile = name
		p.CurrentFileBytes = 0
		p.CurrentFileSize = size
	}
	p.mu.Unlock()
}

func (p *archiveProgress) setOp(op string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.ActiveOp = op
	p.mu.Unlock()
}

func (p *archiveProgress) markDone() {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.Done = true
	p.ActiveOp = ""
	p.CurrentFile = ""
	p.mu.Unlock()
	p.report(true)
}

func (p *archiveProgress) reportLocked(force bool) (func(ExtractionProgress), ExtractionProgress, bool) {
	if p.callback == nil {
		return nil, ExtractionProgress{}, false
	}
	now := time.Now()
	if force || now.Sub(p.last) >= time.Second {
		p.last = now
		return p.callback, p.ExtractionProgress, true
	}
	return nil, ExtractionProgress{}, false
}

func (p *archiveProgress) report(force bool) {
	if p == nil {
		return
	}
	p.mu.Lock()
	cb, snap, ok := p.reportLocked(force)
	p.mu.Unlock()
	if ok {
		cb(snap)
	}
}

func (p *archiveProgress) addBytes(n int64) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.Bytes += n
	p.CurrentFileBytes += n
	cb, snap, ok := p.reportLocked(false)
	p.mu.Unlock()
	if ok {
		cb(snap)
	}
}

func (p *archiveProgress) commitFile() {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.Files++
	p.ActiveOp = ""
	p.CurrentFile = ""
	cb, snap, ok := p.reportLocked(false)
	p.mu.Unlock()
	if ok {
		cb(snap)
	}
}

type cancelReader struct {
	io.Reader
	progress *archiveProgress
	op       string
}

func (r cancelReader) Read(b []byte) (int, error) {
	if err := r.progress.cancelled(); err != nil {
		return 0, err
	}
	op := r.op
	if op == "" {
		op = "read"
	}
	r.progress.setOp(op)
	return r.Reader.Read(b)
}

// Wrap the destination rather than the reader: only successful writes count,
// and a multi-GB single entry publishes progress before it finishes.
type extractionProgressWriter struct {
	io.Writer
	progress *archiveProgress
}

func (w extractionProgressWriter) Write(b []byte) (int, error) {
	if err := w.progress.cancelled(); err != nil {
		return 0, err
	}
	w.progress.setOp("write")
	n, err := w.Writer.Write(b)
	w.progress.addBytes(int64(n))
	if err != nil {
		return n, err
	}
	if cancelErr := w.progress.cancelled(); cancelErr != nil {
		return n, cancelErr
	}
	return n, nil
}
