package telemetry

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"runtime"
	"sync"
	"time"
)

var (
	enabled   = true
	endpoint  = "https://digitalstoregames.pythonanywhere.com/logErr"
	seenCache sync.Map
	initOnce  sync.Once
)

type ErrorReport struct {
	Project   string   `json:"project"`
	File      string   `json:"file"`
	Method    string   `json:"method"`
	Message   string   `json:"message"`
	UserAgent string   `json:"user_agent"`
	Platform  string   `json:"platform"`
	Screen    string   `json:"screen"`
	PageURL   string   `json:"page_url"`
	Logs      []string `json:"logs"`
}

// Initialize sets the telemetry enabled flag and optional custom endpoint.
func Initialize(telemetryEnabled bool, telemetryEndpoint string) {
	initOnce.Do(func() {
		enabled = telemetryEnabled
		if telemetryEndpoint != "" {
			endpoint = telemetryEndpoint
		}
	})
}

// Report reports an error to the telemetry endpoint.
// It is fully guarded by recovers to ensure it never crashes or blocks the app.
func Report(component, file, method, message, pageURL string, logs []string, terminal bool) {
	defer func() { recover() }() // Guard against any panics in formatting/checking

	if !enabled {
		return
	}

	// Dedup check to avoid flooding the service with the same error in the same session
	key := fmt.Sprintf("%s|%s", component, message)
	if _, loaded := seenCache.LoadOrStore(key, true); loaded {
		return
	}

	// Cap message length to 4000 characters
	if len(message) > 4000 {
		message = message[:4000]
	}

	// Cap log entries to max 20, and max 256KB per log entry (retaining the end/tail)
	cappedLogs := make([]string, 0, len(logs))
	for i, log := range logs {
		if i >= 20 {
			break
		}
		cappedLogs = append(cappedLogs, capLog(log))
	}

	report := ErrorReport{
		Project:   "xbox-360-companion/" + component,
		File:      file,
		Method:    method,
		Message:   message,
		UserAgent: component,
		Platform:  fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH),
		Screen:    "",
		PageURL:   pageURL,
		Logs:      cappedLogs,
	}

	if terminal {
		send(report)
	} else {
		go send(report)
	}
}

func capLog(log string) string {
	const maxLogBytes = 256 * 1024
	if len(log) > maxLogBytes {
		return log[len(log)-maxLogBytes:]
	}
	return log
}

func send(report ErrorReport) {
	// Try POST first
	success := sendPost(report)
	if !success {
		// Fallback to GET
		sendGet(report)
	}
}

func sendPost(report ErrorReport) bool {
	defer func() { recover() }() // Best-effort: ignore all panics

	data, err := json.Marshal(report)
	if err != nil {
		return false
	}

	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(data))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode == http.StatusOK
}

func sendGet(report ErrorReport) {
	defer func() { recover() }() // Best-effort: ignore all panics

	u, err := url.Parse(endpoint)
	if err != nil {
		return
	}

	q := u.Query()
	q.Set("project", report.Project)
	q.Set("file", report.File)
	q.Set("method", report.Method)
	q.Set("message", report.Message)
	q.Set("user_agent", report.UserAgent)
	q.Set("platform", report.Platform)
	q.Set("screen", report.Screen)
	q.Set("page_url", report.PageURL)
	u.RawQuery = q.Encode()

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(u.String())
	if err == nil {
		resp.Body.Close()
	}
}
