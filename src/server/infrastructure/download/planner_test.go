package download

import (
	"math/rand"
	"testing"
	"time"
)

func TestPlannerDynamicSplitsCoverExactFileWithoutOverlap(t *testing.T) {
	const totalSize int64 = 256 * 1024 * 1024 // 256 MiB
	p := newSegmentPlanner(plannerConfig{
		totalSize:  totalSize,
		workers:    8,
		minSplit:   4 * 1024 * 1024,
		splitAlign: defaultSplitAlignBytes,
	}, nil)

	now := time.Now()
	assigned := make([]*segment, 0, 8)
	for wid := 0; wid < 8; wid++ {
		seg, more := p.assign(wid, now)
		if !more || seg == nil {
			t.Fatalf("worker %d expected a split segment, got seg=%v more=%v", wid, seg, more)
		}
		assigned = append(assigned, seg)
	}
	if stats := p.stats(); stats.splits != 7 {
		t.Fatalf("expected 7 dynamic splits for 8 workers, got %d", stats.splits)
	}

	// Verify snapshots are disjoint, sorted, aligned, and cover [0, totalSize).
	snap := p.snapshotRanges()
	if !validateDynamicRanges(snap, totalSize) {
		t.Fatalf("invalid dynamic ranges after 7 splits: %+v", snap)
	}
	for i, r := range snap {
		if i > 0 && r.Start%defaultSplitAlignBytes != 0 {
			t.Fatalf("range %d start=%d not aligned to 64 KiB", i, r.Start)
		}
	}

	// Complete all 8 workers.
	for wid, seg := range assigned {
		for {
			off, keep, ok := p.beginWrite(seg, wid, 1024*1024)
			if !ok {
				break
			}
			_ = off
			done, _, _ := p.commitWrite(seg, wid, keep, now)
			if done {
				break
			}
		}
	}
	if !p.isComplete() {
		t.Fatal("planner should be complete")
	}
	finalSnap := p.snapshotRanges()
	if len(finalSnap) != 1 || finalSnap[0] != (resumeRange{Start: 0, Cursor: totalSize, End: totalSize}) {
		t.Fatalf("expected coalesced single completed range, got %+v", finalSnap)
	}
}

func TestPlannerRandomizedSimulation(t *testing.T) {
	rng := rand.New(rand.NewSource(42))
	const totalSize int64 = 64 * 1024 // 64 KiB byte-level accounting
	writtenCount := make([]int, totalSize)

	p := newSegmentPlanner(plannerConfig{
		totalSize:         totalSize,
		workers:           6,
		minSplit:          512,
		splitAlign:        64,
		stealPendingAfter: 5 * time.Second,
	}, nil)

	type workerState struct {
		seg *segment
	}
	workers := make([]workerState, 6)
	now := time.Now()

	for step := 0; step < 50000 && !p.isComplete(); step++ {
		now = now.Add(time.Duration(rng.Intn(300)) * time.Millisecond)
		wid := rng.Intn(len(workers))
		ws := &workers[wid]

		if ws.seg == nil {
			seg, more := p.assign(wid, now)
			if !more {
				break
			}
			ws.seg = seg
			continue
		}

		// Randomly simulate write, mid-segment drop, or wait.
		action := rng.Intn(10)
		if action == 0 {
			p.release(ws.seg, wid, true)
			ws.seg = nil
			continue
		}
		chunk := int64(1 + rng.Intn(512))
		off, keep, ok := p.beginWrite(ws.seg, wid, chunk)
		if !ok {
			ws.seg = nil
			continue
		}
		for pos := off; pos < off+keep; pos++ {
			writtenCount[pos]++
			if writtenCount[pos] > 1 {
				t.Fatalf("byte %d written %d times (overlapping write)", pos, writtenCount[pos])
			}
		}
		done, _, _ := p.commitWrite(ws.seg, wid, keep, now)
		if done {
			ws.seg = nil
		}
	}

	if !p.isComplete() {
		t.Fatalf("simulation did not finish: ranges=%+v", p.snapshotRanges())
	}
	for pos, c := range writtenCount {
		if c != 1 {
			t.Fatalf("byte %d written %d times, want 1", pos, c)
		}
	}
}

