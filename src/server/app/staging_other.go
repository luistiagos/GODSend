//go:build !windows

package app

// bestFixedVolume is Windows-only; elsewhere the default staging path under
// ToolsDir is kept unchanged.
func bestFixedVolume() string { return "" }
