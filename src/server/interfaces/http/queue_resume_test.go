package http

import "testing"

func TestResumePriorityPutsPartialDownloadOwnerFirst(t *testing.T) {
	// The provider ahead of the owner would fail on a catalogue miss, and the
	// scratch cleanup between providers would then delete the partial file the
	// job is resuming — so the owner has to be tried first.
	got := resumePriority("huggingface,ia,minerva", "https://archive.org/download/x/Game.iso")
	if got != "ia,huggingface,minerva" {
		t.Fatalf("IA download did not move to the front: %q", got)
	}
	got = resumePriority("huggingface,ia,minerva", "https://huggingface.co/datasets/x/Game.7z")
	if got != "huggingface,ia,minerva" {
		t.Fatalf("HuggingFace order changed unnecessarily: %q", got)
	}
	got = resumePriority("", "https://archive.org/download/x/Game.iso")
	if got != "ia,huggingface,minerva" {
		t.Fatalf("default priority was not reordered: %q", got)
	}
}

func TestResumePriorityKeptWhenOwnerIsUnknown(t *testing.T) {
	// A Minerva torrent resumes through aria2c's own control file, and a job
	// killed before its first byte has no URL at all: leave the user's order.
	for _, url := range []string{"", "magnet:?xt=urn:btih:abc"} {
		if got := resumePriority("minerva,ia", url); got != "minerva,ia" {
			t.Fatalf("priority was rewritten for %q: %q", url, got)
		}
	}
}
