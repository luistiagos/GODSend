// listen.go — TCP listener helpers for server startup.
package app

import (
	"errors"
	"fmt"
	"net"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

// IsTCPAddrInUse returns true if the error indicates the address is already bound or restricted.
func IsTCPAddrInUse(err error) bool {
	if err == nil {
		return false
	}
	var errno syscall.Errno
	if errors.As(err, &errno) {
		if errno == syscall.EADDRINUSE || errno == syscall.EACCES || errno == syscall.EPERM {
			return true
		}
		if runtime.GOOS == "windows" {
			// WSAEADDRINUSE (10048), WSAEACCES (10013), WSAEADDRNOTAVAIL (10049),
			// ERROR_ACCESS_DENIED (5), ERROR_SHARING_VIOLATION (32)
			code := int(errno)
			if code == 10048 || code == 10013 || code == 10049 || code == 5 || code == 32 {
				return true
			}
		}
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "address already in use") ||
		strings.Contains(msg, "only one usage of each socket address") ||
		strings.Contains(msg, "wsaeaddrinuse") ||
		strings.Contains(msg, "wsaeacces") ||
		strings.Contains(msg, "wsaeaddrnotavail") ||
		strings.Contains(msg, "eaddrinuse") ||
		strings.Contains(msg, "eacces") ||
		strings.Contains(msg, "permission denied") ||
		strings.Contains(msg, "access is denied") ||
		strings.Contains(msg, "cannot assign requested address") ||
		strings.Contains(msg, "10048") ||
		strings.Contains(msg, "10013") ||
		strings.Contains(msg, "10049") ||
		// Portuguese (Win32 localized)
		strings.Contains(msg, "permissões de acesso") ||
		strings.Contains(msg, "permissoes de acesso") ||
		strings.Contains(msg, "tentativa de acesso a um soquete") ||
		strings.Contains(msg, "proibida pelas permissões") ||
		strings.Contains(msg, "proibida pelas permissoes") ||
		strings.Contains(msg, "utilização de cada endereço") ||
		strings.Contains(msg, "utilizacao de cada endereco") ||
		strings.Contains(msg, "endereço já em uso") ||
		strings.Contains(msg, "endereco ja em uso") ||
		strings.Contains(msg, "endereço de soquete") ||
		strings.Contains(msg, "endereco de soquete") ||
		strings.Contains(msg, "acesso negado") ||
		strings.Contains(msg, "permissão negada") ||
		strings.Contains(msg, "permissao negada") ||
		strings.Contains(msg, "não é válido no contexto dele") ||
		strings.Contains(msg, "nao e valido no contexto dele") ||
		// Spanish (Win32 localized)
		strings.Contains(msg, "sólo se permite un uso") ||
		strings.Contains(msg, "solo se permite un uso") ||
		strings.Contains(msg, "dirección ya en uso") ||
		strings.Contains(msg, "direccion ya en uso") ||
		strings.Contains(msg, "permisos de acceso") ||
		strings.Contains(msg, "acceso denegado") ||
		strings.Contains(msg, "permiso denegado") ||
		// French (Win32 localized)
		strings.Contains(msg, "une seule utilisation") ||
		strings.Contains(msg, "adresse déjà utilisée") ||
		strings.Contains(msg, "adresse deja utilisee") ||
		strings.Contains(msg, "autorisations d'accès") ||
		strings.Contains(msg, "autorisations d'acces") ||
		strings.Contains(msg, "accès refusé") ||
		strings.Contains(msg, "acces refuse") ||
		// German (Win32 localized)
		strings.Contains(msg, "normalerweise darf jede socketadresse") ||
		strings.Contains(msg, "adresse wird bereits verwendet") ||
		strings.Contains(msg, "zugriffsberechtigungen") ||
		strings.Contains(msg, "zugriff verweigert") ||
		// Italian (Win32 localized)
		strings.Contains(msg, "un solo utilizzo di ogni indirizzo") ||
		strings.Contains(msg, "indirizzo già in uso") ||
		strings.Contains(msg, "indirizzo gia in uso") ||
		strings.Contains(msg, "autorizzazioni di accesso") ||
		strings.Contains(msg, "accesso negato")
}

// ListenOnAvailablePort binds to loopback by default. Network exposure must be
// an explicit caller decision through ListenOnAvailablePortAt.
func (a *App) ListenOnAvailablePort(start int) (net.Listener, int, error) {
	return a.ListenOnAvailablePortAt("127.0.0.1", start)
}

// ListenOnAvailablePortAt binds to host:start, then start+1, … until success
// or a non–address-in-use error.
func (a *App) ListenOnAvailablePortAt(host string, start int) (net.Listener, int, error) {
	if start < 1 || start > 65535 {
		return nil, 0, fmt.Errorf("invalid start port %d", start)
	}
	host = strings.TrimSpace(host)
	if host == "" {
		host = "127.0.0.1"
	}
	if host != "localhost" && net.ParseIP(host) == nil {
		return nil, 0, fmt.Errorf("invalid listen host %q", host)
	}
	for p := start; p <= 65535; p++ {
		addr := net.JoinHostPort(host, strconv.Itoa(p))
		ln, err := net.Listen("tcp", addr)
		if err == nil {
			return ln, p, nil
		}
		if !IsTCPAddrInUse(err) {
			return nil, 0, fmt.Errorf("listen %s: %w", addr, err)
		}
		a.Logf("[WARN] TCP port %d in use, trying %d", p, p+1)
	}
	return nil, 0, fmt.Errorf("no free TCP port from %d through 65535", start)
}

// GetOutboundIP returns this machine's LAN IP address.
func GetOutboundIP() string {
	c, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return ""
	}
	defer c.Close()
	if a, ok := c.LocalAddr().(*net.UDPAddr); ok {
		return a.IP.String()
	}
	return ""
}
