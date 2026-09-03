// handlers.go — HTTP request handlers for browse, cache, trigger, status, queue, debug, and file serving.
package http

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	stdhttp "net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"godsend/app"
	"godsend/infrastructure/ftp"
	"godsend/infrastructure/helpers"
	"godsend/models"
	cacheService "godsend/services/cache"
	"godsend/services/local"
	pipelineService "godsend/services/pipeline"
	"godsend/utils"
)

func (d *Deps) handleBrowse(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	platform := r.URL.Query().Get("platform")
	source := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("source"))) // "minerva", "ia", or "" (merged)
	d.App.Logf("BROWSE: platform=%s source=%s", platform, source)

	// ROM platforms — served from edgeemu.net scrape cache
	if strings.HasPrefix(platform, "rom_") {
		sysid := strings.TrimPrefix(platform, "rom_")
		if _, ok := app.ROMSystems[sysid]; !ok {
			jsonError(w, 400, "Unknown ROM system: "+sysid)
			return
		}
		d.App.ROMGameCacheMu.RLock()
		cached := d.App.ROMGameCache[sysid]
		d.App.ROMGameCacheMu.RUnlock()
		if len(cached) > 0 {
			d.App.Logf("BROWSE: Serving %d cached ROMs for %s", len(cached), app.ROMSystems[sysid].Name)
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Write([]byte(strings.Join(cached, "|")))
			return
		}
		go d.ROM.Build(sysid)
		s := d.IA.GetBuildState(platform)
		loaded := atomic.LoadInt32(&s.Loaded)
		total := atomic.LoadInt32(&s.Total)
		if total == 0 {
			total = 1
		}
		d.App.Logf("BROWSE: ROM cache building for %s", sysid)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintf(w, "__IA_LOADING__:%d/%d", loaded, total)
		return
	}

	// Local — scan Transfer folder immediately, no IA needed
	if platform == "local" {
		games := d.Local.ScanTransferFolder()
		d.App.Logf("BROWSE: %d local ISOs found", len(games))
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte(strings.Join(games, "|")))
		return
	}

	// Source-specific browse — return only the requested source's list.
	d.App.MinervaGameCacheMu.RLock()
	minervaCached := d.App.MinervaGameCache[platform]
	d.App.MinervaGameCacheMu.RUnlock()

	d.App.IAGameCacheMu.RLock()
	iaCached := d.App.IAGameCache[platform]
	d.App.IAGameCacheMu.RUnlock()

	if source == "minerva" {
		if len(minervaCached) > 0 {
			decoded := make([]string, len(minervaCached))
			for i, g := range minervaCached {
				decoded[i] = helpers.DecodeMinervaName(g)
			}
			d.App.Logf("BROWSE: Serving %d Minerva games for %s", len(decoded), platform)
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Write([]byte(strings.Join(decoded, "|")))
			return
		}
		go d.Minerva.Build(platform)
		d.App.Logf("BROWSE: Minerva cache building for %s", platform)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintf(w, "__IA_LOADING__:0/1")
		return
	}

	if source == "ia" {
		if len(iaCached) > 0 {
			d.App.Logf("BROWSE: Serving %d IA games for %s", len(iaCached), platform)
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Write([]byte(strings.Join(iaCached, "|")))
			return
		}
		go d.IA.Build(platform)
		s := d.IA.GetBuildState(platform)
		loaded := atomic.LoadInt32(&s.Loaded)
		total := atomic.LoadInt32(&s.Total)
		if total == 0 {
			total = int32(len(app.IACollections[platform]))
		}
		d.App.Logf("BROWSE: IA cache building for %s %d/%d", platform, loaded, total)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintf(w, "__IA_LOADING__:%d/%d", loaded, total)
		return
	}

	if source == "huggingface" {
		d.App.IAGameCacheMu.RLock()
		hfCached := d.App.IAGameCache["hf_"+platform]
		d.App.IAGameCacheMu.RUnlock()

		if len(hfCached) > 0 {
			d.App.Logf("BROWSE: Serving %d HuggingFace games for %s", len(hfCached), platform)
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Write([]byte(strings.Join(hfCached, "|")))
			return
		}
		go d.HuggingFace.Build(platform)
		s := d.IA.GetBuildState("hf_" + platform)
		loaded := atomic.LoadInt32(&s.Loaded)
		total := atomic.LoadInt32(&s.Total)
		if total == 0 {
			total = 1
		}
		d.App.Logf("BROWSE: HuggingFace cache building for %s", platform)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintf(w, "__IA_LOADING__:%d/%d", loaded, total)
		return
	}

	// No source specified or unified requested — merge according to priority.
	if source == "" || source == "unified" {
		priorityParam := r.URL.Query().Get("priority")
		var providers []string
		if priorityParam != "" {
			providers = strings.Split(priorityParam, ",")
		} else {
			providers = []string{"huggingface", "ia", "minerva"}
		}

		seen := make(map[string]bool)
		var merged []string

		for _, p := range providers {
			p = strings.TrimSpace(strings.ToLower(p))
			switch p {
			case "huggingface":
				if platform == "xbox360" {
					d.App.IAGameCacheMu.RLock()
					hfCached := d.App.IAGameCache["hf_"+platform]
					d.App.IAGameCacheMu.RUnlock()
					if len(hfCached) == 0 {
						go d.HuggingFace.Build(platform)
					}
					for _, g := range hfCached {
						key := cacheService.NormalizeTitleForMatching(g)
						if !seen[key] {
							seen[key] = true
							merged = append(merged, g)
						}
					}
				}
			case "ia", "internet_archive", "internetarchive":
				d.App.IAGameCacheMu.RLock()
				iaCached := d.App.IAGameCache[platform]
				d.App.IAGameCacheMu.RUnlock()
				if len(iaCached) == 0 {
					go d.IA.Build(platform)
				}
				for _, g := range iaCached {
					key := cacheService.NormalizeTitleForMatching(g)
					if !seen[key] {
						seen[key] = true
						merged = append(merged, g)
					}
				}
			case "minerva":
				d.App.MinervaGameCacheMu.RLock()
				minervaCached := d.App.MinervaGameCache[platform]
				d.App.MinervaGameCacheMu.RUnlock()
				if len(minervaCached) == 0 {
					go d.Minerva.Build(platform)
				}
				for _, g := range minervaCached {
					decodedName := helpers.DecodeMinervaName(g)
					key := cacheService.NormalizeTitleForMatching(decodedName)
					if !seen[key] {
						seen[key] = true
						merged = append(merged, decodedName)
					}
				}
			}
		}

		if len(merged) > 0 {
			d.App.Logf("BROWSE UNIFIED: Serving %d merged games for %s", len(merged), platform)
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Write([]byte(strings.Join(merged, "|")))
			return
		}

		// Nothing ready yet — trigger build for the first provider and return loading state.
		first := "ia"
		if len(providers) > 0 {
			first = strings.TrimSpace(strings.ToLower(providers[0]))
		}

		var loaded, total int32
		if first == "huggingface" {
			go d.HuggingFace.Build(platform)
			s := d.IA.GetBuildState("hf_" + platform)
			loaded = atomic.LoadInt32(&s.Loaded)
			total = atomic.LoadInt32(&s.Total)
			if total == 0 {
				total = 1
			}
		} else if first == "minerva" {
			go d.Minerva.Build(platform)
			s := d.Minerva.GetBuildState(platform)
			loaded = atomic.LoadInt32(&s.Loaded)
			total = atomic.LoadInt32(&s.Total)
			if total == 0 {
				total = 1
			}
		} else {
			go d.IA.Build(platform)
			s := d.IA.GetBuildState(platform)
			loaded = atomic.LoadInt32(&s.Loaded)
			total = atomic.LoadInt32(&s.Total)
			if total == 0 {
				total = int32(len(app.IACollections[platform]))
			}
		}

		d.App.Logf("BROWSE UNIFIED: Cache building for %s (primary: %s) %d/%d", platform, first, loaded, total)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintf(w, "__IA_LOADING__:%d/%d", loaded, total)
		return
	}
}

