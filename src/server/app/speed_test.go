package app

import (
	"testing"
)

func TestParseSpeedBytes(t *testing.T) {
	tests := []struct {
		input    string
		expected int64
		hasErr   bool
	}{
		{"0", 0, false},
		{"", 0, false},
		{"none", 0, false},
		{"off", 0, false},
		{"disable", 0, false},
		{"disabled", 0, false},
		{"500K", 500 * 1024, false},
		{"500KB", 500 * 1024, false},
		{"500kib", 500 * 1024, false},
		{"1M", 1024 * 1024, false},
		{"1MB", 1024 * 1024, false},
		{"1.5M", int64(1.5 * 1024 * 1024), false},
		{"2G", 2 * 1024 * 1024 * 1024, false},
		{"2GB", 2 * 1024 * 1024 * 1024, false},
		{"1048576", 1048576, false},
		{"invalid_str", 0, true},
		{"-500", 0, true},
	}

	for _, tc := range tests {
		got, err := ParseSpeedBytes(tc.input)
		if tc.hasErr {
			if err == nil {
				t.Fatalf("expected error for %q, got nil", tc.input)
			}
		} else {
			if err != nil {
				t.Fatalf("unexpected error for %q: %v", tc.input, err)
			}
			if got != tc.expected {
				t.Fatalf("for %q, expected %d, got %d", tc.input, tc.expected, got)
			}
		}
	}
}

func TestSpeedCheckBypass(t *testing.T) {
	a := NewApp()
	game := "Test Game 123"

	if a.IsSpeedCheckBypassed(game) {
		t.Fatal("expected game speed check not to be bypassed initially")
	}

	a.SetSpeedCheckBypass(game, true)
	if !a.IsSpeedCheckBypassed(game) {
		t.Fatal("expected game speed check to be bypassed after SetSpeedCheckBypass(true)")
	}

	a.SetSpeedCheckBypass(game, false)
	if a.IsSpeedCheckBypassed(game) {
		t.Fatal("expected game speed check not to be bypassed after SetSpeedCheckBypass(false)")
	}
}
