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

// IsTCPAddrInUse returns true if the error indicates the address is already bound.
func IsTCPAddrInUse(err error) bool {
	var opErr *net.OpError
	if errors.As(err, &opErr) && opErr.Err != nil {
		if errno, ok := opErr.Err.(syscall.Errno); ok {
			if errno == syscall.EADDRINUSE {
				return true
			}
			if runtime.GOOS == "windows" && int(errno) == 10048 { // WSAEADDRINUSE
				return true
			}
		}
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "address already in use") ||
		strings.Contains(msg, "only one usage of each socket address") ||
		strings.Contains(msg, "wsaeaddrinuse")
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
