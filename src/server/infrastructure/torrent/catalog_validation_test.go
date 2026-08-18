package torrent

import "testing"

func TestTorrentBasenameMatchesMinervaRepresentations(t *testing.T) {
	tests := []struct {
		torrent string
		entry   string
	}{
		{"Batman - Arkham City (USA) (Disc 1).zip", "Batman - Arkham City (USA) (Disc 1).zip"},
		{"Adventure Time - I Don't Know!.zip", "Adventure Time - I Don&#39;t Know!.zip"},
		{"Game Name.7z", "Game Name.zip"},
	}
	for _, test := range tests {
		if !torrentBasenameMatches(test.torrent, test.entry) {
			t.Errorf("expected %q to match %q", test.torrent, test.entry)
		}
	}
	if torrentBasenameMatches("Different Game.zip", "Game Name.zip") {
		t.Fatal("different torrent entries matched")
	}
}