func (d *Deps) handleCacheStatus(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	type platformStatus struct {
		State  string `json:"state"`
		Loaded int32  `json:"loaded"`
		Total  int32  `json:"total"`
		Games  int    `json:"games"`
	}
	result := map[string]platformStatus{}

	d.App.BuildStatesMu.Lock()
	for p, s := range d.App.BuildStates {
		d.App.IAGameCacheMu.RLock()
		count := len(d.App.IAGameCache[p])
		d.App.IAGameCacheMu.RUnlock()
		result[p] = platformStatus{
			State:  s.State,
			Loaded: atomic.LoadInt32(&s.Loaded),
			Total:  atomic.LoadInt32(&s.Total),
			Games:  count,
		}
	}
	d.App.BuildStatesMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// handleCacheRefresh triggers a fresh rebuild for one platform or all platforms.
func (d *Deps) handleCacheRefresh(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	platform := r.URL.Query().Get("platform")

	if platform == "" || platform == "all" {
		d.App.Logf("CACHE REFRESH: all HuggingFace + IA + Minerva platforms requested")
		go d.HuggingFace.Build("xbox360")
		for p := range app.IACollections {
			go d.IA.Build(p)
		}
		for p := range app.MinervaPageURLs {
			go d.Minerva.Build(p)
		}
		// Also refresh any ROM system that already has a cache on disk
		var romRefreshed []string
		d.App.ROMGameCacheMu.RLock()
		for sysid := range app.ROMSystems {
			if len(d.App.ROMGameCache[sysid]) > 0 {
				romRefreshed = append(romRefreshed, sysid)
			}
		}
		d.App.ROMGameCacheMu.RUnlock()
		for _, sysid := range romRefreshed {
			go d.ROM.Build(sysid)
		}
		d.App.Logf("CACHE REFRESH: %d previously-used ROM systems queued", len(romRefreshed))
		jsonSuccess(w, map[string]string{"status": "refreshing", "platforms": "all"})
		return
	}

	if strings.HasPrefix(platform, "minerva_") {
		p := strings.TrimPrefix(platform, "minerva_")
		if _, ok := app.MinervaPageURLs[p]; !ok {
			jsonError(w, 400, "Unknown Minerva platform: "+p)
			return
		}
		d.App.Logf("CACHE REFRESH: Minerva %s", p)
		go d.Minerva.Build(p)
		jsonSuccess(w, map[string]string{"status": "refreshing", "platform": platform})
		return
	}

	if strings.HasPrefix(platform, "hf_") {
		p := strings.TrimPrefix(platform, "hf_")
		d.App.Logf("CACHE REFRESH: HuggingFace %s", p)
		go d.HuggingFace.Build(p)
		jsonSuccess(w, map[string]string{"status": "refreshing", "platform": platform})
		return
	}

	if strings.HasPrefix(platform, "rom_") {
		sysid := strings.TrimPrefix(platform, "rom_")
		if _, ok := app.ROMSystems[sysid]; !ok {
			jsonError(w, 400, "Unknown ROM system: "+sysid)
			return
		}
		d.App.Logf("CACHE REFRESH: ROM system %s", sysid)
		go d.ROM.Build(sysid)
		jsonSuccess(w, map[string]string{"status": "refreshing", "platform": platform})
		return
	}

	if _, ok := app.IACollections[platform]; !ok {
		jsonError(w, 400, "Unknown platform: "+platform)
		return
	}
	if platform == "xbox360" {
		go d.HuggingFace.Build(platform)
	}
	d.App.Logf("CACHE REFRESH: %s (HuggingFace + IA + Minerva)", platform)
	go d.IA.Build(platform)
	go d.Minerva.Build(platform)
	jsonSuccess(w, map[string]string{"status": "refreshing", "platform": platform})
}

func (d *Deps) handleRegister(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	gameName := local.NormalizeClientGameName(r.URL.Query().Get("game"))
	xboxIP := r.URL.Query().Get("ip")
	drive := r.URL.Query().Get("drive")
	localRoot := r.URL.Query().Get("local_root")
	platform := r.URL.Query().Get("platform")
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "http"
	}
	if gameName == "" {
		jsonError(w, 400, "Missing game parameter")
		return
	}
	if reason := models.UnsupportedMultiDiscReason(gameName); reason != "" {
		jsonError(w, 422, reason)
		return
	}
	if mode == "local" {
		// Local writes target a mounted drive on this PC; no console IP needed.
		if localRoot == "" {
			jsonError(w, 400, "Missing local_root parameter for local mode")
			return
		}
	} else {
		if xboxIP == "" {
			jsonError(w, 400, "Missing ip parameter")
			return
		}
		if net.ParseIP(xboxIP) == nil {
			jsonError(w, 400, "Invalid IP address format")
			return
		}
	}
	localDeviceID := ""
	if mode == "local" {
		var err error
		localDeviceID, err = pipelineService.PrepareLocalDevice(localRoot)
		if err != nil {
			jsonError(w, 409, "O dispositivo local nao esta pronto ou foi desconectado: "+err.Error())
			return
		}
	}
	if drive == "" {
		drive = "Hdd1:"
	}
	if platform == "" {
		platform = "xbox360"
	}
	installType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("install_type")))
	if installType == "" {
		installType = "god"
	}
	if installType != "god" && installType != "content" && installType != "xex" {
		installType = "god"
	}
	d.App.InstallTypeMap.Store(gameName, installType)
	d.App.XboxConnections.Store(gameName, models.XboxConnection{
		IP: xboxIP, Drive: drive, LocalRoot: localRoot, LocalDeviceID: localDeviceID, GameName: gameName,
		Platform: platform, Mode: mode, Timestamp: time.Now(),
	})
	if mode == "local" {
		d.App.Logf("REGISTER: Local %s for %s (mode=local install=%s)", localRoot, gameName, installType)
	} else {
		d.App.Logf("REGISTER: Xbox %s for %s (mode=%s drive=%s install=%s)", xboxIP, gameName, mode, drive, installType)
	}
	jsonSuccess(w, map[string]string{"status": "registered", "mode": mode, "ip": xboxIP, "drive": drive, "local_root": localRoot})
}

