// browse_unified_test.go — o Catalogo Online lista um titulo uma vez so, e o nome listado e o
// que /trigger recebe. Listar "(Japan)" com a release americana no mesmo catalogo fazia o
// fallback inteiro baixar a versao japonesa.
package http

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUnifiedBrowseListsTheEnglishRelease(t *testing.T) {
	d := newCompletenessDeps(t)
	d.App.IAGameCacheMu.Lock()
	d.App.IAGameCache = map[string][]string{
		// O HuggingFace vem primeiro na prioridade: o titulo e dele. A variante do
		// Internet Archive ganharia no PreferVariant (tem regiao, o nome do HF nao) e
		// mesmo assim nao pode tomar o lugar — o nome listado e o que o HF serve.
		"hf_xbox360": {"X-Men Destiny"},
		"xbox360": {
			"Assassin's Creed (Japan)",
			"Assassin's Creed (USA, Europe) (En,Fr,De,Es,It)",
			"Battlefield 4 (Japan) (Disc 1)",
			"Battlefield 4 (Japan) (Disc 2)",
			"Battlefield 4 (USA, Europe) (En,Fr) (Disc 1)",
			"Battlefield 4 (USA, Europe) (En,Fr) (Disc 2)",
			"X-Men - Destiny (USA, Europe)",
		},
	}
	d.App.IAGameCacheMu.Unlock()

	rec := httptest.NewRecorder()
	d.handleBrowse(rec, httptest.NewRequest("GET", "/browse?platform=xbox360&source=unified&priority=huggingface,ia", nil))

	want := strings.Join([]string{
		"X-Men Destiny",
		"Assassin's Creed (USA, Europe) (En,Fr,De,Es,It)",
		"Battlefield 4 (USA, Europe) (En,Fr) (Disc 1)",
		"Battlefield 4 (USA, Europe) (En,Fr) (Disc 2)",
	}, "|")
	if got := rec.Body.String(); got != want {
		t.Fatalf("listagem unificada:\n got %q\nwant %q", got, want)
	}
}
