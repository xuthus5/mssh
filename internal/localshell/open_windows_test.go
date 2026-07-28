//go:build windows

package localshell

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/windows"
)

func TestComposeWindowsCommandLineRoundTripsArguments(t *testing.T) {
	shell := `C:\Program Files\PowerShell\7\pwsh.exe`
	args := []string{`--profile`, `C:\Users\alice\Documents\PowerShell\`, `say "hi"`, ""}
	commandLine := composeWindowsCommandLine(shell, args)
	decomposed, err := windows.DecomposeCommandLine(commandLine)
	require.NoError(t, err)
	assert.Equal(t, append([]string{shell}, args...), decomposed)
}
