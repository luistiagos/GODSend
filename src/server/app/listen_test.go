package app

import (
	"errors"
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

func TestIsTCPAddrInUse(t *testing.T) {
	// Test standard syscall.EADDRINUSE
	if !IsTCPAddrInUse(syscall.EADDRINUSE) {
		t.Error("expected EADDRINUSE to be in use")
	}

	// Test wrapped syscall.EADDRINUSE inside *os.SyscallError
	sysErr := &os.SyscallError{
		Syscall: "bind",
		Err:     syscall.EADDRINUSE,
	}
	if !IsTCPAddrInUse(sysErr) {
		t.Error("expected wrapped EADDRINUSE to be in use")
	}

	// Test net.OpError wrapping SyscallError
	opErr := &net.OpError{
		Op:  "listen",
		Net: "tcp",
		Err: sysErr,
	}
	if !IsTCPAddrInUse(opErr) {
		t.Error("expected net.OpError wrapping SyscallError wrapping EADDRINUSE to be in use")
	}

	if runtime.GOOS == "windows" {
		// Test WSAEADDRINUSE (10048) on Windows
		wsaErr := syscall.Errno(10048)
		if !IsTCPAddrInUse(wsaErr) {
			t.Error("expected WSAEADDRINUSE to be in use")
		}

		// Test WSAEACCES (10013) on Windows
		wsaAccess := syscall.Errno(10013)
		if !IsTCPAddrInUse(wsaAccess) {
			t.Error("expected WSAEACCES to be in use")
		}
	}

	// Test string fallbacks
	if !IsTCPAddrInUse(errors.New("address already in use")) {
		t.Error("expected string 'address already in use' to match")
	}
	if !IsTCPAddrInUse(errors.New("bind: Foi feita uma tentativa de acesso a um soquete de uma maneira que é proibida pelas permissões de acesso.")) {
		t.Error("expected Portuguese WSAEACCES string to match")
	}
	if !IsTCPAddrInUse(errors.New("bind: Normalmente é permitida apenas uma utilização de cada endereço de soquete (protocolo/endereço de rede/porta).")) {
		t.Error("expected Portuguese WSAEADDRINUSE string to match")
	}

	// Test non-related error
	if IsTCPAddrInUse(errors.New("some other error")) {
		t.Error("expected unrelated error not to be matched")
	}
}
