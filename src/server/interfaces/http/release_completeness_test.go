// release_completeness_test.go — a disc whose release cannot be assembled in full must not
// reach the user as simply done. Grand Theft Auto V arrived with only its playable disc and
// the queue reported success, so the game did not boot and nothing said why.
package http

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"godsend/app"
	"godsend/models"
	"godsend/services/local"
)

func newCompletenessDeps(t *testing.T) *Deps {
	t.Helper()
	a := &app.App{ToolsDir: t.TempDir(), TempDir: t.TempDir()}
	if err := a.SetupPaths(); err != nil {
		t.Fatalf("SetupPaths: %v", err)
	}
	return &Deps{App: a}
}

func warningFor(d *Deps, game string) string {
	if v, ok := d.App.IncompleteRelease.Load(game); ok {
		s, _ := v.(string)
		return s
	}
	return ""
}

func TestLoneSecondDiscIsMarkedIncomplete(t *testing.T) {
	d := newCompletenessDeps(t)
	game := "Alien - Isolation (USA) (En,Fr,De,Es,It,Pt,Pl,Ru) (Disc 2)"

	// No sibling in any catalog: FindCompanionDiscs returns the game alone.
	d.recordReleaseCompleteness(game, []string{game})

	warning := warningFor(d, game)
	if warning == "" {
		t.Fatal("um Disc 2 sozinho tem de ser marcado como incompleto")
	}
	if !strings.Contains(warning, "disco 1") {
		t.Errorf("o aviso tem de nomear o disco que falta, obtido %q", warning)
	}
}

func TestLoneFirstDiscIsMarkedIncomplete(t *testing.T) {
	// A catalog row labelled "Disc 1" is never a one-disc release, so a lone Disc 1 is just as
	// incomplete as a lone Disc 2 — the play disc simply is not there.
	d := newCompletenessDeps(t)
	game := "Call of Duty - Ghosts (France) (Disc 1) (Disque de Jeu)"

	d.recordReleaseCompleteness(game, []string{game})

	if w := warningFor(d, game); !strings.Contains(w, "disco 2") {
		t.Errorf("Disc 1 sozinho: esperado aviso citando o disco 2, obtido %q", w)
	}
}

func TestCompleteReleaseIsNotMarked(t *testing.T) {
	d := newCompletenessDeps(t)
	discs := []string{
		"Grand Theft Auto 5 [RF][DVD1]",
		"Grand Theft Auto 5 [RF][DVD2]",
	}

	d.recordReleaseCompleteness(discs[1], discs)

	for _, g := range discs {
		if w := warningFor(d, g); w != "" {
			t.Errorf("lançamento completo não pode ser marcado: %q -> %q", g, w)
		}
	}
}

func TestSingleDiscGameIsNeverMarked(t *testing.T) {
	d := newCompletenessDeps(t)
	game := "Halo 3 (USA)"

	d.recordReleaseCompleteness(game, []string{game})

	if w := warningFor(d, game); w != "" {
		t.Errorf("jogo de um disco só não é multidisco: %q", w)
	}
}

func TestGapInTheMiddleIsReported(t *testing.T) {
	d := newCompletenessDeps(t)
	discs := []string{
		"Lost Odyssey (USA) (Disc 1)",
		"Lost Odyssey (USA) (Disc 3)",
		"Lost Odyssey (USA) (Disc 4)",
	}

	d.recordReleaseCompleteness(discs[0], discs)

	w := warningFor(d, discs[0])
	if !strings.Contains(w, "disco 2") {
		t.Errorf("o buraco no meio da numeração tem de aparecer: %q", w)
	}
	// Every disc of the release carries the warning, whichever one the user queued.
	if warningFor(d, discs[2]) == "" {
		t.Error("os discos companheiros também têm de ser marcados")
	}
}