func TestPlannerBoundedWindowLimitsAheadBytes(t *testing.T) {
	const (
		chunk     int64 = 16 * 1024 * 1024
		totalSize int64 = 256 * 1024 * 1024
		workers         = 4
	)
	p := newSegmentPlanner(plannerConfig{
		totalSize:        totalSize,
		workers:          workers,
		minSplit:         4 * 1024 * 1024,
		splitAlign:       defaultSplitAlignBytes,
		boundedWindow:    true,
		boundedChunkSize: chunk,
	}, nil)

	now := time.Now()
	// Worker 0 stalls on [0, 16M). Other workers can expand up to window = (4+2)*16M = 96M.
	seg0, _ := p.assign(0, now)
	if seg0.start != 0 || seg0.end != chunk {
		t.Fatalf("unexpected seg0: %+v", seg0)
	}
	// Consume chunks 1..5 on worker 1 until frontier hits 96 MiB (window limit).
	for i := 1; i < workers+2; i++ {
		seg, _ := p.assign(1, now)
		if seg == nil || seg.start != int64(i)*chunk {
			t.Fatalf("chunk %d: got %+v", i, seg)
		}
		for {
			_, keep, ok := p.beginWrite(seg, 1, chunk)
			if !ok {
				break
			}
			done, _, _ := p.commitWrite(seg, 1, keep, now)
			if done {
				break
			}
		}
	}
	// Now prefix is 0 and nextFrontier is 96 MiB == window: next assign MUST
	// split seg0 (the lowest segment holding back the window), NOT expand past 96 MiB!
	stolen, more := p.assign(2, now)
	if !more || stolen == nil {
		t.Fatal("expected worker 2 to split seg0 when bounded window is full")
	}
	if stolen.start != chunk/2 || stolen.end != chunk {
		t.Fatalf("expected split of seg0 [%d, %d), got [%d, %d)", chunk/2, chunk, stolen.start, stolen.end)
	}
}

func TestSlowConnectionTrackerYardstickAndCooldown(t *testing.T) {
	origWindow, origMinRem, origCooldown := slowEvalWindow, slowCutMinRemainingSec, slowCutCooldown
	slowEvalWindow = 2 * time.Second
	slowCutMinRemainingSec = 4.0
	slowCutCooldown = 8 * time.Second
	defer func() {
		slowEvalWindow, slowCutMinRemainingSec, slowCutCooldown = origWindow, origMinRem, origCooldown
	}()

	t0 := time.Now()
	tr := newSlowConnectionTracker(t0, 0)

	// Establish fast baseline: 1 connection at 10 MB/s, aggregate 20 MB/s across 2 connections.
	tr.recordFastCompletion(10*1024*1024, time.Second)
	t1 := t0.Add(2 * time.Second)
	if tr.shouldCut(10*1024*1024, 50*1024*1024, 2, time.Time{}, 40*1024*1024, t1) {
		t.Fatal("fast connection should not be cut")
	}

	// Slow connection at 0.5 MB/s (< 10/4 = 2.5 MB/s) with 20 MB left (40s > 4s) -> MUST cut.
	t2 := t1.Add(2 * time.Second)
	if !tr.shouldCut(512*1024, 20*1024*1024, 2, time.Time{}, 60*1024*1024, t2) {
		t.Fatal("slow connection below yardstick/4 with plenty of work left should be cut")
	}

	// Same slow rate inside cooldown (3s < 8s) -> MUST NOT cut.
	if tr.shouldCut(512*1024, 20*1024*1024, 2, t2, 65*1024*1024, t2.Add(3*time.Second)) {
		t.Fatal("cooldown should suppress repeat slow cut")
	}

	// Nearly done segment (1 MB left at 512 KB/s = 2s <= 4s) -> MUST NOT cut.
	if tr.shouldCut(512*1024, 1*1024*1024, 2, time.Time{}, 70*1024*1024, t2.Add(10*time.Second)) {
		t.Fatal("segment with <= 4s of work remaining should not be cut")
	}

	// Saturated link test (MDM gotcha #2): 8 connections sharing 20 MB/s total ->
	// per-conn aggregate = 2.5 MB/s, yardstick = min(10, 2.5) = 2.5 MB/s, threshold = 0.625 MB/s.
	// Every connection running at 2.0 MB/s must NOT be cut!
	if tr.shouldCut(2*1024*1024, 50*1024*1024, 8, time.Time{}, 80*1024*1024, t2.Add(12*time.Second)) {
		t.Fatal("saturated link where each connection gets its fair share must not be cut")
	}
}

