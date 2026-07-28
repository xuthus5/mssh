//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package service

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"
)

func TestUserSelectedFileReadersRejectFIFOWithoutBlocking(t *testing.T) {
	readers := map[string]func(string) error{
		"private key": func(path string) error {
			_, err := readPrivateKeyFile(path)
			return err
		},
		"session csv": func(path string) error {
			_, err := readSessionCSVRecords(path)
			return err
		},
		"local backup": func(path string) error {
			_, err := readLocalBackup(path)
			return err
		},
	}
	for name, reader := range readers {
		t.Run(name, func(t *testing.T) {
			assertReaderRejectsFIFO(t, reader)
		})
	}
}

func assertReaderRejectsFIFO(t *testing.T, reader func(string) error) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "input.fifo")
	require.NoError(t, unix.Mkfifo(path, 0o600))
	result := make(chan error, 1)
	go func() { result <- reader(path) }()

	select {
	case err := <-result:
		require.Error(t, err)
	case <-time.After(250 * time.Millisecond):
		writer, err := unix.Open(path, unix.O_WRONLY|unix.O_NONBLOCK, 0)
		require.NoError(t, err)
		_, writeErr := unix.Write(writer, []byte("x"))
		require.NoError(t, writeErr)
		require.NoError(t, unix.Close(writer))
		<-result
		t.Fatal("opening a user-selected FIFO blocked")
	}
}