func TestIncompleteWarningReachesTheDeliveryMessage(t *testing.T) {
	// LogStatus is the single funnel every pipeline reports through, so attaching the warning
	// there is what makes it impossible for a delivery path to omit it.
	d := newCompletenessDeps(t)
	game := "Battlefield 4 (Japan) (Disc 2)"
	d.recordReleaseCompleteness(game, []string{game})

	d.App.LogStatus(game, "Ready", "Gravado no dispositivo!")

	value, ok := d.App.JobQueue.Load(game)
	if !ok {
		t.Fatal("job não entrou na fila")
	}
	status := value.(models.GameStatus)
	if !strings.Contains(status.Message, "faltou o disco") {
		t.Errorf("a mensagem de entrega tem de carregar o aviso, obtida %q", status.Message)
	}
	if status.State != "Ready" {
		t.Errorf("o estado não muda, obtido %q", status.State)
	}
}

func TestProgressMessagesAreNotDecorated(t *testing.T) {
	d := newCompletenessDeps(t)
	game := "Battlefield 4 (Japan) (Disc 2)"
	d.recordReleaseCompleteness(game, []string{game})

	d.App.LogStatus(game, "Processing", "Baixando...")

	value, _ := d.App.JobQueue.Load(game)
	if msg := value.(models.GameStatus).Message; msg != "Baixando..." {
		t.Errorf("mensagem de progresso foi alterada: %q", msg)
	}
}

