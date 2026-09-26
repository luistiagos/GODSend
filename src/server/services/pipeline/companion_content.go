// companion_content.go — deliver the whole release when a XEX rip carries more than one disc.
package pipeline

import (
	"errors"
	"fmt"
	"io"
	"net/textproto"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"godsend/infrastructure/helpers"
	"godsend/models"
	"godsend/utils"

	goftp "github.com/jlaffaye/ftp"
)

// xexDestinationName picks the folder an extracted XEX rip is installed under. The rip's own
// top-level folder normally names the game, but a multi-disc rip names it after the disc, so
// Grand Theft Auto V arrived on the console as a game called "Disc2". The release title
// replaces such a placeholder; every other rip keeps the name it shipped with.
func xexDestinationName(xexFolder, archiveFolder, gameName string) string {
	name := archiveFolder
	if helpers.IsGenericDiscFolderName(name) {
		if release := helpers.SanitizeFilename(models.ExtractReleaseTitle(gameName)); release != "" {
			name = release
		}
	}
	return helpers.XEXFolderName(xexFolder, name)
}

// installCompanionDiscContent writes the install-disc payloads that shipped in the same
// archive as the playable folder. A scene rip of a two-disc release packs the whole release
// together, and the XEX paths install only the folder holding default.xex — so without this
// the install disc that Grand Theft Auto V, Metal Gear Solid V or Forza Motorsport 3 need in
// order to boot went to the scratch cleanup, and the console got a game that cannot start.
//
// The payload is written before the playable folder: a failure here must stop the job while
// the provider fallback can still look for a release that fits the destination, instead of
// leaving a half-installed game reported as ready.
//
// When gameFolder is a playable disc, the title's mandatory install content is then required
// on the destination (requireInstallContent). gameFolder is not always one: the content path
// passes the install disc's own package folder, and demanding the install content from the
// delivery that provides it would make the install disc impossible to install.
func (s *Service) installCompanionDiscContent(gameName, extDir, gameFolder string, xboxConn *models.XboxConnection) error {
	payloads := helpers.FindCompanionContentPayloads(extDir, gameFolder)
	if len(payloads) > 0 {
		s.App.Logf("MULTI-DISC [%s]: %d payload(s) de disco de instalação encontrados junto da pasta jogável %s",
			gameName, len(payloads), filepath.Base(gameFolder))
	}

	var delivered []helpers.CompanionContent
	for i, payload := range payloads {
		mandatory, problem := mandatoryPayloadProblem(payload)
		if problem != "" {
			// Writing an incomplete set would overwrite an install the destination may already
			// hold in full; requireInstallContent decides whether the game can still go.
			s.App.Logf("MULTI-DISC [%s]: disco de instalação %s/%s ignorado — %s",
				gameName, payload.TitleID, payload.TypeDir, problem)
			continue
		}
		if mandatory && containsInstallSet(delivered, payload.TitleID, payload.TypeDir) {
			// A rip can carry the same install tree twice — the disc's own and an "hdd1" copy —
			// and each copy of GTA V's is about 8 GB.
			s.App.Logf("MULTI-DISC [%s]: cópia repetida do disco de instalação %s/%s ignorada (%s)",
				gameName, payload.TitleID, payload.TypeDir, payload.Dir)
			continue
		}
		s.App.LogStatus(gameName, "Processing", fmt.Sprintf("Gravando disco de instalação %d/%d (TitleID %s)...",
			i+1, len(payloads), payload.TitleID))
		s.App.Logf("MULTI-DISC [%s]: %s -> Content/0000000000000000/%s/%s",
			gameName, payload.Dir, payload.TitleID, payload.TypeDir)

		switch {
		case xboxConn != nil && xboxConn.Mode == "ftp":
			// No pending-FTP fallback here: the payload lives inside the extraction scratch,
			// which is removed when this job returns, so a retry would find no source.
			if err := s.FTP.TransferContent(payload.Dir, xboxConn, gameName, payload.TitleID, payload.TypeDir); err != nil {
				return fmt.Errorf("transferir disco de instalação (TitleID %s): %w", payload.TitleID, err)
			}
			delivered = append(delivered, payload)
		case xboxConn != nil && xboxConn.Mode == "local":
			if err := s.InstallContentLocal(payload.Dir, xboxConn.LocalRoot, gameName, payload.TitleID, payload.TypeDir); err != nil {
				return fmt.Errorf("gravar disco de instalação (TitleID %s): %w", payload.TitleID, err)
			}
			delivered = append(delivered, payload)
		default:
			// No destination was registered, so the job only packages the playable folder for
			// a manual install. The manifest carries a single type, and a XEX manifest has
			// nowhere to name a content destination.
			s.App.Logf("MULTI-DISC [%s]: sem destino registrado — o disco de instalação %s/%s não entra no pacote manual",
				gameName, payload.TitleID, payload.TypeDir)
		}
	}
	if titleID := playableTitleID(gameFolder); titleID != 0 {
		return s.requireInstallContent(gameName, titleID, xboxConn, delivered)
	}
	return nil
}

