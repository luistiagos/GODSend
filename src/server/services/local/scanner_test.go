package local

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeTitleLookup replaces the network lookup for one test and counts calls per TitleID.
func fakeTitleLookup(t *testing.T, delay time.Duration, names map[string]string) *sync.Map {
	t.Helper()
	calls := &sync.Map{}
	prev := lookupTitleName
	lookupTitleName = func(id string) string {
		n, _ := calls.LoadOrStore(id, new(int32))
		atomic.AddInt32(n.(*int32), 1)
		time.Sleep(delay)
		return names[id]
	}
	resolvedTitleNames = sync.Map{}
	t.Cleanup(func() {
		lookupTitleName = prev
		resolvedTitleNames = sync.Map{}
	})
	return calls
}

func callCount(calls *sync.Map, id string) int32 {
	n, ok := calls.Load(id)
	if !ok {
		return 0
	}
	return atomic.LoadInt32(n.(*int32))
}

// A drive used on a console has a TitleID folder per game and per system app. Looked up one by
// one, at up to 20 s each, /browse/releases went past the 120 s IPC timeout and every game's
// download button stayed on "Verificando os discos deste jogo…".
func TestResolveTitleNamesLooksUpInParallel(t *testing.T) {
	ids := []string{"FFFE07D1", "FFFE07DF", "584E07D1", "FFFF0055", "4D5307E6", "545107FC", "41560817", "4D530919"}
	names := map[string]string{}
	for _, id := range ids {
		names[id] = "Game " + id
	}
	fakeTitleLookup(t, 300*time.Millisecond, names)

	start := time.Now()
	got := resolveTitleNames(ids)
	if elapsed := time.Since(start); elapsed > 1200*time.Millisecond {
		t.Fatalf("8 lookups of 300 ms took %v; one by one would be 2.4 s", elapsed)
	}
	for _, id := range ids {
		if got[id] != names[id] {
			t.Errorf("%s: got %q, want %q", id, got[id], names[id])
		}
	}
}

func TestResolveTitleNamesRemembersHitsAndRetriesMisses(t *testing.T) {
	calls := fakeTitleLookup(t, 0, map[string]string{"4D5307E6": "Halo 3"})
	ids := []string{"4D5307E6", "10102001", "4D5307E6"}

	for i := 0; i < 2; i++ {
		got := resolveTitleNames(ids)
		if got["4D5307E6"] != "Halo 3" || got["10102001"] != "" {
			t.Fatalf("scan %d: got %v", i, got)
		}
	}
	if n := callCount(calls, "4D5307E6"); n != 1 {
		t.Errorf("resolved TitleID looked up %d times, want 1", n)
	}
	if n := callCount(calls, "10102001"); n != 2 {
		t.Errorf("unresolved TitleID looked up %d times, want 2 (once per scan)", n)
	}
}
