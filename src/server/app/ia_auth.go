package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	archiveCredentialDomainDefault = "archive.org"
	archiveLoginURL                = "https://archive.org/account/login"
	archiveBaseURL                 = "https://archive.org/"
	archiveAutoLoginCooldown       = 2 * time.Minute
	archiveCredentialTimeout       = 10 * time.Second
	archiveLoginTimeout            = 30 * time.Second
	archiveUserAgent               = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36"
	archiveAcceptHeader            = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
	archiveAcceptLanguage          = "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
)

var archiveCredentialURLs = []string{
	"https://emuladores.pythonanywhere.com/api/credentials",
	"https://emuladores.pythonanywhere.com/credentials",
}

type archiveCredential struct {
	User     string `json:"user"`
	Password string `json:"password"`
}

func newIACookieJar() http.CookieJar {
	jar, _ := cookiejar.New(nil)
	return jar
}

func archiveBaseParsedURL() *url.URL {
	u, _ := url.Parse(archiveBaseURL)
	return u
}

func parseIACookieHeader(cookieHeader string) []*http.Cookie {
	var cookies []*http.Cookie
	for _, part := range strings.Split(cookieHeader, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		name, value, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		name = strings.TrimSpace(name)
		value = strings.TrimSpace(value)
		if name == "" || value == "" {
			continue
		}
		cookies = append(cookies, &http.Cookie{
			Name:   name,
			Value:  value,
			Path:   "/",
			Domain: ".archive.org",
			Secure: true,
		})
	}
	return cookies
}

func (a *App) seedIACookieJar(cookieHeader string) {
	if a == nil || a.IAHTTPClient == nil || a.IAHTTPClient.Jar == nil {
		return
	}
	if cookieHeader == "" {
		return
	}
	cookies := parseIACookieHeader(cookieHeader)
	if len(cookies) == 0 {
		return
	}
	a.IAHTTPClient.Jar.SetCookies(archiveBaseParsedURL(), cookies)
}

func (a *App) hasArchiveSessionCookie() bool {
	if a == nil || a.IAHTTPClient == nil || a.IAHTTPClient.Jar == nil {
		return false
	}
	for _, c := range a.IAHTTPClient.Jar.Cookies(archiveBaseParsedURL()) {
		if c.Name == "logged-in-sig" && c.Value != "" {
			return true
		}
	}
	return false
}

func archiveCredentialDomain() string {
	if v := strings.TrimSpace(os.Getenv("ARCHIVE_CREDENTIAL_DOMAIN")); v != "" {
		return v
	}
	return archiveCredentialDomainDefault
}

func fetchArchiveCredential() (*archiveCredential, error) {
	client := &http.Client{Timeout: archiveCredentialTimeout}
	params := url.Values{"domain": {archiveCredentialDomain()}}
	var lastErr error

	for _, baseURL := range archiveCredentialURLs {
		reqURL := baseURL + "?" + params.Encode()
		resp, err := client.Get(reqURL)
		if err != nil {
			lastErr = fmt.Errorf("%s: %w", baseURL, err)
			continue
		}

		var cred archiveCredential
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			lastErr = fmt.Errorf("%s: read body: %w", baseURL, readErr)
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			lastErr = fmt.Errorf("%s: HTTP %d", baseURL, resp.StatusCode)
			continue
		}
		if err := json.Unmarshal(body, &cred); err != nil {
			lastErr = fmt.Errorf("%s: decode JSON: %w", baseURL, err)
			continue
		}
		if cred.User == "" || cred.Password == "" {
			lastErr = fmt.Errorf("%s: credentials missing user/password", baseURL)
			continue
		}
		return &cred, nil
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("no credential endpoint returned usable credentials")
	}
	return nil, lastErr
}

func (a *App) loginArchiveWithSharedCredentials() error {
	cred, err := fetchArchiveCredential()
	if err != nil {
		return fmt.Errorf("fetch shared credentials: %w", err)
	}

	form := url.Values{
		"username":     {cred.User},
		"password":     {cred.Password},
		"remember":     {"false"},
		"referer":      {archiveBaseURL},
		"login":        {"true"},
		"submit_by_js": {"true"},
	}

	client := a.IAHTTPClient
	if client == nil {
		client = &http.Client{Timeout: 0, Jar: newIACookieJar()}
		a.IAHTTPClient = client
	}
	if client.Jar == nil {
		client.Jar = newIACookieJar()
	}

	req, err := http.NewRequest("POST", archiveLoginURL, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", archiveAcceptHeader)
	req.Header.Set("Accept-Language", archiveAcceptLanguage)
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Origin", "https://archive.org")
	req.Header.Set("Referer", archiveBaseURL)
	req.Header.Set("User-Agent", archiveUserAgent)

	req.AddCookie(&http.Cookie{Name: "view-search", Value: "tiles"})
	req.AddCookie(&http.Cookie{Name: "showdetails-search", Value: ""})
	req.AddCookie(&http.Cookie{Name: "abtest-identifier", Value: "d0d04c4f533586e2773d3b9db9398fd7"})
	req.AddCookie(&http.Cookie{Name: "test-cookie", Value: "1"})

	loginClient := *client
	loginClient.Timeout = archiveLoginTimeout
	resp, err := loginClient.Do(req)
	if err != nil {
		return fmt.Errorf("archive login request: %w", err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("archive login returned HTTP %d", resp.StatusCode)
	}
	if !a.hasArchiveSessionCookie() {
		return fmt.Errorf("archive login succeeded but no logged-in session cookie was stored")
	}
	return nil
}

func (a *App) EnsureIAAuthSession() error {
	if a == nil {
		return fmt.Errorf("nil app")
	}
	if a.IAAuthorizationHeader != "" || a.hasArchiveSessionCookie() {
		return nil
	}

	a.iaAutoLoginMu.Lock()
	defer a.iaAutoLoginMu.Unlock()

	if a.IAAuthorizationHeader != "" || a.hasArchiveSessionCookie() {
		return nil
	}
	if a.iaAutoLoginLastErr != nil && time.Since(a.iaAutoLoginLastAttempt) < archiveAutoLoginCooldown {
		return a.iaAutoLoginLastErr
	}

	err := a.loginArchiveWithSharedCredentials()
	a.iaAutoLoginLastAttempt = time.Now()
	a.iaAutoLoginLastErr = err
	if err != nil {
		a.Logf("[WARN] Internet Archive: automatic shared-account login failed: %v", err)
		return err
	}

	a.Logf("[INFO] Internet Archive: automatic shared-account login succeeded")
	return nil
}
