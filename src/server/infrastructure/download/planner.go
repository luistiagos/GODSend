// planner.go — Dynamic range segment planner, slow-connection tracker, and
// adaptive per-host connection limits (MDM-style parallel download engine).
package download

import (
	"context"
	"math"
	"net/url"
	"strings"
	"sync"
	"time"

	"godsend/app"
)

const (
	defaultSplitAlignBytes = 64 * 1024        // 64 KiB alignment for dynamic splits
	defaultBoundedChunk    = 16 * 1024 * 1024 // 16 MiB chunks for non-sparse volumes (exFAT)
	maxStealsPerSegment    = 2                // bounds pending-segment steals so high-TTFB items never ping-pong
	hostLimitTTL           = 10 * time.Minute
	hostRefusalWindow      = 60 * time.Second
)

// Tunable package variables (overridable in unit tests for fast deterministic runs).
var (
	slowEvalWindow         = 2 * time.Second
	slowCutMinRemainingSec = 4.0
	slowCutCooldown        = 8 * time.Second
	slowFastSampleMinDur   = 200 * time.Millisecond
)

type segment struct {
	id            int
	start         int64
	cursor        int64
	end           int64
	writingEnd    int64 // >0 while owner is writing unlocked; split never sets mid < writingEnd
	owner         int   // worker ID (>=0) or -1 when unowned
	assignedAt    time.Time
	firstByteAt   time.Time
	failures      int
	steals        int
	lastSlowCutAt time.Time
	cancelCurrent context.CancelFunc
}

type plannerConfig struct {
	totalSize         int64
	workers           int
	minSplit          int64
	splitAlign        int64
	boundedWindow     bool
	boundedChunkSize  int64
	fixedChunkSize    int64 // >0 forces fixed non-splitting initial chunks (legacy test hook)
	stealPendingAfter time.Duration
}

type plannerStats struct {
	splits  int
	steals  int
	retries int
}

// segmentPlanner coordinates byte ranges across parallel HTTP workers.
//
// In sparse/unbounded mode (NTFS, Linux, macOS, Android), it starts with a
// single [0, totalSize) segment and dynamically splits the largest remaining
// range in half whenever an idle worker needs work (MDM rule #1). That keeps
// each worker on one continuous HTTP/1.1 stream instead of paying TTFB every
// 4 MiB, while still eliminating slow tails via work-stealing.
//
// In bounded-window mode (Windows exFAT / non-sparse volumes), it expands the
// frontier in 16 MiB blocks up to (workers + 2) * 16 MiB ahead of the
// contiguous prefix and splits the lowest-offset segment while the frontier is
// held back, preventing synchronous zero-fill stalls.
type segmentPlanner struct {
	mu                sync.Mutex
	notifyCh          chan struct{}
	totalSize         int64
	minSplit          int64
	splitAlign        int64
	boundedWindow     bool
	chunkSize         int64
	window            int64
	stealPendingAfter time.Duration

	nextID       int
	nextFrontier int64
	segments     []*segment
	totalWritten int64
	splits       int
	steals       int
	retries      int
}