// mandatoryPayloadProblem reports whether a payload is a title's mandatory install set and,
// if so, why it cannot be written — "" for a complete set.
func mandatoryPayloadProblem(payload helpers.CompanionContent) (mandatory bool, problem string) {
	titleID, err := strconv.ParseUint(payload.TitleID, 16, 32)
	if err != nil {
		return false, ""
	}
	spec, ok := models.RequiresMandatoryInstallDisc(uint32(titleID))
	if !ok || !strings.EqualFold(payload.TypeDir, spec.TypeDir()) {
		return false, ""
	}
	return true, helpers.InstallSetProblem(spec.TitleIDHex(), spec.ContentType, spec.Packages, helpers.LocalPackageProbe(payload.Dir))
}

func containsInstallSet(payloads []helpers.CompanionContent, titleID, typeDir string) bool {
	for _, payload := range payloads {
		if strings.EqualFold(payload.TitleID, titleID) && strings.EqualFold(payload.TypeDir, typeDir) {
			return true
		}
	}
	return false
}

// playableTitleID is the Title ID of the game in dir when dir holds a playable disc — a XEX
// folder or a GOD package — and 0 for anything else, such as an install disc's package folder.
func playableTitleID(dir string) uint32 {
	if dir == "" {
		return 0
	}
	titleID := ""
	if entries, err := os.ReadDir(dir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.EqualFold(entry.Name(), "default.xex") {
				titleID, _ = utils.ExtractTitleIDFromFile(filepath.Join(dir, entry.Name()))
				break
			}
		}
	}
	if titleID == "" {
		titleID, _, _ = helpers.DetectGodStructure(dir)
	}
	parsed, err := strconv.ParseUint(titleID, 16, 32)
	if err != nil {
		return 0
	}
	return uint32(parsed)
}

// requireInstallContentForISO applies requireInstallContent to an ISO about to be delivered as
// the playable game. The Title ID comes from the disc's executable, never from the catalog
// name: a name only guesses, and the guess once filed Grand Theft Auto IV under GTA V.
func (s *Service) requireInstallContentForISO(gameName, isoPath string, xboxConn *models.XboxConnection) error {
	info, err := utils.ProbeISODiscInfo(isoPath)
	if err != nil || info == nil {
		return nil
	}
	return s.requireInstallContent(gameName, info.TitleID, xboxConn, nil)
}