func (d *Deps) handleTrigger(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	gameName := local.NormalizeClientGameName(r.URL.Query().Get("game"))
	platform := r.URL.Query().Get("platform")
	source := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("source"))) // "minerva", "ia", or ""
	if gameName == "" {
		jsonError(w, 400, "Missing game parameter")
		return
	}
	if reason := models.UnsupportedMultiDiscReason(gameName); reason != "" {
		jsonError(w, 422, reason)
		return
	}
	if platform == "" {
		platform = "xbox360"
	}
	installType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("install_type")))
	if installType == "" {
		installType = "god"
	}
	if installType != "god" && installType != "content" && installType != "xex" {
		installType = "god"
	}
	d.App.InstallTypeMap.Store(gameName, installType)
	d.App.SuppressedJobs.Delete(gameName)

	if status, exists := d.App.JobQueue.Load(gameName); exists {
		gs := status.(models.GameStatus)
		if gs.State == "Ready" {
			jsonSuccess(w, map[string]string{"status": "already_ready"})
			return
		}
		if gs.State == "Processing" {
			jsonSuccess(w, map[string]string{"status": "already_processing"})
			return
		}
		if gs.State == "Queued" {
			jsonSuccess(w, map[string]string{"status": "already_queued"})
			return
		}
	}

	launcher := func(fn func()) {
		jobToken := d.App.RegisterGameJob(gameName)
		go func() {
			if !d.App.AcquireGameJob(gameName, jobToken) {
				return
			}
			defer d.App.ReleaseGameJob(gameName, jobToken)
			defer func() {
				if rec := recover(); rec != nil {
					d.App.Logf("PANIC processing %s: %v", gameName, rec)
					buf := make([]byte, 4096)
					n := runtime.Stack(buf, false)
					d.App.Logf("STACK: %s", string(buf[:n]))
					d.App.LogStatus(gameName, "Error", "Server crashed during processing")
				}
			}()
			fn()
		}()
	}

	// Local ISO in Transfer folder takes priority for disc-based platforms
	if platform == "xbox360" || platform == "xbox" || platform == "local" {
		if iso := d.Local.FindLocalISO(gameName); iso != "" {
			d.App.Logf("TRIGGER: Local ISO found for '%s'", gameName)
			launcher(func() { d.Pipeline.ProcessLocalISO(gameName, iso) })
			jsonSuccess(w, map[string]string{"status": "triggered", "source": "local"})
			return
		}
		if d.Local.IsGameReadyLocally(gameName) {
			d.App.LogStatus(gameName, "Ready", "Ready to Install")
			jsonSuccess(w, map[string]string{"status": "already_ready"})
			return
		}
		// Local Transfer list (platform=local): never use Internet Archive
		if platform == "local" {
			d.App.Logf("LOCAL UNAVAILABLE: no .iso match for %q in %s (check URL encoding for & + # in filenames)", gameName, d.App.TransferDir)
			d.App.LogStatus(gameName, "Error", "No ISO in Transfer folder for \""+gameName+"\"")
			jsonSuccess(w, map[string]string{
				"status":  "local_unavailable",
				"message": "Add the game ISO to your Transfer folder, then queue again.",
			})
			return
		}
	}

	// ROM platforms (edgeemu.net)
	if strings.HasPrefix(platform, "rom_") {
		sysid := strings.TrimPrefix(platform, "rom_")
		if _, ok := app.ROMSystems[sysid]; !ok {
			jsonError(w, 400, "Unknown ROM system: "+sysid)
			return
		}
		if d.Local.IsGameReadyLocally(gameName) {
			d.App.LogStatus(gameName, "Ready", "Ready to Install")
			jsonSuccess(w, map[string]string{"status": "already_ready"})
			return
		}
		launcher(func() { d.Pipeline.ProcessROM(gameName, sysid) })
		jsonSuccess(w, map[string]string{"status": "triggered", "source": "edgeemu"})
		return
	}

	// Unified / Fallback
	if source == "" || source == "unified" {
		if d.Local.IsGameReadyLocally(gameName) {
			d.App.LogStatus(gameName, "Ready", "Ready to Install")
			jsonSuccess(w, map[string]string{"status": "already_ready"})
			return
		}
		priorityParam := r.URL.Query().Get("priority")
		var providers []string
		if priorityParam != "" {
			providers = strings.Split(priorityParam, ",")
		} else {
			providers = []string{"huggingface", "ia", "minerva"}
		}

		launcher(func() { d.Pipeline.ProcessGameWithFallback(gameName, platform, providers) })
		jsonSuccess(w, map[string]string{"status": "triggered", "source": "unified"})
		return
	}

	// Minerva (explicit source="minerva")
	if source == "minerva" {
		if _, hasMinervaPage := app.MinervaPageURLs[platform]; hasMinervaPage {
			if mEntry, ok := d.Minerva.FindEntry(gameName, platform); ok {
				d.App.Logf("TRIGGER: Minerva source for '%s' (%s)", gameName, platform)
				effPlatform := platform
				if mEntry.Platform != "" {
					effPlatform = mEntry.Platform
				}
				switch effPlatform {
				case "digital", "xbla", "dlc", "xblig":
					launcher(func() { d.Pipeline.ProcessMinervaDigital(gameName, mEntry, effPlatform) })
				case "games":
					launcher(func() { d.Pipeline.ProcessMinervaGenericGame(gameName, mEntry) })
				default: // xbox360, xbox
					launcher(func() { d.Pipeline.ProcessMinervaGame(gameName, mEntry, effPlatform) })
				}
				jsonSuccess(w, map[string]string{"status": "triggered", "source": "minerva"})
				return
			}
			if source == "minerva" {
				d.App.LogStatus(gameName, "Error", "Not found in Minerva Archive")
				jsonSuccess(w, map[string]string{"status": "minerva_unavailable", "message": "Game not found in Minerva Archive."})
				return
			}
		}
	}

	// source=="minerva" but platform has no Minerva page — treat as not found
	if source == "minerva" {
		d.App.LogStatus(gameName, "Error", "Not found in Minerva Archive")
		jsonSuccess(w, map[string]string{"status": "minerva_unavailable", "message": "Game not found in Minerva Archive."})
		return
	}

	// Hugging Face
	if source == "huggingface" {
		if d.Local.IsGameReadyLocally(gameName) {
			d.App.LogStatus(gameName, "Ready", "Ready to Install")
			jsonSuccess(w, map[string]string{"status": "already_ready"})
			return
		}
		entry, ok := cacheService.FindHuggingFaceEntry(d.App, gameName, platform)
		if !ok && !cacheService.HasHuggingFaceCatalog(d.App, platform) && d.HuggingFace != nil {
			d.HuggingFace.Build(platform)
			entry, ok = cacheService.FindHuggingFaceEntry(d.App, gameName, platform)
		}
		if !ok {
			d.App.LogStatus(gameName, "Error", "Not found in Hugging Face catalog")
			jsonSuccess(w, map[string]string{"status": "hf_unavailable", "message": "Game not found in Hugging Face catalog."})
			return
		}
		launcher(func() { d.Pipeline.ProcessHuggingFaceGame(gameName, entry.FileName) })
		jsonSuccess(w, map[string]string{"status": "triggered", "source": "huggingface"})
		return
	}

	// Internet Archive — fallback when Minerva has no match, or source=="ia"
	switch platform {
	case "digital", "xbla", "dlc", "xblig":
		launcher(func() { d.Pipeline.ProcessDigital(gameName, platform) })
	case "games":
		launcher(func() { d.Pipeline.ProcessGenericGame(gameName) })
	default: // xbox360, xbox
		launcher(func() { d.Pipeline.ProcessGame(gameName, platform) })
	}
	jsonSuccess(w, map[string]string{"status": "triggered", "source": "internet_archive"})
}

func (d *Deps) handleStatus(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	gameName := local.NormalizeClientGameName(r.URL.Query().Get("game"))
	if gameName == "" {
		jsonError(w, 400, "Missing game parameter")
		return
	}
	status := models.GameStatus{State: "Missing", Message: "Not Found"}
	if s, exists := d.App.JobQueue.Load(gameName); exists {
		status = s.(models.GameStatus)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// handleDiscInfo probes a local ISO in the Transfer folder and returns disc
// metadata along with a compat-table install recommendation.
func (d *Deps) handleDiscInfo(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	gameName := local.NormalizeClientGameName(r.URL.Query().Get("game"))
	if gameName == "" {
		jsonError(w, 400, "Missing game parameter")
		return
	}
	iso := d.Local.FindLocalISO(gameName)
	if iso != "" {
		info, err := utils.ProbeISODiscInfo(iso)
		if err != nil {
			jsonError(w, 500, fmt.Sprintf("Disc probe failed: %v", err))
			return
		}
		compatTitleID := info.TitleID
		if guessed := models.GuessTitleIDFromMultiDiscName(gameName); (compatTitleID == 0 || models.IsContentDiscPlaceholderTitleID(compatTitleID)) && guessed != 0 {
			compatTitleID = guessed
		}
		compatDiscNumber := info.DiscNumber
		if compatDiscNumber == 0 {
			compatDiscNumber = models.DiscNumberFromName(gameName)
		}
		rec := models.DiscCompat(compatTitleID, compatDiscNumber)
		layout, err := utils.ProbeISOInstallLayout(iso, info)
		if err != nil {
			jsonError(w, 500, fmt.Sprintf("Disc layout probe failed: %v", err))
			return
		}
		if layout.HasInstallableContent && !(compatTitleID == 0x555308B6 && compatDiscNumber == 2) {
			rec = models.DiscCompatRec{InstallType: "content", Notes: "ISO contem pacotes STFS de instalacao; estrutura detectada no proprio disco"}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"disc_number":      info.DiscNumber,
			"disc_count":       info.DiscCount,
			"title_id":         fmt.Sprintf("%08X", info.TitleID),
			"recommendation":   rec.InstallType,
			"notes":            rec.Notes,
			"probed":           true,
			"content_title_id": fmt.Sprintf("%08X", layout.ContentTitleID),
		})
		return
	}
	// No Transfer-folder ISO yet (typical for IA-only installs) — filename-based hint for Disc 2+.
	if !models.IsMultiDiscGameName(gameName) {
		jsonError(w, 404, "No local ISO found for this game")
		return
	}
	tid := models.GuessTitleIDFromMultiDiscName(gameName)
	discNumber := models.DiscNumberFromName(gameName)
	rec := models.DiscCompat(tid, discNumber)
	note := rec.Notes
	if tid == 0 {
		note = note + " (Title ID unknown from name — optional: copy ISO to PC Transfer for an exact probe)"
	} else {
		note = note + " (Title ID guessed from game name)"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"disc_number":    discNumber,
		"disc_count":     0,
		"title_id":       fmt.Sprintf("%08X", tid),
		"recommendation": rec.InstallType,
		"notes":          note,
		"probed":         false,
	})
}