func newSegmentPlanner(cfg plannerConfig, resumedRanges []resumeRange) *segmentPlanner {
	p := &segmentPlanner{
		notifyCh:          make(chan struct{}, 1),
		totalSize:         cfg.totalSize,
		minSplit:          cfg.minSplit,
		splitAlign:        cfg.splitAlign,
		boundedWindow:     cfg.boundedWindow,
		chunkSize:         cfg.boundedChunkSize,
		stealPendingAfter: cfg.stealPendingAfter,
	}
	if p.chunkSize <= 0 {
		p.chunkSize = defaultBoundedChunk
	}
	workers := cfg.workers
	if workers < 1 {
		workers = 1
	}
	if p.boundedWindow {
		p.window = int64(workers+2) * p.chunkSize
	}

	if len(resumedRanges) > 0 {
		// On non-sparse volumes (exFAT), preserve bounded-window expansion for any
		// unstarted tail [last.Start, totalSize) so resuming never jumps gigabytes
		// past EOF and triggers synchronous zero-fill.
		activeRanges := resumedRanges
		p.nextFrontier = cfg.totalSize
		if p.boundedWindow {
			last := resumedRanges[len(resumedRanges)-1]
			if last.Cursor == last.Start && last.End == cfg.totalSize && last.End-last.Start > p.chunkSize {
				activeRanges = resumedRanges[:len(resumedRanges)-1]
				p.nextFrontier = last.Start
			} else {
				p.boundedWindow = false
			}
		}
		for _, r := range activeRanges {
			seg := &segment{
				id:     p.nextID,
				start:  r.Start,
				cursor: r.Cursor,
				end:    r.End,
				owner:  -1,
			}
			p.nextID++
			p.segments = append(p.segments, seg)
			p.totalWritten += r.Cursor - r.Start
		}
		return p
	}

	if cfg.fixedChunkSize > 0 {
		p.nextFrontier = cfg.totalSize
		p.boundedWindow = false
		p.minSplit = 0 // respect caller's exact chunk boundaries
		for off := int64(0); off < cfg.totalSize; off += cfg.fixedChunkSize {
			end := off + cfg.fixedChunkSize
			if end > cfg.totalSize {
				end = cfg.totalSize
			}
			p.segments = append(p.segments, &segment{
				id:     p.nextID,
				start:  off,
				cursor: off,
				end:    end,
				owner:  -1,
			})
			p.nextID++
		}
		return p
	}

	if p.boundedWindow {
		p.nextFrontier = 0
		return p
	}

	// Unbounded sparse mode: start with the entire file as one segment and
	// split dynamically as workers ask for work.
	p.nextFrontier = cfg.totalSize
	if cfg.totalSize > 0 {
		p.segments = append(p.segments, &segment{
			id:     p.nextID,
			start:  0,
			cursor: 0,
			end:    cfg.totalSize,
			owner:  -1,
		})
		p.nextID++
	}
	return p
}

func (p *segmentPlanner) signalLocked() {
	select {
	case p.notifyCh <- struct{}{}:
	default:
	}
}

func (p *segmentPlanner) waitCh() <-chan struct{} {
	return p.notifyCh
}

func (p *segmentPlanner) initialWritten() int64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.totalWritten
}

func (p *segmentPlanner) stats() plannerStats {
	p.mu.Lock()
	defer p.mu.Unlock()
	return plannerStats{
		splits:  p.splits,
		steals:  p.steals,
		retries: p.retries,
	}
}

func (p *segmentPlanner) contiguousPrefixLocked() int64 {
	prefix := p.nextFrontier
	for _, seg := range p.segments {
		if seg.cursor < seg.end && seg.cursor < prefix {
			prefix = seg.cursor
		}
	}
	return prefix
}

func (p *segmentPlanner) isCompleteLocked() bool {
	if p.nextFrontier < p.totalSize {
		return false
	}
	for _, seg := range p.segments {
		if seg.cursor < seg.end {
			return false
		}
	}
	return true
}

func (p *segmentPlanner) isComplete() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.isCompleteLocked()
}

