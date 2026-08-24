package app

import (
	"errors"
	"fmt"
	"net"
	"os"
	"runtime"
	"syscall"
	"testing"
)

func TestListenOnAvailablePortDefaultsToLoopback(t *testing.T) {
	a := NewApp()
	listener, _, err := a.ListenOnAvailablePort(53000)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	tcpAddr, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("unexpected address type %T", listener.Addr())
	}
	if !tcpAddr.IP.IsLoopback() {
		t.Fatalf("default listener is not loopback: %s", tcpAddr.IP)
	}
}

func TestListenOnAvailablePortAtRejectsInvalidHost(t *testing.T) {
	a := NewApp()
	if _, _, err := a.ListenOnAvailablePortAt("not a valid host", 53000); err == nil {
		t.Fatal("expected invalid host to be rejected")
	}
}

func TestListenOnAvailablePortAtHopsOverOccupiedPort(t *testing.T) {
	a := NewApp()
	// Bind to an initial port
	basePort := 53500
	l1, chosenPort1, err := a.ListenOnAvailablePortAt("127.0.0.1", basePort)
	if err != nil {
		t.Fatalf("failed to bind initial port: %v", err)
	}
	defer l1.Close()

	// Attempting to listen starting at chosenPort1 must automatically hop to chosenPort1 + 1
	l2, chosenPort2, err := a.ListenOnAvailablePortAt("127.0.0.1", chosenPort1)
	if err != nil {
		t.Fatalf("failed to hop to next available port: %v", err)
	}
	defer l2.Close()

	if chosenPort2 <= chosenPort1 {
		t.Errorf("expected chosenPort2 (%d) > chosenPort1 (%d)", chosenPort2, chosenPort1)
	}
}

func TestIsTCPAddrInUse(t *testing.T) {
	// Test nil error
	if IsTCPAddrInUse(nil) {
		t.Error("expected nil to return false")
	}

	// Test standard POSIX errnos
	posixErrs := []syscall.Errno{
		syscall.EADDRINUSE,
		syscall.EACCES,
		syscall.EPERM,
	}
	for _, e := range posixErrs {
		if !IsTCPAddrInUse(e) {
			t.Errorf("expected errno %v to be recognized as in-use/restricted", e)
		}
	}

	// Test wrapped syscall.EADDRINUSE inside *os.SyscallError
	sysErr := &os.SyscallError{
		Syscall: "bind",
		Err:     syscall.EADDRINUSE,
	}
	if !IsTCPAddrInUse(sysErr) {
		t.Error("expected wrapped EADDRINUSE to be in use")
	}

	// Test net.OpError wrapping SyscallError wrapping EADDRINUSE
	opErr := &net.OpError{
		Op:  "listen",
		Net: "tcp",
		Err: sysErr,
	}
	if !IsTCPAddrInUse(opErr) {
		t.Error("expected net.OpError wrapping SyscallError wrapping EADDRINUSE to be in use")
	}

	// Test net.OpError wrapping SyscallError with Windows WSAEADDRINUSE (10048) and WSAEACCES (10013)
	for _, code := range []int{10048, 10013, 10049, 5, 32} {
		wsaErr := &net.OpError{
			Op:  "listen",
			Net: "tcp",
			Err: &os.SyscallError{
				Syscall: "bind",
				Err:     syscall.Errno(code),
			},
		}
		if runtime.GOOS == "windows" {
			if !IsTCPAddrInUse(wsaErr) {
				t.Errorf("expected Windows errno %d wrapped in OpError to match", code)
			}
		}
	}

	if runtime.GOOS == "windows" {
		// Test raw Windows errnos
		for _, code := range []int{10048, 10013, 10049, 5, 32} {
			if !IsTCPAddrInUse(syscall.Errno(code)) {
				t.Errorf("expected Windows raw errno %d to match", code)
			}
		}
	}

	// Test string fallbacks in multiple languages
	stringTestCases := []struct {
		name string
		msg  string
	}{
		{"English in-use", "listen tcp 127.0.0.1:8080: bind: address already in use"},
		{"English socket usage", "listen tcp 127.0.0.1:8080: bind: Only one usage of each socket address (protocol/network address/port) is normally permitted."},
		{"English WSAEADDRINUSE", "bind: WSAEADDRINUSE"},
		{"English WSAEACCES", "bind: WSAEACCES"},
		{"English permission denied", "listen tcp 127.0.0.1:80: bind: permission denied"},
		{"English access denied", "bind: Access is denied."},
		{"Portuguese WSAEACCES", "Listen failed on host 127.0.0.1 port 8080: listen 127.0.0.1:8080: listen tcp 127.0.0.1:8080: bind: Foi feita uma tentativa de acesso a um soquete de uma maneira que é proibida pelas permissões de acesso."},
		{"Portuguese WSAEADDRINUSE", "Listen failed on host 127.0.0.1 port 8080: listen 127.0.0.1:8080: listen tcp 127.0.0.1:8080: bind: Normalmente é permitida apenas uma utilização de cada endereço de soquete (protocolo/endereço de rede/porta)."},
		{"Portuguese endereço em uso", "bind: Endereço já em uso"},
		{"Portuguese acesso negado", "bind: Acesso negado"},
		{"Portuguese permissão negada", "bind: Permissão negada"},
		{"Spanish uso de dirección", "bind: Sólo se permite un uso de cada dirección de socket (protocolo/dirección de red/puerto)."},
		{"Spanish direccion ya en uso", "bind: Dirección ya en uso"},
		{"Spanish acceso denegado", "bind: Acceso denegado"},
		{"French seule utilisation", "bind: Une seule utilisation de chaque adresse de socket est normalement autorisée."},
		{"French adresse déjà utilisée", "bind: Adresse déjà utilisée"},
		{"French accès refusé", "bind: Accès refusé"},
		{"German socketadresse", "bind: Normalerweise darf jede Socketadresse (Protokoll/Netzwerkadresse/Port) nur jeweils einmal verwendet werden."},
		{"German adresse verwendet", "bind: Adresse wird bereits verwendet"},
		{"German zugriff verweigert", "bind: Zugriff verweigert"},
		{"Italian un solo utilizzo", "bind: In genere è consentito un solo utilizzo di ogni indirizzo di socket."},
		{"Italian indirizzo in uso", "bind: Indirizzo già in uso"},
		{"Italian accesso negato", "bind: Accesso negato"},
		{"Numeric 10048", "bind error code 10048"},
		{"Numeric 10013", "bind error code 10013"},
	}

	for _, tc := range stringTestCases {
		t.Run(tc.name, func(t *testing.T) {
			if !IsTCPAddrInUse(errors.New(tc.msg)) {
				t.Errorf("expected string pattern %q to match", tc.msg)
			}
		})
	}

	// Test non-related error
	if IsTCPAddrInUse(errors.New("some unrelated network error")) {
		t.Error("expected unrelated error not to be matched")
	}
	if IsTCPAddrInUse(fmt.Errorf("connection reset by peer")) {
		t.Error("expected connection reset not to be matched")
	}
}