// requireInstallContent holds back the playable disc of a title that cannot boot without its
// install disc until the destination holds that disc's whole package set. The console reports
// nothing when the content is missing: Grand Theft Auto V stops on its loading screen for
// good, so a delivery reported as ready was the first sign of the problem the user got.
//
// A set this job has just written (delivered) counts without reading it back: it was checked
// package by package before the write, and the write reported success. Otherwise the
// destination is read. Only a destination that was read and found short fails the job. One
// that cannot be read — no destination, a console that does not answer — says nothing about
// the content, and a sibling job still due to write the install disc will supply it; both
// deliver with a warning.
func (s *Service) requireInstallContent(gameName string, titleID uint32, xboxConn *models.XboxConnection, delivered []helpers.CompanionContent) error {
	spec, ok := models.RequiresMandatoryInstallDisc(titleID)
	if !ok {
		return nil
	}
	where := fmt.Sprintf("Content/0000000000000000/%s/%s", spec.TitleIDHex(), spec.TypeDir())
	if containsInstallSet(delivered, spec.TitleIDHex(), spec.TypeDir()) {
		s.App.Logf("MULTI-DISC [%s]: conteúdo de instalação do Disco %d gravado neste job (%s)", gameName, spec.DiscNumber, where)
		s.App.IncompleteRelease.Delete(gameName)
		return nil
	}
	problem, checked := s.destinationInstallContentProblem(xboxConn, spec)
	if checked && problem == "" {
		s.App.Logf("MULTI-DISC [%s]: conteúdo de instalação do Disco %d conferido no destino (%s)", gameName, spec.DiscNumber, where)
		s.App.IncompleteRelease.Delete(gameName)
		return nil
	}

	warning := ""
	switch sibling := s.pendingInstallDiscJob(gameName, spec.DiscNumber); {
	case xboxConn == nil:
		warning = fmt.Sprintf("ATENCAO: este jogo so inicia com o conteudo de instalacao do Disco %d em %s, que o pacote manual nao inclui.", spec.DiscNumber, where)
	case sibling != "":
		warning = fmt.Sprintf("ATENCAO: o conteudo de instalacao do Disco %d ainda sera gravado pela tarefa %q; o jogo so inicia depois que ela terminar.", spec.DiscNumber, sibling)
	case !checked:
		warning = fmt.Sprintf("ATENCAO: nao foi possivel conferir no destino o conteudo de instalacao do Disco %d (%s); sem ele o jogo nao inicia.", spec.DiscNumber, where)
	default:
		return fmt.Errorf("release incompleta: %s exige o conteudo de instalacao do Disco %d em %s, que nao veio no arquivo baixado nem esta no destino (%s)",
			gameName, spec.DiscNumber, where, problem)
	}
	s.App.Logf("MULTI-DISC [%s]: %s", gameName, warning)
	s.App.IncompleteRelease.Store(gameName, warning)
	return nil
}

// destinationInstallContentProblem checks the install set on the destination. checked is
// false when the destination could not be read at all, which is not the same as the content
// being absent.
func (s *Service) destinationInstallContentProblem(xboxConn *models.XboxConnection, spec models.MandatoryInstallDiscInfo) (problem string, checked bool) {
	if xboxConn == nil {
		return "", false
	}
	switch xboxConn.Mode {
	case "local":
		// An unplugged drive has to reach the local-device handling of the delivery, not be
		// reported as a release without its install disc.
		if xboxConn.LocalRoot == "" {
			return "", false
		}
		if _, err := os.Stat(xboxConn.LocalRoot); err != nil {
			return "", false
		}
		// Another drive mounted at the same letter is not the destination; the delivery waits
		// for the right one (waitForLocalDevice), and its content says nothing about this one.
		if xboxConn.LocalDeviceID != "" && !localDeviceMatches(xboxConn.LocalRoot, xboxConn.LocalDeviceID) {
			return "", false
		}
		dir := filepath.Join(xboxConn.LocalRoot, "Content", "0000000000000000", spec.TitleIDHex(), spec.TypeDir())
		return helpers.InstallSetProblem(spec.TitleIDHex(), spec.ContentType, spec.Packages, helpers.LocalPackageProbe(dir)), true
	case "ftp":
		if s.FTP == nil || xboxConn.IP == "" {
			return "", false
		}
		// One attempt: the delivery that follows retries on its own and falls back to the
		// pending-FTP queue, and three timeouts here would only delay that.
		fc, err := s.FTP.ConnectToXboxFTP(xboxConn.IP)
		if err != nil {
			return "", false
		}
		// After a timeout this also unblocks the abandoned check and frees the console for the
		// delivery, the way the callers of listWithTimeout (services/content) recover.
		defer s.FTP.QuitConn(fc)
		dir := fmt.Sprintf("/%s/Content/0000000000000000/%s/%s", strings.TrimSuffix(xboxConn.Drive, ":"), spec.TitleIDHex(), spec.TypeDir())
		return ftpInstallSetProblemWithin(fc, dir, spec, ftpInstallCheckLimit)
	}
	return "", false
}

// Aurora's FTP server needs the handling services/content already learned: it ignores or
// refuses absolute paths in LIST and RETR, and it stalls on data channels opened back to back.
// Variables so tests can shorten them.
var (
	ftpInstallCheckLimit = 30 * time.Second
	ftpDataPause         = 150 * time.Millisecond
	ftpDataTimeout       = 8 * time.Second
)