// assign hands workerID a segment to download.
// Returns (seg, true) when work was assigned, (nil, true) when work remains
// but nothing can be split/stolen right now (caller should wait), or
// (nil, false) when the entire download is complete.
func (p *segmentPlanner) assign(workerID int, now time.Time) (*segment, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.isCompleteLocked() {
		return nil, false
	}

	// Step 1: lowest-offset unowned incomplete segment.
	for _, seg := range p.segments {
		if seg.owner == -1 && seg.cursor < seg.end {
			seg.owner = workerID
			seg.assignedAt = now
			seg.firstByteAt = time.Time{}
			seg.cancelCurrent = nil
			return seg, true
		}
	}

	// Step 2: expand bounded frontier while inside window.
	if p.boundedWindow && p.nextFrontier < p.totalSize && p.nextFrontier-p.contiguousPrefixLocked() < p.window {
		end := p.nextFrontier + p.chunkSize
		if end > p.totalSize {
			end = p.totalSize
		}
		seg := &segment{
			id:         p.nextID,
			start:      p.nextFrontier,
			cursor:     p.nextFrontier,
			end:        end,
			owner:      workerID,
			assignedAt: now,
		}
		p.nextID++
		p.nextFrontier = end
		p.segments = append(p.segments, seg)
		return seg, true
	}

	// Step 3 (MDM rule #1.2): steal a segment whose owner still hasn't received
	// its first byte after stealPendingAfter. Doubles the threshold on each steal
	// and caps at maxStealsPerSegment so legitimately slow-TTFB items (5-8 s on
	// archive.org) never ping-pong between idle workers.
	if p.stealPendingAfter > 0 {
		for _, seg := range p.segments {
			if seg.owner >= 0 && seg.owner != workerID && seg.cursor < seg.end &&
				seg.firstByteAt.IsZero() && seg.writingEnd == 0 && seg.steals < maxStealsPerSegment {
				threshold := p.stealPendingAfter << seg.steals
				if now.Sub(seg.assignedAt) < threshold {
					continue
				}
				oldCancel := seg.cancelCurrent
				seg.owner = workerID
				seg.assignedAt = now
				seg.firstByteAt = time.Time{}
				seg.cancelCurrent = nil
				seg.steals++
				p.steals++
				if oldCancel != nil {
					oldCancel()
				}
				return seg, true
			}
		}
	}

	// Step 4 (MDM rule #1.3): dynamically split an active segment in half.
	if p.minSplit > 0 {
		victimIdx := -1
		var victimSpan int64
		preferLowest := p.boundedWindow && p.nextFrontier < p.totalSize
		for i, seg := range p.segments {
			floor := seg.cursor
			if seg.writingEnd > floor {
				floor = seg.writingEnd
			}
			span := seg.end - floor
			if span < 2*p.minSplit {
				continue
			}
			if victimIdx < 0 {
				victimIdx = i
				victimSpan = span
				if preferLowest {
					break // p.segments is sorted by start/offset
				}
				continue
			}
			if !preferLowest && span > victimSpan {
				victimIdx = i
				victimSpan = span
			}
		}
		if victimIdx >= 0 {
			victim := p.segments[victimIdx]
			floor := victim.cursor
			if victim.writingEnd > floor {
				floor = victim.writingEnd
			}
			mid := floor + (victim.end-floor)/2
			if p.splitAlign > 0 && victim.end-floor >= 2*p.splitAlign {
				mid -= mid % p.splitAlign
			}
			if mid-floor < p.minSplit {
				mid = floor + p.minSplit
			}
			if victim.end-mid >= p.minSplit {
				half := &segment{
					id:         p.nextID,
					start:      mid,
					cursor:     mid,
					end:        victim.end,
					owner:      workerID,
					assignedAt: now,
				}
				p.nextID++
				victim.end = mid
				// Keep p.segments sorted by offset by inserting right after victim.
				p.segments = append(p.segments, nil)
				copy(p.segments[victimIdx+2:], p.segments[victimIdx+1:])
				p.segments[victimIdx+1] = half
				p.splits++
				return half, true
			}
		}
	}

	return nil, true
}

func (p *segmentPlanner) segmentBounds(seg *segment, workerID int) (start, end int64, ok bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if seg.owner != workerID || seg.cursor >= seg.end {
		return 0, 0, false
	}
	return seg.cursor, seg.end, true
}

func (p *segmentPlanner) setRequestCancel(seg *segment, workerID int, cancel context.CancelFunc) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if seg.owner != workerID {
		return false
	}
	seg.cancelCurrent = cancel
	return true
}

// beginWrite reserves [seg.cursor, seg.cursor+keep) for an unlocked WriteAt so
// a concurrent split can never shrink seg.end below the bytes being written.
func (p *segmentPlanner) beginWrite(seg *segment, workerID int, n int64) (off, keep int64, ok bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if seg.owner != workerID || seg.cursor >= seg.end {
		return 0, 0, false
	}
	rem := seg.end - seg.cursor
	if n > rem {
		n = rem
	}
	if n <= 0 {
		return 0, 0, false
	}
	off = seg.cursor
	seg.writingEnd = off + n
	return off, n, true
}

func (p *segmentPlanner) abortWrite(seg *segment, workerID int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if seg.owner == workerID {
		seg.writingEnd = 0
	}
}

func (p *segmentPlanner) commitWrite(seg *segment, workerID int, written int64, now time.Time) (done bool, remaining int64, totalWritten int64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if seg.owner != workerID {
		return true, 0, p.totalWritten
	}
	seg.cursor += written
	seg.writingEnd = 0
	seg.failures = 0
	if seg.firstByteAt.IsZero() && written > 0 {
		seg.firstByteAt = now
	}
	p.totalWritten += written
	if seg.cursor >= seg.end {
		seg.owner = -1
		seg.cancelCurrent = nil
		p.signalLocked()
		return true, 0, p.totalWritten
	}
	return false, seg.end - seg.cursor, p.totalWritten
}

