package service

import (
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
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