// TestBrowseReleasesGroupsTheSameDiscsTheQueueEnqueues is the reason /browse/releases exists.
// The browse view used to group discs with its own parser, which had drifted from this one, so
// it offered "(Disc 1) (Install)" and "(Disc 2) (Play)" as two separate one-disc versions of
// Grand Theft Auto V and downloading either delivered half the release. The endpoint has to
// return exactly what FindCompanionDiscs would enqueue — no more, and no fewer.
func TestBrowseReleasesGroupsTheSameDiscsTheQueueEnqueues(t *testing.T) {
	d := newCompletenessDeps(t)
	d.Local = &local.Service{App: d.App}
	catalog := []string{
		"Grand Theft Auto V (World) (En,Fr) (Disc 1) (Install)",
		"Grand Theft Auto V (World) (En,Fr) (Disc 2) (Play)",
		"Alien - Isolation (USA) (En,Fr) (Disc 2)",
		"Halo 3 (USA)",
		// A release whose rows carry NO disc number at all. FindCompanionDiscs matches on the
		// release title alone, so /trigger fetches both; the endpoint has to show both.
		"Call of Duty - Advanced Warfare (USA, Europe) (En,Fr) (Game Disc)",
		"Call of Duty - Advanced Warfare (USA, Europe) (En,Fr) (Install Disc)",
		// A tagged release that also has an untagged row under the same title: /trigger
		// enqueues three, so the view must not promise two.
		"Dragon's Dogma - Dark Arisen (World) (En,Ja) (Disc 1) (Game Disc)",
		"Dragon's Dogma - Dark Arisen (World) (En,Ja) (Disc 2) (Install Disc)",
		"Dragon's Dogma - Dark Arisen (World) (En,Ja) (Game Disc)",
	}
	d.App.IAGameCacheMu.Lock()
	d.App.IAGameCache = map[string][]string{"xbox360": catalog}
	d.App.IAGameCacheMu.Unlock()

	rec := httptest.NewRecorder()
	d.handleBrowseReleases(rec, httptest.NewRequest("GET", "/browse/releases?platform=xbox360", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Releases []struct {
			ReleaseTitle string `json:"release_title"`
			Discs        []struct {
				Name       string `json:"name"`
				DiscNumber int    `json:"disc_number"`
				Subtitle   string `json:"subtitle"`
			} `json:"discs"`
			MissingDiscs []int  `json:"missing_discs"`
			Warning      string `json:"warning"`
		} `json:"releases"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("resposta ilegível: %v", err)
	}

	// "Halo 3 (USA)" is alone under its release title and carries no disc tag, so it must not
	// appear: the view reads its absence as "one-disc game", and a release invented here would
	// put a phantom disc on screen.
	if len(payload.Releases) != 4 {
		t.Fatalf("esperados 4 lançamentos multidisco, obtidos %d: %+v", len(payload.Releases), payload.Releases)
	}

	byTitle := map[string]int{}
	for i, r := range payload.Releases {
		byTitle[r.ReleaseTitle] = i
	}

	// The invariant the endpoint exists for, checked against the queue's own function over the
	// UNFILTERED catalog: every release must list exactly the names /trigger would enqueue.
	// Comparing only the tagged rows is what let the view promise fewer discs than it delivered.
	for _, r := range payload.Releases {
		shown := make([]string, 0, len(r.Discs))
		for _, disc := range r.Discs {
			shown = append(shown, disc.Name)
		}
		enqueued := models.FindCompanionDiscs(shown[0], catalog)
		if len(shown) != len(enqueued) {
			t.Errorf("%q: a tela mostra %d disco(s) e a fila buscaria %d; tela=%v fila=%v",
				r.ReleaseTitle, len(shown), len(enqueued), shown, enqueued)
			continue
		}
		for i := range shown {
			if shown[i] != enqueued[i] {
				t.Errorf("%q: disco %d diverge; tela=%q fila=%q", r.ReleaseTitle, i, shown[i], enqueued[i])
			}
		}
	}

	// The role label is what tells two discs of one release apart on screen. Without it the
	// panel prints the same truncated catalog name twice.
	if idx, ok := byTitle["Call of Duty - Advanced Warfare (USA, Europe) (En,Fr)"]; !ok {
		t.Errorf("release sem número de disco nenhum não agrupou: %+v", payload.Releases)
	} else if cod := payload.Releases[idx]; len(cod.Discs) != 2 {
		t.Errorf("Advanced Warfare: esperados 2 discos, obtido %+v", cod.Discs)
	} else if cod.Discs[0].Subtitle == "" || cod.Discs[0].Subtitle == cod.Discs[1].Subtitle {
		t.Errorf("os dois discos precisam de rótulos distintos, obtidos %q e %q",
			cod.Discs[0].Subtitle, cod.Discs[1].Subtitle)
	}
	gtaIdx, ok := byTitle["Grand Theft Auto V (World) (En,Fr)"]
	if !ok {
		t.Fatalf("os dois discos do GTA V não agruparam num lançamento só: %+v", payload.Releases)
	}
	gta := payload.Releases[gtaIdx]
	if len(gta.Discs) != 2 || gta.Discs[0].DiscNumber != 1 || gta.Discs[1].DiscNumber != 2 {
		t.Errorf("GTA V: esperados os discos 1 e 2 em ordem, obtido %+v", gta.Discs)
	}
	if len(gta.MissingDiscs) != 0 || gta.Warning != "" {
		t.Errorf("lançamento completo não pode carregar aviso: faltando=%v aviso=%q", gta.MissingDiscs, gta.Warning)
	}

	alienIdx, ok := byTitle["Alien - Isolation (USA) (En,Fr)"]
	if !ok {
		t.Fatalf("o Disc 2 sozinho sumiu da resposta: %+v", payload.Releases)
	}
	alien := payload.Releases[alienIdx]
	if len(alien.MissingDiscs) != 1 || alien.MissingDiscs[0] != 1 {
		t.Errorf("Disc 2 sozinho: esperado faltando=[1], obtido %v", alien.MissingDiscs)
	}
	// The same sentence the delivery message carries: the user who confirms it before the
	// download must not be told something different when the job finishes.
	if alien.Warning == "" || !strings.Contains(alien.Warning, "disco 1") {
		t.Errorf("o aviso tem de nomear o disco que falta, obtido %q", alien.Warning)
	}
	d.recordReleaseCompleteness(catalog[2], []string{catalog[2]})
	if got := warningFor(d, catalog[2]); got != alien.Warning {
		t.Errorf("aviso do browse difere do da entrega:\n  browse:  %q\n  entrega: %q", alien.Warning, got)
	}
}

// TestBrowseReleasesRejectsMissingPlatform keeps the endpoint from answering with the grouping
// of an empty catalog, which the view would read as "every game has one disc".
func TestBrowseReleasesRejectsMissingPlatform(t *testing.T) {
	d := newCompletenessDeps(t)
	rec := httptest.NewRecorder()
	d.handleBrowseReleases(rec, httptest.NewRequest("GET", "/browse/releases", nil))
	if rec.Code != 400 {
		t.Fatalf("esperado 400 sem platform, obtido %d", rec.Code)
	}
}