func (p *segmentPlanner) markSlowCut(seg *segment, workerID int, now time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if seg.owner == workerID {
		seg.lastSlowCutAt = now
	}
}

func (p *segmentPlanner) lastSlowCut(seg *segment) time.Time {
	p.mu.Lock()
	defer p.mu.Unlock()
	return seg.lastSlowCutAt
}

// release returns a segment to the planner (preserving seg.cursor so no written
// bytes are lost). When countFailure is true, increments failures and retries.
// Returns (failures, cursor, stillPending) safely captured under p.mu.
func (p *segmentPlanner) release(seg *segment, workerID int, countFailure bool) (failures int, cursor int64, stillPending bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if seg.owner != workerID {
		return 0, 0, false
	}
	seg.writingEnd = 0
	seg.cancelCurrent = nil
	seg.owner = -1
	cursor = seg.cursor
	if seg.cursor >= seg.end {
		p.signalLocked()
		return 0, cursor, false
	}
	if countFailure {
		seg.failures++
		p.retries++
	}
	p.signalLocked()
	return seg.failures, cursor, true
}

// snapshotRanges returns a sorted, complete snapshot of [0, totalSize) suitable
// for durable checkpointing. Bytes below each range's Cursor have already been
// written via WriteAt before this snapshot was taken.
func (p *segmentPlanner) snapshotRanges() []resumeRange {
	p.mu.Lock()
	defer p.mu.Unlock()

	out := make([]resumeRange, 0, len(p.segments)+1)
	for _, seg := range p.segments {
		// Coalesce adjacent fully-completed ranges to keep the JSON compact.
		if len(out) > 0 && out[len(out)-1].Cursor == out[len(out)-1].End &&
			seg.cursor == seg.end && out[len(out)-1].End == seg.start {
			out[len(out)-1].End = seg.end
			out[len(out)-1].Cursor = seg.end
			continue
		}
		out = append(out, resumeRange{
			Start:  seg.start,
			Cursor: seg.cursor,
			End:    seg.end,
		})
	}
	if p.nextFrontier < p.totalSize {
		out = append(out, resumeRange{
			Start:  p.nextFrontier,
			Cursor: p.nextFrontier,
			End:    p.totalSize,
		})
	}
	return out
}

// ── Slow-connection tracker (MDM rule #4 + anti-thrash calibration) ───────────

type slowConnectionTracker struct {
	mu               sync.Mutex
	bestConn         float64
	bestAggregate    float64
	aggStart         time.Time
	aggStartWritten  int64
	cuts             int
}

func newSlowConnectionTracker(now time.Time, initialWritten int64) *slowConnectionTracker {
	return &slowConnectionTracker{
		aggStart:        now,
		aggStartWritten: initialWritten,
	}
}

func (t *slowConnectionTracker) recordFastCompletion(bytes int64, dur time.Duration) {
	if bytes <= 0 || dur < slowFastSampleMinDur {
		return
	}
	rate := float64(bytes) / dur.Seconds()
	t.mu.Lock()
	if rate > t.bestConn {
		t.bestConn = rate
	}
	t.mu.Unlock()
}

// shouldCut evaluates MDM rule #4 on a 2 s window sample:
// yardstick = min(bestConn, bestAggregate / max(1, receiving)).
// A connection below yardstick/4 with more than slowCutMinRemainingSec of work
// left (and past slowCutCooldown) is cut and reconnected on a fresh socket.
func (t *slowConnectionTracker) shouldCut(rate float64, remainingBytes int64, receiving int, lastCut time.Time, totalWritten int64, now time.Time) bool {
	t.mu.Lock()
	defer t.mu.Unlock()

	if rate > t.bestConn {
		t.bestConn = rate
	}
	if elapsed := now.Sub(t.aggStart); elapsed >= slowEvalWindow {
		delta := totalWritten - t.aggStartWritten
		if delta > 0 {
			agg := float64(delta) / elapsed.Seconds()
			if agg > t.bestAggregate {
				t.bestAggregate = agg
			}
		}
		t.aggStart = now
		t.aggStartWritten = totalWritten
	}

	if receiving <= 0 {
		receiving = 1
	}
	yardstick := t.bestConn
	if t.bestAggregate > 0 {
		perConn := t.bestAggregate / float64(receiving)
		if yardstick == 0 || perConn < yardstick {
			yardstick = perConn
		}
	}
	if yardstick <= 0 || rate >= yardstick/4.0 {
		return false
	}
	if !lastCut.IsZero() && now.Sub(lastCut) < slowCutCooldown {
		return false
	}
	if rate > 0 && float64(remainingBytes) <= rate*slowCutMinRemainingSec {
		return false
	}
	t.cuts++
	return true
}

