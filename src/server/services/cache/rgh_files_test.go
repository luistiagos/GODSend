package cache

import (
	"testing"
)

func TestNormalizeHuggingFaceDownloadURL(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "FIFA 18 archive URL maps to direct HuggingFace CDN",
			in:   "https://archive.org/download/mx360gcpt3-x360-ztm/FIFA.18.USA.X360-ZTM.rar",
			want: "https://huggingface.co/datasets/luistiagos/rgh/resolve/main/FIFA.18.USA.X360-ZTM.rar",
		},
		{
			name: "Command and Conquer with ampersand escapes properly",
			in:   "https://archive.org/download/mx360gcpt2-x360-ztm/Command.&.Conquer.3.Kanes.Wrath.EUR.X360-ZTM.rar",
			want: "https://huggingface.co/datasets/luistiagos/rgh/resolve/main/Command.&.Conquer.3.Kanes.Wrath.EUR.X360-ZTM.rar",
		},
		{
			name: "Existing HuggingFace URL is preserved",
			in:   "https://huggingface.co/datasets/luistiagos/xbx/resolve/main/Fifa%2019%20%285.63%29.7z",
			want: "https://huggingface.co/datasets/luistiagos/xbx/resolve/main/Fifa%2019%20%285.63%29.7z",
		},
		{
			name: "Unrelated archive.org URL not in RGH set is preserved",
			in:   "https://archive.org/download/SomeOtherCollection/game.zip",
			want: "https://archive.org/download/SomeOtherCollection/game.zip",
		},
		{
			name: "Empty URL is preserved",
			in:   "",
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NormalizeHuggingFaceDownloadURL(tt.in)
			if got != tt.want {
				t.Errorf("NormalizeHuggingFaceDownloadURL(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