func TestHostConnectionLimitsRequiresTwoObservationsAndExpires(t *testing.T) {
	hl := newHostConnectionLimits()
	now := time.Now()
	u := "https://dn721908.ca.archive.org/0/items/foo/bar.zip"

	if got := defaultHostCeiling(u, 8); got != 8 {
		t.Fatalf("archive.org ceiling = %d, want 8", got)
	}
	if got := defaultHostCeiling("https://huggingface.co/datasets/x/y.7z", 8); got != 4 {
		t.Fatalf("huggingface ceiling = %d, want 4", got)
	}

	// 1st refusal does not yet apply a cap (MDM gotcha #3).
	if _, learned := hl.recordRefusal(u, 3, now); learned {
		t.Fatal("first refusal alone should not lock in a host limit")
	}
	if got := hl.effectiveLimit(u, 8, now); got != 8 {
		t.Fatalf("effectiveLimit after 1 refusal = %d, want 8", got)
	}

	// 2nd refusal while 3 connections are receiving -> caps to 3.
	capVal, learned := hl.recordRefusal(u, 3, now.Add(5*time.Second))
	if !learned || capVal != 3 {
		t.Fatalf("expected learned cap 3, got learned=%v cap=%d", learned, capVal)
	}
	if got := hl.effectiveLimit(u, 8, now.Add(10*time.Second)); got != 3 {
		t.Fatalf("effectiveLimit = %d, want 3", got)
	}

	// After TTL (10 min), cap expires.
	if got := hl.effectiveLimit(u, 8, now.Add(hostLimitTTL+time.Minute)); got != 8 {
		t.Fatalf("expired cap should restore base limit 8, got %d", got)
	}
}

func TestPlannerPendingStealDoesNotPingPongIndefinitely(t *testing.T) {
	p := newSegmentPlanner(plannerConfig{
		totalSize:         1024,
		workers:           3,
		minSplit:          0, // disable split to isolate Step 3 steal behavior
		stealPendingAfter: 5 * time.Second,
	}, nil)

	t0 := time.Now()
	seg, _ := p.assign(0, t0)
	if seg == nil || seg.owner != 0 {
		t.Fatalf("expected worker 0 to own segment, got %+v", seg)
	}

	// 1st steal at +5s succeeds.
	stolen1, _ := p.assign(1, t0.Add(5*time.Second))
	if stolen1 != seg || seg.owner != 1 {
		t.Fatalf("expected 1st steal at +5s by worker 1, got %+v", stolen1)
	}

	// At +5s after 1st steal (+10s total), doubled threshold requires 10s -> must NOT steal yet!
	if premature, _ := p.assign(2, t0.Add(10*time.Second)); premature != nil {
		t.Fatal("2nd steal must wait for doubled threshold (10s), not 5s")
	}

	// At +10s after 1st steal (+15s total), 2nd steal succeeds.
	stolen2, _ := p.assign(2, t0.Add(15*time.Second))
	if stolen2 != seg || seg.owner != 2 {
		t.Fatalf("expected 2nd steal at +15s by worker 2, got %+v", stolen2)
	}

	// After maxStealsPerSegment (2), even +60s later no further steal occurs (prevents ping-pong).
	if pingPong, _ := p.assign(0, t0.Add(75*time.Second)); pingPong != nil {
		t.Fatal("segment exceeded maxStealsPerSegment and must not ping-pong forever")
	}
}

func TestPlannerBoundedWindowPreservedOnExFATResume(t *testing.T) {
	const (
		chunk     int64 = 16 * 1024 * 1024
		totalSize int64 = 256 * 1024 * 1024
	)
	resumed := []resumeRange{
		{Start: 0, Cursor: 32 * 1024 * 1024, End: 32 * 1024 * 1024},
		{Start: 32 * 1024 * 1024, Cursor: 32 * 1024 * 1024, End: totalSize},
	}
	p := newSegmentPlanner(plannerConfig{
		totalSize:        totalSize,
		workers:          2,
		minSplit:         4 * 1024 * 1024,
		splitAlign:       defaultSplitAlignBytes,
		boundedWindow:    true,
		boundedChunkSize: chunk,
	}, resumed)

	// Next assigned range on exFAT must be bounded [32M, 48M), NOT [32M, 256M)!
	seg, more := p.assign(0, time.Now())
	if !more || seg == nil {
		t.Fatal("expected segment after exFAT resume")
	}
	if seg.start != 32*1024*1024 || seg.end != 48*1024*1024 {
		t.Fatalf("exFAT resume lost bounded window: got [%d, %d), want [%d, %d)",
			seg.start, seg.end, 32*1024*1024, 48*1024*1024)
	}
}
