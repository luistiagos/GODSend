package app

import (
	"net"
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