// ftpInstallSetProblemWithin gives up on a console that stops answering. The check runs while
// the job holds the processing lane and the console's FTP slot, so a stall must not outlast it.
func ftpInstallSetProblemWithin(fc *goftp.ServerConn, dir string, spec models.MandatoryInstallDiscInfo, limit time.Duration) (problem string, checked bool) {
	type result struct {
		problem string
		checked bool
	}
	done := make(chan result, 1)
	go func() {
		problem, checked := ftpInstallSetProblem(fc, dir, spec)
		done <- result{problem, checked}
	}()
	select {
	case r := <-done:
		return r.problem, r.checked
	case <-time.After(limit):
		return "", false
	}
}

// ftpInstallSetProblem checks the install set in a folder on the console. Only what the server
// positively shows is a problem — a folder it says does not exist, a package missing from the
// listing, a header of another title or one declaring more bytes than the file has. A request
// it fails to answer leaves the set unchecked: that is a console in trouble, not a release
// without its install disc.
func ftpInstallSetProblem(fc *goftp.ServerConn, dir string, spec models.MandatoryInstallDiscInfo) (problem string, checked bool) {
	if err := fc.ChangeDir(dir); err != nil {
		var reply *textproto.Error
		if errors.As(err, &reply) && reply.Code == goftp.StatusFileUnavailable {
			return helpers.InstallSetProblem(spec.TitleIDHex(), spec.ContentType, spec.Packages, absentPackage), true
		}
		return "", false
	}
	entries, err := fc.List("")
	if err != nil {
		return "", false
	}
	listed := make(map[string]*goftp.Entry, len(spec.Packages))
	var missing []string
	for _, name := range spec.Packages {
		for _, entry := range entries {
			if entry.Type != goftp.EntryTypeFolder && strings.EqualFold(entry.Name, name) {
				listed[name] = entry
				break
			}
		}
		if listed[name] == nil {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		return helpers.InstallSetProblem(spec.TitleIDHex(), spec.ContentType, missing, absentPackage), true
	}
	heads := make(map[string][]byte, len(listed))
	for _, name := range spec.Packages {
		time.Sleep(ftpDataPause)
		head := readFTPHead(fc, listed[name].Name, helpers.InstallPackageHeaderLen)
		if head == nil {
			return "", false
		}
		heads[name] = head
	}
	return helpers.InstallSetProblem(spec.TitleIDHex(), spec.ContentType, spec.Packages, func(name string) ([]byte, int64, bool) {
		return heads[name], int64(listed[name].Size), true
	}), true
}

func absentPackage(string) ([]byte, int64, bool) { return nil, 0, false }

// readFTPHead returns the first n bytes of a file in the current folder, or nil when they
// cannot be read in time.
func readFTPHead(fc *goftp.ServerConn, name string, n int) []byte {
	r, err := fc.Retr(name)
	if err != nil {
		return nil
	}
	defer r.Close()
	_ = r.SetDeadline(time.Now().Add(ftpDataTimeout))
	head := make([]byte, n)
	if _, err := io.ReadFull(r, head); err != nil {
		return nil
	}
	return head
}

// pendingInstallDiscJob names a queued job for the install disc of gameName's release. Each
// disc of a Redump release is its own job, and the jobs run in no fixed order, so the playable
// disc can come first; the install disc then still writes its content afterwards.
func (s *Service) pendingInstallDiscJob(gameName string, discNumber byte) string {
	release := models.ExtractReleaseTitle(gameName)
	found := ""
	s.App.JobQueue.Range(func(key, value any) bool {
		name, _ := key.(string)
		status, _ := value.(models.GameStatus)
		if name == gameName {
			return true
		}
		if _, suppressed := s.App.SuppressedJobs.Load(name); suppressed {
			return true
		}
		info := models.ExtractDiscInfo(name)
		if info.DiscNumber != discNumber || !strings.EqualFold(info.ReleaseTitle, release) {
			return true
		}
		switch status.State {
		case "Queued", "Processing", "Pending FTP":
			found = name
			return false
		}
		return true
	})
	return found
}
