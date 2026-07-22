package service

import (
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSerialServiceCRUD(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })

	svc := NewSerialService(db, slog.Default())
	created, err := svc.Create(model.SerialPortInput{
		Name: "board", Device: "/dev/ttyACM0", BaudRate: 115200, LocalEcho: true,
		LineEnding: model.SerialLineEndingLF, DTROnOpen: true, RTSOnOpen: true,
	})
	require.NoError(t, err)
	require.Equal(t, 8, created.DataBits)
	require.Equal(t, model.SerialParityNone, created.Parity)
	require.Equal(t, model.SerialLineEndingLF, created.LineEnding)
	require.True(t, created.LocalEcho)
	require.True(t, created.DTROnOpen)
	require.True(t, created.RTSOnOpen)

	list, err := svc.List()
	require.NoError(t, err)
	require.Len(t, list, 1)

	err = svc.Update(model.SerialPortInput{
		ID: created.ID, Name: "board-v2", Device: "/dev/ttyACM0", BaudRate: 9600, DataBits: 7,
		Parity: model.SerialParityEven, StopBits: model.SerialStopBitsTwo, LineEnding: model.SerialLineEndingCRLF,
		DTROnOpen: false, RTSOnOpen: true,
	})
	require.NoError(t, err)
	got, err := svc.Get(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "board-v2", got.Name)
	assert.Equal(t, 9600, got.BaudRate)
	assert.Equal(t, 7, got.DataBits)
	assert.Equal(t, model.SerialLineEndingCRLF, got.LineEnding)
	assert.False(t, got.DTROnOpen)

	second, err := svc.Create(model.SerialPortInput{Name: "extra", Device: "/dev/ttyUSB1", DTROnOpen: true, RTSOnOpen: true})
	require.NoError(t, err)
	deleted, err := svc.DeleteMany([]int64{created.ID, second.ID, second.ID, 0})
	require.NoError(t, err)
	assert.Equal(t, int64(2), deleted)
	list, err = svc.List()
	require.NoError(t, err)
	assert.Empty(t, list)
}

func TestNormalizeSerialPortRejectsInvalid(t *testing.T) {
	_, err := normalizeSerialPort(model.SerialPort{Name: "", Device: "/dev/ttyUSB0"})
	require.Error(t, err)
	_, err = normalizeSerialPort(model.SerialPort{Name: "x", Device: ""})
	require.Error(t, err)
	_, err = normalizeSerialPort(model.SerialPort{Name: "x", Device: "/dev/tty", DataBits: 3})
	require.Error(t, err)
	_, err = normalizeSerialPort(model.SerialPort{Name: "x", Device: "/dev/tty", LineEnding: "bad"})
	require.Error(t, err)
}

func TestSerialServiceDeviceReservation(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	svc := NewSerialService(db, slog.Default())
	require.NoError(t, svc.reserveDevice("/dev/ttyUSB0", "term-1"))
	err = svc.reserveDevice("/dev/ttyUSB0", "term-2")
	require.Error(t, err)
	svc.releaseDevice("/dev/ttyUSB0", "term-1")
	require.NoError(t, svc.reserveDevice("/dev/ttyUSB0", "term-2"))
	active := svc.ActiveDeviceMap()
	assert.Equal(t, "term-2", active["/dev/ttyUSB0"])
}