func (t *slowConnectionTracker) totalCuts() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.cuts
}

// ── Adaptive per-host connection limits (MDM rule #5) ─────────────────────────

type hostLimitEntry struct {
	refusalCount  int
	lastRefusalAt time.Time
	learnedCap    int
	capExpiresAt  time.Time
}

type hostConnectionLimits struct {
	mu      sync.Mutex
	entries map[string]*hostLimitEntry
}

var globalHostLimits = newHostConnectionLimits()

func newHostConnectionLimits() *hostConnectionLimits {
	return &hostConnectionLimits{
		entries: make(map[string]*hostLimitEntry),
	}
}

func normalizedHostKey(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

// isArchiveOrgHost reports whether host belongs to archive.org (including CDN nodes).
func isArchiveOrgHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	return host == "archive.org" || strings.HasSuffix(host, ".archive.org")
}

// defaultHostCeiling returns the connection ceiling for rawURL given the user's
// configured IADownloadMaxParallel. archive.org scales per connection and uses
// the full configured parallel count (default 8); other hosts (HuggingFace,
// EdgeEmu, mirrors) cap at app.DefaultHostMaxParallel (4) so we saturate the
// link without tripping aggressive per-IP rate limits.
func defaultHostCeiling(rawURL string, configuredMax int) int {
	if configuredMax < 1 {
		return 1
	}
	host := normalizedHostKey(rawURL)
	if isArchiveOrgHost(host) || strings.Contains(strings.ToLower(rawURL), "archive.org") {
		return configuredMax
	}
	if configuredMax > app.DefaultHostMaxParallel {
		return app.DefaultHostMaxParallel
	}
	return configuredMax
}

// recordRefusal records a 429/503/connection-refused event while activeReceiving
// other connections are transferring data. After 2 observations within
// hostRefusalWindow, caps the host to max(1, activeReceiving) for hostLimitTTL.
func (h *hostConnectionLimits) recordRefusal(rawURL string, activeReceiving int, now time.Time) (int, bool) {
	if activeReceiving < 1 {
		return 0, false
	}
	host := normalizedHostKey(rawURL)
	if host == "" {
		return 0, false
	}
	h.mu.Lock()
	defer h.mu.Unlock()

	e, ok := h.entries[host]
	if !ok {
		e = &hostLimitEntry{}
		h.entries[host] = e
	}
	if now.Sub(e.lastRefusalAt) > hostRefusalWindow {
		e.refusalCount = 0
	}
	e.refusalCount++
	e.lastRefusalAt = now
	if e.refusalCount >= 2 {
		capVal := activeReceiving
		if capVal < 1 {
			capVal = 1
		}
		if e.learnedCap == 0 || now.After(e.capExpiresAt) || capVal < e.learnedCap {
			e.learnedCap = capVal
		}
		e.capExpiresAt = now.Add(hostLimitTTL)
		return e.learnedCap, true
	}
	return 0, false
}

func (h *hostConnectionLimits) effectiveLimit(rawURL string, baseLimit int, now time.Time) int {
	if baseLimit < 1 {
		return 1
	}
	host := normalizedHostKey(rawURL)
	if host == "" {
		return baseLimit
	}
	h.mu.Lock()
	defer h.mu.Unlock()

	e, ok := h.entries[host]
	if !ok || e.learnedCap <= 0 || now.After(e.capExpiresAt) {
		return baseLimit
	}
	if e.learnedCap < baseLimit {
		return e.learnedCap
	}
	return baseLimit
}

// retryBackoff computes a fast-recovering exponential backoff (MDM rule #3):
// attempt 1 -> immediate (0), attempt 2 -> 1s, attempt 3 -> 2s, ..., capped at 30s.
func retryBackoff(failureCount int, retryAfter time.Duration) time.Duration {
	if retryAfter > 0 {
		if retryAfter > 60*time.Second {
			return 60 * time.Second
		}
		return retryAfter
	}
	if failureCount <= 1 {
		return 0
	}
	secs := math.Pow(2, float64(failureCount-2))
	if secs > 30 {
		secs = 30
	}
	return time.Duration(secs) * time.Second
}
