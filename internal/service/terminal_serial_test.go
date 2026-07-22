package service

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/serial"
	"github.com/xuthus5/mssh/internal/store"
)

func TestOpenSerialRequiresService(t *testing.T) {
	svc := NewTerminalService(nil, discardEventBus{}, 8, slog.Default())
	_, err := svc.OpenSerial(context.Background(), 1, 80, 24)
	require.Error(t, err)
}

func TestOpenSerialMissingProfile(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	serialSvc := NewSerialService(db, slog.Default())
	term := NewTerminalService(nil, discardEventBus{}, 8, slog.Default())
	term.SetSerialService(serialSvc)
	_, err = term.OpenSerial(context.Background(), 999, 80, 24)
	require.Error(t, err)
}

func TestSerialServiceListDevicesDoesNotPanic(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	svc := NewSerialService(db, slog.Default())
	_, err = svc.ListDevices()
	if err != nil {
		require.Error(t, err)
	}
	_ = model.SerialPort{}
}

func TestSerialControlRequiresOpenSession(t *testing.T) {
	term := NewTerminalService(nil, discardEventBus{}, 8, slog.Default())
	_, err := term.SerialSignals("missing")
	require.Error(t, err)
	err = term.SerialSetSignals("missing", true, false)
	require.Error(t, err)
	err = term.SerialBreak("missing", 100)
	require.Error(t, err)
}

func TestEvictLRUReleasesSerialDevice(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })

	serialSvc := NewSerialService(db, slog.Default())
	term := NewTerminalService(nil, discardEventBus{}, 1, slog.Default())
	term.SetSerialService(serialSvc)

	const terminalID = "term-serial-evict"
	device := "/dev/ttyTEST-mssh-evict"
	require.NoError(t, serialSvc.reserveDevice(device, terminalID))

	session := serial.NewTestPortSession(device)
	term.mu.Lock()
	term.ptys[terminalID] = session
	term.lastUsed[terminalID] = time.Now().Add(-time.Minute)
	term.attached[terminalID] = false
	term.mu.Unlock()

	require.Equal(t, terminalID, serialSvc.ActiveDeviceMap()[device])
	term.evictLRU()
	require.Empty(t, serialSvc.ActiveDeviceMap())
	require.Equal(t, 0, term.Count())
}
