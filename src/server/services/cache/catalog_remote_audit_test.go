package cache

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"godsend/app"
	torrentService "godsend/infrastructure/torrent"
	"godsend/models"
)

type remoteArtifact struct {
	game string
	url  string
}

// TestRemoteXbox360CatalogArtifacts is an opt-in network audit. It checks every
// packaged Xbox 360 entry against the provider's current authoritative index
// without downloading the multi-gigabyte game payloads.
func TestRemoteXbox360CatalogArtifacts(t *testing.T) {
	if os.Getenv("GODSEND_REMOTE_CATALOG_AUDIT") != "1" {
		t.Skip("set GODSEND_REMOTE_CATALOG_AUDIT=1 to verify all remote catalog artifacts")
	}

	repoRoot, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	readJSON := func(name string, target any) {
		data, readErr := os.ReadFile(filepath.Join(repoRoot, "cache", name))
		if readErr != nil {
			t.Fatal(readErr)
		}
		if decodeErr := json.Unmarshal(data, target); decodeErr != nil {
			t.Fatalf("decode %s: %v", name, decodeErr)
		}
	}

	var iaCache models.PlatformCache
	var hfCache models.PlatformCache
	var minervaCache models.MinervaPlatformCache
	readJSON("xbox360.json", &iaCache)
	readJSON("hf_xbox360.json", &hfCache)
	readJSON("minerva_xbox360.json", &minervaCache)

	a := app.NewApp()
	ia := &IAService{App: a}
	collectionEntries := make(map[string]map[string]struct{})
	var collectionMu sync.Mutex
	getCollection := func(collectionID string) (map[string]struct{}, error) {
		collectionMu.Lock()
		cached := collectionEntries[collectionID]
		collectionMu.Unlock()
		if cached != nil {
			return cached, nil
		}
		entries, fetchErr := ia.DoIAMetaFetch(collectionID)
		if fetchErr != nil {
			return nil, fetchErr
		}
		files := make(map[string]struct{}, len(entries))
		for _, entry := range entries {
			files[entry.FileName] = struct{}{}
		}
		collectionMu.Lock()
		collectionEntries[collectionID] = files
		collectionMu.Unlock()
		return files, nil
	}

	var failures []string
	for key, entry := range iaCache.GameEntries {
		files, fetchErr := getCollection(entry.CollectionID)
		if fetchErr != nil {
			failures = append(failures, fmt.Sprintf("IA %q: collection %s: %v", key, entry.CollectionID, fetchErr))
			continue
		}
		if _, ok := files[entry.FileName]; !ok {
			failures = append(failures, fmt.Sprintf("IA %q: %s/%s is absent", key, entry.CollectionID, entry.FileName))
		}
	}

	var directArtifacts []remoteArtifact
	for key, entry := range hfCache.GameEntries {
		parsed, parseErr := url.Parse(entry.FileName)
		if parseErr != nil {
			failures = append(failures, fmt.Sprintf("HuggingFace %q: invalid URL %q", key, entry.FileName))
			continue
		}
		switch strings.ToLower(parsed.Hostname()) {
		case "archive.org":
			escaped := strings.TrimPrefix(parsed.EscapedPath(), "/download/")
			parts := strings.SplitN(escaped, "/", 2)
			if len(parts) != 2 {
				failures = append(failures, fmt.Sprintf("HuggingFace %q: malformed Archive URL %q", key, entry.FileName))
				continue
			}
			collectionID, collectionErr := url.PathUnescape(parts[0])
			fileName, fileErr := url.PathUnescape(parts[1])
			if collectionErr != nil || fileErr != nil {
				failures = append(failures, fmt.Sprintf("HuggingFace %q: malformed escaped path %q", key, entry.FileName))
				continue
			}
			files, fetchErr := getCollection(collectionID)
			if fetchErr != nil {
				failures = append(failures, fmt.Sprintf("HuggingFace %q: collection %s: %v", key, collectionID, fetchErr))
				continue
			}
			if _, ok := files[fileName]; !ok {
				failures = append(failures, fmt.Sprintf("HuggingFace %q: %s/%s is absent", key, collectionID, fileName))
			}
		case "huggingface.co":
			directArtifacts = append(directArtifacts, remoteArtifact{game: key, url: entry.FileName})
		default:
			failures = append(failures, fmt.Sprintf("HuggingFace %q: unsupported host %q", key, parsed.Hostname()))
		}
	}

	probeFailures := probeRemoteArtifacts(directArtifacts)
	failures = append(failures, probeFailures...)

	uniqueMinerva := make(map[string]models.MinervaEntry)
	for _, entry := range minervaCache.Entries {
		uniqueMinerva[strings.ToLower(entry.FileName)] = entry
	}
	minervaEntries := make([]models.MinervaEntry, 0, len(uniqueMinerva))
	for _, entry := range uniqueMinerva {
		minervaEntries = append(minervaEntries, entry)
	}
	validator := &torrentService.Service{App: a}
	validMinerva, missingMinerva, validateErr := validator.ValidateMinervaEntries("xbox360", minervaEntries)
	if validateErr != nil {
		failures = append(failures, "Minerva torrent validation: "+validateErr.Error())
	} else {
		for _, missing := range missingMinerva {
			failures = append(failures, "Minerva torrent missing: "+missing)
		}
	}

	if len(failures) > 0 {
		sort.Strings(failures)
		limit := len(failures)
		if limit > 100 {
			limit = 100
		}
		t.Fatalf("%d remote catalog artifact(s) failed validation; first %d:\n%s", len(failures), limit, strings.Join(failures[:limit], "\n"))
	}
	t.Logf("remote audit passed: IA=%d, HuggingFace=%d (%d direct probes), Minerva=%d", len(iaCache.GameEntries), len(hfCache.GameEntries), len(directArtifacts), len(validMinerva))
}

func probeRemoteArtifacts(artifacts []remoteArtifact) []string {
	const workers = 12
	jobs := make(chan remoteArtifact)
	results := make(chan string, len(artifacts))
	client := &http.Client{Timeout: 45 * time.Second}
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for artifact := range jobs {
				var lastErr error
				for attempt := 0; attempt < 3; attempt++ {
					req, err := http.NewRequest(http.MethodHead, artifact.url, nil)
					if err == nil {
						req.Header.Set("User-Agent", "Xbox-360-Companion-Catalog-Audit/1.0")
						resp, requestErr := client.Do(req)
						if requestErr == nil {
							resp.Body.Close()
							if resp.StatusCode == http.StatusOK && resp.ContentLength > 0 {
								lastErr = nil
								break
							}
							lastErr = fmt.Errorf("HTTP %d, content-length=%d", resp.StatusCode, resp.ContentLength)
						} else {
							lastErr = requestErr
						}
					} else {
						lastErr = err
					}
					time.Sleep(time.Duration(attempt+1) * time.Second)
				}
				if lastErr != nil {
					results <- fmt.Sprintf("HuggingFace %q: %s: %v", artifact.game, artifact.url, lastErr)
				}
			}
		}()
	}
	go func() {
		for _, artifact := range artifacts {
			jobs <- artifact
		}
		close(jobs)
		wg.Wait()
		close(results)
	}()
	var failures []string
	for failure := range results {
		failures = append(failures, failure)
	}
	return failures
}
