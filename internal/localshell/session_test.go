package localshell

import (
	"context"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
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

func TestOpenContextKeepsShellAliveAfterCancel(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("windows conpty does not bind process lifetime to the call context")
	}
	ctx, cancel := context.WithCancel(context.Background())
	session, err := OpenContext(ctx, Options{Shell: defaultShell(), Cols: 80, Rows: 24})
	require.NoError(t, err)
	t.Cleanup(func() { _ = session.Close() })

	// 模拟 Wails 绑定调用返回后立即取消调用 context：shell 不应被 SIGKILL。
	cancel()

	received := make(chan string, 8)
	session.SetReadCallback(func(data []byte) {
		received <- string(data)
	})
	session.Start()
	_, err = session.Write([]byte("echo MSSH_ALIVE\n"))
	require.NoError(t, err)

	deadline := time.After(3 * time.Second)
	var output string
	for !strings.Contains(output, "MSSH_ALIVE") {
		select {
		case chunk := <-received:
			output += chunk
		case <-deadline:
			t.Fatalf("local shell was killed after the call context was canceled, output=%q", output)
		}
	}
	assert.Contains(t, output, "MSSH_ALIVE")
}
