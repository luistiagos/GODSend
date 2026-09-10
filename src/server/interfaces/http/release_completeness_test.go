// release_completeness_test.go — a disc whose release cannot be assembled in full must not
// reach the user as simply done. Grand Theft Auto V arrived with only its playable disc and
// the queue reported success, so the game did not boot and nothing said why.
package http

import (
	"strings"
	"testing"

	"godsend/app"
	"godsend/models"
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
