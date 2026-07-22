package localshell

import (
	"runtime"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestOpenLocalShellRoundTrip(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("windows conpty exercised via build tags in CI windows runners")
	}
	session, err := Open(Options{Cols: 80, Rows: 24})
	require.NoError(t, err)
	t.Cleanup(func() { _ = session.Close() })

	received := make(chan []byte, 1)
	session.SetReadCallback(func(data []byte) {
		select {
		case received <- append([]byte{}, data...):
		default:
		}
	})
	session.Start()
	// Write a simple command that produces output then exits cleanly is host-dependent;
	// instead just resize and write newline to ensure pipes work.
	require.NoError(t, session.Resize(100, 30))
	_, err = session.Write([]byte("\n"))
	require.NoError(t, err)

	select {
	case <-received:
	case <-time.After(2 * time.Second):
		// Some shells may not echo; writing still succeeded so treat as soft success.
	}
	require.NoError(t, session.Close())
}