func (d *Deps) handleQueue(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	type JobEntry struct {
		Game    string `json:"game"`
		State   string `json:"state"`
		Message string `json:"message"`
	}
	var jobs []JobEntry
	d.App.JobQueue.Range(func(k, v interface{}) bool {
		gs := v.(models.GameStatus)
		jobs = append(jobs, JobEntry{
			Game:    k.(string),
			State:   gs.State,
			Message: gs.Message,
		})
		return true
	})
	// Sort: Processing first, then Ready, then Error, then others
	sort.Slice(jobs, func(i, j int) bool {
		order := map[string]int{"Processing": 0, "Ready": 1, "Error": 2}
		oi, iok := order[jobs[i].State]
		oj, jok := order[jobs[j].State]
		if !iok {
			oi = 3
		}
		if !jok {
			oj = 3
		}
		if oi != oj {
			return oi < oj
		}
		return jobs[i].Game < jobs[j].Game
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}

// handleQueueRemove clears one job or the whole queue (POST /queue/remove?game=name or no game = all).
func (d *Deps) handleQueueRemove(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodPost && r.Method != stdhttp.MethodGet {
		jsonError(w, 405, "Use GET or POST /queue/remove?game=GameName (omit game to clear all)")
		return
	}
	game := local.NormalizeClientGameName(r.URL.Query().Get("game"))
	if game == "" {
		var keys []string
		d.App.JobQueue.Range(func(k, _ interface{}) bool {
			keys = append(keys, k.(string))
			return true
		})
		for _, k := range keys {
			d.App.CancelGameJob(k)
			d.App.JobQueue.Delete(k)
			d.App.SuppressedJobs.Store(k, struct{}{})
		}
		d.App.Logf("QUEUE: cleared %d job(s)", len(keys))
		jsonSuccess(w, map[string]string{"status": "cleared", "count": fmt.Sprintf("%d", len(keys))})
		return
	}
	d.App.CancelGameJob(game)
	d.App.JobQueue.Delete(game)
	d.App.SuppressedJobs.Store(game, struct{}{})
	// Also cancel any pending FTP job for this game
	for _, job := range d.FTP.LoadAllPendingFTPJobs() {
		if job.GameName == game {
			d.FTP.DeletePendingFTPJob(job.ID)
			go func(j ftp.PendingFTPJob) {
				time.Sleep(3 * time.Second)
				os.RemoveAll(j.SourceDir)
				if j.GameDir != "" {
					os.RemoveAll(j.GameDir)
				}
			}(job)
		}
	}
	d.App.Logf("QUEUE: removed job %q", game)
	jsonSuccess(w, map[string]string{"status": "removed", "game": game})
}

// handleQueueRetry re-triggers a failed or interrupted job in the queue.
func (d *Deps) handleQueueRetry(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodPost && r.Method != stdhttp.MethodGet {
		jsonError(w, 405, "Use GET or POST /queue/retry?game=GameName")
		return
	}
	game := local.NormalizeClientGameName(r.URL.Query().Get("game"))
	if game == "" {
		jsonError(w, 400, "Missing game parameter")
		return
	}

	d.App.SuppressedJobs.Delete(game)

	var conn models.XboxConnection
	hasConn := false
	if v, ok := d.App.XboxConnections.Load(game); ok {
		conn = v.(models.XboxConnection)
		hasConn = true
	}

	if hasConn && conn.Mode == "local" && conn.LocalRoot != "" {
		if id, err := pipelineService.PrepareLocalDevice(conn.LocalRoot); err == nil {
			conn.LocalDeviceID = id
			d.App.XboxConnections.Store(game, conn)
		}
	}

	platform := "xbox360"
	if hasConn && conn.Platform != "" {
		platform = conn.Platform
	}

	installType := "god"
	if it, ok := d.App.InstallTypeMap.Load(game); ok {
		installType = it.(string)
	} else {
		d.App.InstallTypeMap.Store(game, installType)
	}

	// Delete from JobQueue so it can restart cleanly
	d.App.JobQueue.Delete(game)

	launcher := func(fn func()) {
		jobToken := d.App.RegisterGameJob(game)
		go func() {
			if !d.App.AcquireGameJob(game, jobToken) {
				return
			}
			defer d.App.ReleaseGameJob(game, jobToken)
			defer func() {
				if rec := recover(); rec != nil {
					d.App.Logf("PANIC retrying %s: %v", game, rec)
					buf := make([]byte, 4096)
					n := runtime.Stack(buf, false)
					d.App.Logf("STACK: %s", string(buf[:n]))
					d.App.LogStatus(game, "Error", "Server crashed during processing")
				}
			}()
			fn()
		}()
	}

	// Check local ISO
	if (platform == "xbox360" || platform == "xbox" || platform == "local") && d.Local != nil {
		if iso := d.Local.FindLocalISO(game); iso != "" {
			d.App.Logf("RETRY: Local ISO found for '%s'", game)
			launcher(func() { d.Pipeline.ProcessLocalISO(game, iso) })
			jsonSuccess(w, map[string]string{"status": "triggered", "source": "local", "game": game})
			return
		}
	}

	// ROM
	if strings.HasPrefix(platform, "rom_") {
		sysid := strings.TrimPrefix(platform, "rom_")
		if _, ok := app.ROMSystems[sysid]; ok {
			d.App.Logf("RETRY: ROM system %s for '%s'", sysid, game)
			launcher(func() { d.Pipeline.ProcessROM(game, sysid) })
			jsonSuccess(w, map[string]string{"status": "triggered", "source": "edgeemu", "game": game})
			return
		}
	}

	priorityParam := r.URL.Query().Get("priority")
	var providers []string
	if priorityParam != "" {
		providers = strings.Split(priorityParam, ",")
	} else {
		providers = []string{"huggingface", "ia", "minerva"}
	}

	d.App.Logf("RETRY: Game fallback pipeline for '%s' (%s, installType=%s)", game, platform, installType)
	launcher(func() { d.Pipeline.ProcessGameWithFallback(game, platform, providers) })
	jsonSuccess(w, map[string]string{"status": "triggered", "source": "retry", "game": game})
}

func (d *Deps) handleDataStatus(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var activeJobs int
	d.App.JobQueue.Range(func(k, v interface{}) bool {
		gs := v.(models.GameStatus)
		if gs.State == "Processing" || gs.State == "Pending FTP" {
			activeJobs++
		}
		return true
	})
	pendingJobs := d.FTP.LoadAllPendingFTPJobs()
	pendingFTPJobs := len(pendingJobs)

	// Calculate local data size (Ready/ + Temp/ directories)
	var localDataBytes int64
	for _, dir := range []string{"Ready", "Temp"} {
		filepath.Walk(filepath.Join(d.App.ToolsDir, dir), func(_ string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				localDataBytes += info.Size()
			}
			return nil
		})
	}
	// Also count pending_ftp source dirs
	for _, job := range pendingJobs {
		filepath.Walk(job.SourceDir, func(_ string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				localDataBytes += info.Size()
			}
			return nil
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"active_jobs":      activeJobs,
		"pending_ftp_jobs": pendingFTPJobs,
		"local_data_bytes": localDataBytes,
		"local_data_mb":    localDataBytes / 1048576,
	})
}

func (d *Deps) handleDataClear(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	// Clear all job statuses
	d.App.JobQueue.Range(func(k, v interface{}) bool {
		d.App.CancelGameJob(k.(string))
		d.App.SuppressedJobs.Store(k, true)
		d.App.JobQueue.Delete(k)
		return true
	})
	// Clear pending FTP jobs (goroutines will detect suppression and exit)
	pendingJobs := d.FTP.LoadAllPendingFTPJobs()
	for _, job := range pendingJobs {
		d.App.SuppressedJobs.Store(job.GameName, true)
		d.FTP.DeletePendingFTPJob(job.ID)
		go func(j ftp.PendingFTPJob) {
			time.Sleep(2 * time.Second)
			os.RemoveAll(j.SourceDir)
			if j.GameDir != "" {
				os.RemoveAll(j.GameDir)
			}
		}(job)
	}
	// Clear Ready/ and Temp/ directories. TempDir/TorrentTempDir may live on
	// another drive (auto-selected roomiest volume), so clear them explicitly.
	os.RemoveAll(filepath.Join(d.App.ToolsDir, "Ready"))
	os.RemoveAll(filepath.Join(d.App.ToolsDir, "Temp"))
	os.RemoveAll(d.App.TempDir)
	os.RemoveAll(d.App.TorrentTempDir)
	os.MkdirAll(filepath.Join(d.App.ToolsDir, "Ready"), 0755)
	os.MkdirAll(filepath.Join(d.App.ToolsDir, "Temp"), 0755)
	os.MkdirAll(d.App.TempDir, 0755)
	os.MkdirAll(d.App.TorrentTempDir, 0755)

	jsonSuccess(w, map[string]string{"status": "cleared"})
}

func (d *Deps) handleRoot(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.URL.Path != "/" {
		stdhttp.NotFound(w, r)
		return
	}

	outboundIP := d.App.ServerIP
	if outboundIP == "" {
		outboundIP = app.GetOutboundIP()
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GODsend-360 Companion</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0b0f19;
            --card-bg: rgba(22, 28, 45, 0.75);
            --card-border: rgba(255, 255, 255, 0.08);
            --accent-green: #10b981;
            --accent-blue: #3b82f6;
            --accent-purple: #8b5cf6;
            --accent-yellow: #f59e0b;
            --accent-red: #ef4444;
            --text-primary: #f3f4f6;
            --text-secondary: #9ca3af;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        body {
            background: radial-gradient(circle at top right, #1e1b4b, #0b0f19 60%%);
            color: var(--text-primary);
            min-height: 100vh;
            padding: 16px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .container {
            width: 100%%;
            max-width: 480px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .header {
            text-align: center;
            padding: 12px 0 4px 0;
        }

        .logo-title {
            font-size: 26px;
            font-weight: 700;
            background: linear-gradient(135deg, #10b981, #3b82f6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
        }

        .subtitle {
            font-size: 13px;
            color: var(--text-secondary);
            margin-top: 2px;
        }

        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(16, 185, 129, 0.15);
            border: 1px solid rgba(16, 185, 129, 0.3);
            color: var(--accent-green);
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            margin-top: 8px;
        }

        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%%;
            background-color: var(--accent-green);
            box-shadow: 0 0 10px var(--accent-green);
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0%%, 100%% { opacity: 1; transform: scale(1); }
            50%% { opacity: 0.5; transform: scale(0.8); }
        }

        .card {
            background: var(--card-bg);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 18px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.37);
        }

        .card-title {
            font-size: 15px;
            font-weight: 600;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            color: var(--text-primary);
        }

        .xbox-status-box {
            background: rgba(0, 0, 0, 0.25);
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 14px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .input-group {
            display: flex;
            gap: 8px;
        }

        .text-input {
            flex: 1;
            background: rgba(0, 0, 0, 0.4);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 10px 12px;
            color: white;
            font-size: 14px;
            outline: none;
            font-family: monospace;
            transition: border-color 0.2s;
        }

        .text-input:focus {
            border-color: var(--accent-blue);
        }

        .ip-box {
            background: rgba(0, 0, 0, 0.3);
            border: 1px dashed rgba(59, 130, 246, 0.4);
            border-radius: 10px;
            padding: 12px;
            text-align: center;
            margin: 6px 0;
        }

        .ip-value {
            font-size: 24px;
            font-weight: 700;
            color: var(--accent-blue);
            letter-spacing: 1px;
            font-family: monospace;
        }

        .ip-label {
            font-size: 12px;
            color: var(--text-secondary);
            margin-bottom: 4px;
        }

        .steps-list {
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 10px;
        }

        .step-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 1.4;
        }

        .step-num {
            background: rgba(139, 92, 246, 0.2);
            color: var(--accent-purple);
            border: 1px solid rgba(139, 92, 246, 0.4);
            width: 22px;
            height: 22px;
            border-radius: 50%%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 11px;
            flex-shrink: 0;
        }

        .grid-status {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }

        .stat-box {
            background: rgba(255, 255, 255, 0.03);
            border-radius: 10px;
            padding: 12px;
            text-align: center;
        }

        .stat-val {
            font-size: 18px;
            font-weight: 700;
            color: var(--text-primary);
        }

        .stat-desc {
            font-size: 11px;
            color: var(--text-secondary);
        }

        .wizard-progress {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(22, 28, 45, 0.6);
            border: 1px solid var(--card-border);
            border-radius: 14px;
            padding: 12px 18px;
            margin-bottom: 4px;
        }

        .wizard-step-item {
            display: flex;
            align-items: center;
            gap: 6px;
            opacity: 0.5;
            transition: all 0.3s;
        }

        .wizard-step-item.active {
            opacity: 1;
        }

        .wizard-step-circle {
            width: 26px;
            height: 26px;
            border-radius: 50%%;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 700;
        }

        .wizard-step-item.active .wizard-step-circle {
            background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
            border-color: transparent;
            box-shadow: 0 0 10px rgba(59, 130, 246, 0.4);
        }

        .wizard-step-text {
            font-size: 12px;
            font-weight: 600;
            color: var(--text-primary);
        }

        .wizard-line {
            flex: 1;
            height: 2px;
            background: rgba(255, 255, 255, 0.1);
            margin: 0 8px;
        }

        .mode-cards {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .wizard-option-card {
            display: flex;
            align-items: center;
            gap: 12px;
            background: rgba(255, 255, 255, 0.03);
            border: 2px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 14px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .wizard-option-card:hover {
            background: rgba(255, 255, 255, 0.06);
        }

        .wizard-option-card.selected {
            background: rgba(59, 130, 246, 0.12);
            border-color: var(--accent-blue);
            box-shadow: 0 0 12px rgba(59, 130, 246, 0.2);
        }

        .wizard-option-icon {
            font-size: 26px;
        }

        .wizard-option-info {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .wizard-option-title {
            font-size: 14px;
            font-weight: 600;
            color: var(--text-primary);
        }

        .wizard-option-desc {
            font-size: 11px;
            color: var(--text-secondary);
            line-height: 1.3;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo-title">GODsend-360</div>
            <div class="subtitle">Assistente de Configuração Fácil</div>
            <div class="status-badge">
                <div class="dot"></div> Servidor Ativo (Porta %s)
            </div>
        </div>

        <!-- BARRA DE PROGRESSO DO ASSISTENTE -->
        <div class="wizard-progress">
            <div class="wizard-step-item active" id="step-dot-1">
                <div class="wizard-step-circle">1</div>
                <div class="wizard-step-text">Modo</div>
            </div>
            <div class="wizard-line"></div>
            <div class="wizard-step-item" id="step-dot-2">
                <div class="wizard-step-circle">2</div>
                <div class="wizard-step-text">Conexão</div>
            </div>
            <div class="wizard-line"></div>
            <div class="wizard-step-item" id="step-dot-3">
                <div class="wizard-step-circle">3</div>
                <div class="wizard-step-text">Pronto</div>
            </div>
        </div>

        <!-- PASSO 1: ESCOLHER MODO -->
        <div id="wizard-step-1" class="card">
            <div class="card-title">
                <span>Passo 1: Onde você quer instalar?</span>
            </div>
            <div class="subtitle" style="margin-bottom: 12px;">
                Escolha a forma de instalação mais adequada para seu Xbox 360:
            </div>

            <div class="mode-cards">
                <div class="wizard-option-card selected" id="opt-card-ftp" onclick="selectWizardMode('ftp')">
                    <div class="wizard-option-icon">📡</div>
                    <div class="wizard-option-info">
                        <div class="wizard-option-title">Enviar pelo Wi-Fi (Sem Fio)</div>
                        <div class="wizard-option-desc">Instala os jogos direto no Xbox 360 via Wi-Fi.<br><span style="color: var(--accent-amber); font-weight: 600;">(Requer Xbox Desbloqueado RGH com Aurora ou FSD)</span></div>
                    </div>
                </div>

                <div class="wizard-option-card" id="opt-card-local" onclick="selectWizardMode('local')">
                    <div class="wizard-option-icon">💾</div>
                    <div class="wizard-option-info">
                        <div class="wizard-option-title">Gravar em Pendrive / Cartão SD</div>
                        <div class="wizard-option-desc">Grava os jogos no Pendrive pelo celular para espetar no Xbox 360 depois.<br><span style="color: var(--accent-green); font-weight: 600;">(Recomendado se não tiver Wi-Fi no Xbox)</span></div>
                    </div>
                </div>
            </div>

            <button type="button" class="btn" style="margin-top: 16px; width: 100%%;" onclick="goToStep(2)">Avançar para o Passo 2 ➔</button>
        </div>

        <!-- PASSO 2A: WI-FI / XBOX -->
        <div id="wizard-step-2-ftp" class="card" style="display: none;">
            <div class="card-title">
                <span>Passo 2: Requisitos e Conexão Xbox 360</span>
                <button type="button" class="btn btn-secondary btn-sm" onclick="discoverXbox()">🔍 Buscar Novamente</button>
            </div>

            <!-- REQUISITOS OBRIGATÓRIOS DO XBOX 360 (ESPELHO DESKTOP) -->
            <div class="xbox-status-box" style="margin-bottom: 12px; border-color: rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.05);">
                <div class="ip-label" style="text-align: left; color: var(--accent-amber); font-weight: 700; margin-bottom: 6px;">
                    ⚠️ Requisitos Obrigatórios para Envio por Wi-Fi (FTP):
                </div>
                <ul class="steps-list" style="margin: 0; padding-left: 2px;">
                    <li class="step-item" style="font-size: 11px; margin-bottom: 6px;">
                        <div class="step-num" style="background: rgba(245, 158, 11, 0.2); color: var(--accent-amber); font-weight: 700;">1</div>
                        <div><b>Desbloqueio RGH / JTAG:</b> Seu Xbox 360 precisa ter desbloqueio RGH ou JTAG. Consoles travados/originais não aceitam FTP.</div>
                    </li>
                    <li class="step-item" style="font-size: 11px; margin-bottom: 6px;">
                        <div class="step-num" style="background: rgba(245, 158, 11, 0.2); color: var(--accent-amber); font-weight: 700;">2</div>
                        <div><b>Aurora ou FreestyleDash:</b> O Xbox deve estar ligado na dashboard <b>Aurora</b> ou <b>FSD</b> (que possuem o servidor FTP ativo na porta 21).</div>
                    </li>
                    <li class="step-item" style="font-size: 11px;">
                        <div class="step-num" style="background: rgba(245, 158, 11, 0.2); color: var(--accent-amber); font-weight: 700;">3</div>
                        <div><b>Mesmo Wi-Fi:</b> O celular e o Xbox 360 devem estar conectados ao mesmo roteador sem fio.</div>
                    </li>
                </ul>
            </div>

            <div class="xbox-status-box">
                <div id="xbox-status-msg" class="msg-badge msg-info">
                    🔍 Procurando Xbox 360 na rede Wi-Fi...
                </div>

                <div class="input-group">
                    <input type="text" id="xbox-ip-input" class="text-input" placeholder="IP do Xbox (ex: 192.168.18.50)">
                    <button type="button" class="btn btn-sm" onclick="testAndSaveXboxIP()">Conectar IP</button>
                </div>
            </div>

            <!-- OPÇÕES ESPELHO DESKTOP: UNIDADE DO XBOX & TIPO DE FORMATO -->
            <div class="xbox-status-box" style="margin-top: 12px;">
                <div class="ip-label" style="text-align: left;">Unidade de Destino no Xbox 360:</div>
                <select id="xbox-drive-select" class="text-input" style="width: 100%%; font-family: sans-serif; margin-bottom: 8px;" onchange="saveXboxDrivePref()">
                    <option value="Hdd1:">🎮 Hdd1: (HD Interno do Xbox - Padrão)</option>
                    <option value="Usb0:">🔌 Usb0: (Pendrive/HD USB 1 no Xbox)</option>
                    <option value="Usb1:">🔌 Usb1: (Pendrive/HD USB 2 no Xbox)</option>
                </select>

                <div class="ip-label" style="text-align: left;">Formato de Conversão do Jogo:</div>
                <select id="install-type-select" class="text-input" style="width: 100%%; font-family: sans-serif;" onchange="saveInstallTypePref()">
                    <option value="god">📦 GOD (Games On Demand - Recomendado para Dashboard)</option>
                    <option value="xex">📁 XEX (Arquivos Extraídos - Para Modding / Traduções)</option>
                </select>
            </div>

            <div class="ip-box" style="margin-top: 12px;">
                <div class="ip-label">Configuração do GODsend no Aurora (Xbox 360):</div>
                <div class="ip-value">%s</div>
                <div class="ip-label" style="margin-top: 4px;">No Xbox, abra o script GODsend no Aurora e informe o IP acima no parâmetro <b>BRAIN_IP</b>.</div>
            </div>

            <div style="margin-top: 14px; display: flex; gap: 8px;">
                <button type="button" class="btn btn-secondary" style="flex: 1;" onclick="goToStep(1)">⬅️ Voltar</button>
                <button type="button" class="btn" style="flex: 2;" onclick="finishStep2FTP()">Concluir Setup ➔</button>
            </div>
        </div>

        <!-- PASSO 2B: PENDRIVE / SD -->
        <div id="wizard-step-2-local" class="card" style="display: none;">
            <div class="card-title">
                <span>Passo 2: Selecionar o Pendrive</span>
                <button type="button" class="btn btn-secondary btn-sm" onclick="loadStorageDrives()">🔄 Atualizar Unidades</button>
            </div>

            <div class="xbox-status-box">
                <div class="ip-label" style="text-align: left;">Selecione seu Pendrive ou Cartão SD:</div>
                <select id="drive-dropdown" class="text-input" style="width: 100%%; font-family: sans-serif;" onchange="onDriveSelected()">
                    <option value="">Procurando pendrives...</option>
                </select>
                <div class="input-group">
                    <input type="text" id="local-path-input" class="text-input" placeholder="Caminho (ex: /storage/1A2B-3C4D)">
                    <button type="button" class="btn btn-sm" onclick="saveLocalTarget()">Salvar Pasta</button>
                </div>
                <div class="ip-label" style="text-align: left; margin-top: 8px;">Formato de Gravação no Pendrive:</div>
                <select id="local-install-type-select" class="text-input" style="width: 100%%; font-family: sans-serif; margin-bottom: 6px;" onchange="saveLocalInstallTypePref()">
                    <option value="god">📦 GOD (Games On Demand - Espetar direto no Xbox)</option>
                    <option value="xex">📁 XEX (Arquivos Extraídos)</option>
                </select>
                <div id="local-status-msg" class="msg-badge msg-info">
                    ℹ️ Os jogos convertidos serão gravados diretamente na pasta escolhida no Pendrive.
                </div>
            </div>

            <div style="margin-top: 14px; display: flex; gap: 8px;">
                <button type="button" class="btn btn-secondary" style="flex: 1;" onclick="goToStep(1)">⬅️ Voltar</button>
                <button type="button" class="btn" style="flex: 2;" onclick="finishStep2Local()">Concluir Setup ➔</button>
            </div>
        </div>

        <!-- PASSO 3: TUDO PRONTO -->
        <div id="wizard-step-3" class="card" style="display: none;">
            <div class="card-title">
                <span>Passo 3: Tudo Configurado! 🎉</span>
            </div>

            <div class="msg-badge msg-success" style="padding: 12px; font-size: 13px; font-weight: 600;">
                ✅ Seu assistente de instalação está pronto para rodar!
            </div>

            <div class="xbox-status-box" style="margin-top: 12px;">
                <div class="step-item">
                    <div class="step-num">📌</div>
                    <div><b>Modo Ativo:</b> <span id="summary-mode-text">Wi-Fi (FTP)</span></div>
                </div>
                <div class="step-item">
                    <div class="step-num">📍</div>
                    <div><b>Destino Salvo:</b> <span id="summary-target-text">192.168.18.X</span></div>
                </div>
            </div>

            <div class="grid-status" style="margin-top: 12px;">
                <div class="stat-box">
                    <div class="stat-val" id="queue-count">0</div>
                    <div class="stat-desc">Fila de Downloads</div>
                </div>
                <div class="stat-box">
                    <div class="stat-val" style="color: var(--accent-green);">Ativo</div>
                    <div class="stat-desc">Servidor Go</div>
                </div>
            </div>

            <div style="margin-top: 14px; display: flex; gap: 8px;">
                <button type="button" class="btn btn-secondary" style="flex: 1;" onclick="goToStep(1)">⚙️ Alterar Configuração</button>
                <a href="/browse?platform=xbox360" class="btn" style="flex: 2; text-decoration: none; text-align: center; display: flex; align-items: center; justify-content: center;">🎮 Buscar Jogos</a>
            </div>
        </div>
    </div>

    <script>
        const ipInput = document.getElementById('xbox-ip-input');
        const statusMsg = document.getElementById('xbox-status-msg');
        let currentWizardMode = localStorage.getItem('godsend_mode') || 'ftp';

        function selectWizardMode(mode) {
            currentWizardMode = mode;
            localStorage.setItem('godsend_mode', mode);
            document.getElementById('opt-card-ftp').classList.toggle('selected', mode === 'ftp');
            document.getElementById('opt-card-local').classList.toggle('selected', mode === 'local');
        }

        function goToStep(step) {
            document.getElementById('step-dot-1').classList.toggle('active', step >= 1);
            document.getElementById('step-dot-2').classList.toggle('active', step >= 2);
            document.getElementById('step-dot-3').classList.toggle('active', step >= 3);

            document.getElementById('wizard-step-1').style.display = (step === 1) ? 'block' : 'none';
            document.getElementById('wizard-step-2-ftp').style.display = (step === 2 && currentWizardMode === 'ftp') ? 'block' : 'none';
            document.getElementById('wizard-step-2-local').style.display = (step === 2 && currentWizardMode === 'local') ? 'block' : 'none';
            document.getElementById('wizard-step-3').style.display = (step === 3) ? 'block' : 'none';

            if (step === 2) {
                if (currentWizardMode === 'ftp') {
                    discoverXbox();
                } else {
                    loadStorageDrives();
                }
            }

            if (step === 3) {
                document.getElementById('summary-mode-text').innerText = (currentWizardMode === 'ftp') ? 'Wi-Fi (Sem Fio)' : 'Pendrive / Cartão SD';
                const target = (currentWizardMode === 'ftp')
                    ? (localStorage.getItem('godsend_xbox_ip') || 'IP não salvo')
                    : (localStorage.getItem('godsend_local_path') || 'Pendrive não salvo');
                document.getElementById('summary-target-text').innerText = target;
            }
        }

        async function finishStep2FTP() {
            const ip = ipInput.value.trim();
            const drive = document.getElementById('xbox-drive-select').value || 'Hdd1:';
            const installType = document.getElementById('install-type-select').value || 'god';
            if (ip) {
                localStorage.setItem('godsend_xbox_ip', ip);
                localStorage.setItem('godsend_xbox_drive', drive);
                localStorage.setItem('godsend_install_type', installType);
                try {
                    await fetch('/register?game=*&mode=http&ip=' + encodeURIComponent(ip) + '&drive=' + encodeURIComponent(drive) + '&install_type=' + encodeURIComponent(installType));
                } catch(e) {}
            }
            goToStep(3);
        }

        async function finishStep2Local() {
            await saveLocalTarget();
            goToStep(3);
        }

        function saveXboxDrivePref() {
            const drive = document.getElementById('xbox-drive-select').value;
            localStorage.setItem('godsend_xbox_drive', drive);
        }

        function saveInstallTypePref() {
            const type = document.getElementById('install-type-select').value;
            localStorage.setItem('godsend_install_type', type);
            document.getElementById('local-install-type-select').value = type;
        }

        function saveLocalInstallTypePref() {
            const type = document.getElementById('local-install-type-select').value;
            localStorage.setItem('godsend_install_type', type);
            document.getElementById('install-type-select').value = type;
        }

        async function discoverXbox() {
            const savedIP = localStorage.getItem('godsend_xbox_ip');
            if (savedIP) ipInput.value = savedIP;

            statusMsg.className = "msg-badge msg-info";
            statusMsg.innerHTML = "🔍 Procurando Xbox 360 na rede Wi-Fi...";

            try {
                const res = await fetch('/ftp/discover');
                const data = await res.json();
                if (data && data.found && data.ip) {
                    ipInput.value = data.ip;
                    localStorage.setItem('godsend_xbox_ip', data.ip);
                    statusMsg.className = "msg-badge msg-success";
                    statusMsg.innerHTML = "✅ Xbox 360 encontrado automaticamente! IP: <b>" + data.ip + "</b>";
                } else if (savedIP) {
                    testAndSaveXboxIP();
                } else {
                    statusMsg.className = "msg-badge msg-warn";
                    statusMsg.innerHTML = "⚠️ Nenhuma resposta automática. Digite o IP do Xbox acima.";
                }
            } catch(e) {
                if (savedIP) testAndSaveXboxIP();
                else {
                    statusMsg.className = "msg-badge msg-warn";
                    statusMsg.innerHTML = "⚠️ Nenhuma resposta automática. Digite o IP do Xbox acima.";
                }
            }
        }

        async function testAndSaveXboxIP() {
            const ip = ipInput.value.trim();
            if (!ip) {
                statusMsg.className = "msg-badge msg-error";
                statusMsg.innerHTML = "❌ Digite o endereço IP do seu Xbox 360.";
                return;
            }

            statusMsg.className = "msg-badge msg-info";
            statusMsg.innerHTML = "⏳ Testando conexão com " + ip + "...";

            try {
                const res = await fetch('/ftp/ping', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ip: ip })
                });
                const data = await res.json();
                if (data && data.ok) {
                    localStorage.setItem('godsend_xbox_ip', ip);
                    statusMsg.className = "msg-badge msg-success";
                    statusMsg.innerHTML = "✅ Conectado com sucesso ao Xbox 360 (" + ip + ")!";
                } else {
                    statusMsg.className = "msg-badge msg-error";
                    statusMsg.innerHTML = "❌ Não foi possível conectar. Ligue o Xbox com o Aurora aberto.";
                }
            } catch(e) {
                statusMsg.className = "msg-badge msg-error";
                statusMsg.innerHTML = "❌ Erro ao testar IP. Verifique se está no mesmo Wi-Fi.";
            }
        }

        async function loadStorageDrives() {
            const select = document.getElementById('drive-dropdown');
            select.innerHTML = '<option value="">Carregando unidades...</option>';
            try {
                const res = await fetch('/tools/storage-drives');
                const data = await res.json();
                if (data && data.drives && data.drives.length > 0) {
                    select.innerHTML = '';
                    data.drives.forEach(d => {
                        const opt = document.createElement('option');
                        opt.value = d.path;
                        opt.innerText = d.label + (d.writable ? " [Pronto]" : " [Apenas Leitura]");
                        select.appendChild(opt);
                    });
                    const savedPath = localStorage.getItem('godsend_local_path') || data.drives[0].path;
                    select.value = savedPath;
                    document.getElementById('local-path-input').value = savedPath;
                } else {
                    select.innerHTML = '<option value="/storage/emulated/0">Armazenamento Interno (/storage/emulated/0)</option>';
                    document.getElementById('local-path-input').value = '/storage/emulated/0';
                }
            } catch(e) {
                select.innerHTML = '<option value="/storage/emulated/0">Armazenamento Interno (/storage/emulated/0)</option>';
                document.getElementById('local-path-input').value = '/storage/emulated/0';
            }
        }

        function onDriveSelected() {
            const val = document.getElementById('drive-dropdown').value;
            document.getElementById('local-path-input').value = val;
        }

        async function saveLocalTarget() {
            const path = document.getElementById('local-path-input').value.trim();
            const installType = document.getElementById('local-install-type-select').value || 'god';
            if (!path) return;
            localStorage.setItem('godsend_local_path', path);
            localStorage.setItem('godsend_mode', 'local');
            localStorage.setItem('godsend_install_type', installType);

            try {
                await fetch('/register?game=*&mode=local&local_root=' + encodeURIComponent(path) + '&install_type=' + encodeURIComponent(installType));
                document.getElementById('local-status-msg').className = "msg-badge msg-success";
                document.getElementById('local-status-msg').innerHTML = "✅ Destino local salvo! Jogos serão gravados em <b>" + path + "</b> (" + installType.toUpperCase() + ")";
            } catch(e) {
                document.getElementById('local-status-msg').className = "msg-badge msg-warn";
                document.getElementById('local-status-msg').innerHTML = "⚠️ Caminho salvo localmente (" + path + ")";
            }
        }

        async function fetchQueueStatus() {
            try {
                const res = await fetch('/queue');
                const data = await res.json();
                document.getElementById('queue-count').innerText = Array.isArray(data) ? data.length : 0;
            } catch(e) {}
        }

        // Init preferences
        const savedDrive = localStorage.getItem('godsend_xbox_drive');
        if (savedDrive) document.getElementById('xbox-drive-select').value = savedDrive;

        const savedInstallType = localStorage.getItem('godsend_install_type');
        if (savedInstallType) {
            document.getElementById('install-type-select').value = savedInstallType;
            document.getElementById('local-install-type-select').value = savedInstallType;
        }

        selectWizardMode(currentWizardMode);
        if (localStorage.getItem('godsend_xbox_ip') || localStorage.getItem('godsend_local_path')) {
            goToStep(3);
        } else {
            goToStep(1);
        }
        fetchQueueStatus();
        setInterval(fetchQueueStatus, 5000);
    </script>
</body>
</html>`, d.App.ServerPort, outboundIP)
}

func (d *Deps) handleServerConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	w.Header().Set("Content-Type", "application/json")
	ip := d.App.ServerIP
	if ip == "" {
		ip = app.GetOutboundIP()
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ip":               ip,
		"default_drive":    d.App.DefaultXboxDrive,
		"custom_god_path":  d.App.CustomGodPath,
		"custom_xex_path":  d.App.CustomXexPath,
		"temp_dir":         d.App.TempDir,        // resolved processing scratch (may be auto-relocated)
		"torrent_temp_dir": d.App.TorrentTempDir, // resolved aria2c download staging
	})
}

func (d *Deps) handleDebug(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, "<h2>GODSend Debug v7.0-IA</h2><p>Server: %s:%s</p>", d.App.ServerIP, d.App.ServerPort)
	fmt.Fprintf(w, "<h3>Cache Status:</h3><ul>")
	d.App.BuildStatesMu.Lock()
	for p, s := range d.App.BuildStates {
		d.App.IAGameCacheMu.RLock()
		count := len(d.App.IAGameCache[p])
		d.App.IAGameCacheMu.RUnlock()
		fmt.Fprintf(w, "<li>%s: %s %d/%d (%d games)</li>",
			p, s.State, atomic.LoadInt32(&s.Loaded), atomic.LoadInt32(&s.Total), count)
	}
	d.App.BuildStatesMu.Unlock()
	fmt.Fprintf(w, "</ul><h3>Transfer (Local ISOs):</h3><ul>")
	for _, g := range d.Local.ScanTransferFolder() {
		fmt.Fprintf(w, "<li>%s</li>", g)
	}
	fmt.Fprintf(w, "</ul><h3>Ready Games:</h3><ul>")
	if files, err := os.ReadDir(filepath.Join(d.App.ToolsDir, "Ready")); err == nil {
		for _, f := range files {
			if f.IsDir() {
				fmt.Fprintf(w, "<li>%s</li>", f.Name())
			}
		}
	}
	fmt.Fprintf(w, "</ul><h3>Active Jobs:</h3><ul>")
	d.App.JobQueue.Range(func(k, v interface{}) bool {
		gs := v.(models.GameStatus)
		fmt.Fprintf(w, "<li>%s: [%s] %s</li>", k, gs.State, gs.Message)
		return true
	})
	fmt.Fprintf(w, "</ul><p><b>Queue:</b> GET or POST <code>/queue/remove?game=ExactName</code> to drop one job (omit <code>game</code> to clear all). Suppresses in-flight status updates until that game is triggered again.</p>")
	fmt.Fprintf(w, "<h3>Xbox Connections:</h3><ul>")
	d.App.XboxConnections.Range(func(k, v interface{}) bool {
		c := v.(models.XboxConnection)
		fmt.Fprintf(w, "<li>%s: IP=%s Mode=%s Drive=%s (%s ago)</li>",
			c.GameName, c.IP, c.Mode, c.Drive, time.Since(c.Timestamp).Round(time.Second))
		return true
	})
	fmt.Fprintf(w, "</ul>")
}

// ==========================================
// FILE SERVING
// ==========================================

func (d *Deps) handleFileServe(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	relPath := strings.TrimPrefix(r.URL.Path, "/files/")
	if relPath == "" {
		jsonError(w, 404, "No file path specified")
		return
	}
	decodedPath, err := url.QueryUnescape(relPath)
	if err != nil {
		jsonError(w, 400, "Invalid file path encoding")
		return
	}
	fullPath := filepath.Join(d.App.ToolsDir, "Ready", decodedPath)

	absReady, _ := filepath.Abs(filepath.Join(d.App.ToolsDir, "Ready"))
	absPath, _ := filepath.Abs(fullPath)
	if !strings.HasPrefix(absPath, absReady) {
		jsonError(w, 403, "Access denied")
		return
	}

	info, err := os.Stat(fullPath)
	if os.IsNotExist(err) {
		jsonError(w, 404, fmt.Sprintf("File not found: %s", filepath.Base(decodedPath)))
		return
	}
	if err != nil {
		jsonError(w, 500, "Cannot access file")
		return
	}

	if info.IsDir() {
		entries, err := os.ReadDir(fullPath)
		if err != nil {
			jsonError(w, 500, "Cannot list directory")
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, "<html><body><h2>Index of /%s</h2><ul>", relPath)
		for _, e := range entries {
			name := e.Name()
			if e.IsDir() {
				name += "/"
			}
			fmt.Fprintf(w, "<li><a href=\"%s\">%s</a></li>", url.PathEscape(name), name)
		}
		fmt.Fprintf(w, "</ul></body></html>")
		return
	}

	file, err := os.Open(fullPath)
	if err != nil {
		jsonError(w, 500, "Cannot open file")
		return
	}
	defer file.Close()

	fileSize := info.Size()
	fileName := filepath.Base(fullPath)
	adviseFadvise(file, fileSize)

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", fileName))
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	if rh := r.Header.Get("Range"); rh != "" {
		start, end, err := parseRangeHeader(rh, fileSize)
		if err != nil {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", fileSize))
			w.WriteHeader(stdhttp.StatusRequestedRangeNotSatisfiable)
			return
		}
		cl := end - start + 1
		if _, err := file.Seek(start, 0); err != nil {
			jsonError(w, 500, "File seek error")
			return
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileSize))
		w.Header().Set("Content-Length", strconv.FormatInt(cl, 10))
		w.WriteHeader(stdhttp.StatusPartialContent)

		startTime := time.Now()
		bw := bufio.NewWriterSize(w, app.ServeBufferSize)
		written, err := io.CopyN(bw, file, cl)
		if flushErr := bw.Flush(); flushErr != nil && err == nil {
			err = flushErr
		}
		elapsed := time.Since(startTime).Seconds()
		if elapsed < 0.001 {
			elapsed = 0.001
		}
		if err != nil {
			d.App.Logf("FILE WARN: Range xfer interrupted %s after %.2f MB @ %.1f MB/s: %v",
				fileName, float64(written)/1048576, float64(written)/elapsed/1048576, err)
		}
		return
	}

	d.App.Logf("FILE: Sending %s (%.2f MB)", fileName, float64(fileSize)/1048576)
	startTime := time.Now()
	stdhttp.ServeContent(w, r, fileName, info.ModTime(), file)
	elapsed := time.Since(startTime).Seconds()
	if elapsed < 0.001 {
		elapsed = 0.001
	}
	d.App.Logf("FILE: Done %s (%.2f MB) in %.1fs @ %.1f MB/s",
		fileName, float64(fileSize)/1048576, elapsed, float64(fileSize)/elapsed/1048576)
}

func parseRangeHeader(header string, fileSize int64) (int64, int64, error) {
	if !strings.HasPrefix(header, "bytes=") {
		return 0, 0, fmt.Errorf("not a byte range: %s", header)
	}
	spec := strings.TrimPrefix(header, "bytes=")
	if strings.HasPrefix(spec, "-") {
		s, err := strconv.ParseInt(spec[1:], 10, 64)
		if err != nil || s <= 0 {
			return 0, 0, fmt.Errorf("bad suffix: %s", spec)
		}
		start := fileSize - s
		if start < 0 {
			start = 0
		}
		return start, fileSize - 1, nil
	}
	parts := strings.SplitN(spec, "-", 2)
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("bad format: %s", spec)
	}
	start, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, 0, fmt.Errorf("bad start: %s", parts[0])
	}
	var end int64
	if parts[1] == "" {
		end = fileSize - 1
	} else {
		end, err = strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			return 0, 0, fmt.Errorf("bad end: %s", parts[1])
		}
	}
	if start < 0 || start >= fileSize {
		return 0, 0, fmt.Errorf("start %d out of range (size %d)", start, fileSize)
	}
	if end < start {
		return 0, 0, fmt.Errorf("end %d < start %d", end, start)
	}
	if end >= fileSize {
		end = fileSize - 1
	}
	return start, end, nil
}

func adviseFadvise(f *os.File, size int64) {}
