package store

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestSerialPortCRUD(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })

	created, err := CreateSerialPort(db, model.SerialPort{
		Name: "esp", Device: "/dev/ttyUSB0", BaudRate: 115200, DataBits: 8,
		Parity: model.SerialParityNone, StopBits: model.SerialStopBitsOne, FlowControl: "none",
		LineEnding: model.SerialLineEndingCR, LocalEcho: true, DTROnOpen: true, RTSOnOpen: false,
	})
	require.NoError(t, err)
	require.True(t, created.LocalEcho)
	require.False(t, created.RTSOnOpen)
	require.Equal(t, model.SerialLineEndingCR, created.LineEnding)

	list, err := ListSerialPorts(db)
	require.NoError(t, err)
	require.Len(t, list, 1)

	created.Name = "esp32"
	created.LineEnding = model.SerialLineEndingCRLF
	created.RTSOnOpen = true
	require.NoError(t, UpdateSerialPort(db, *created))
	got, err := GetSerialPort(db, created.ID)
	require.NoError(t, err)
	require.Equal(t, "esp32", got.Name)
	require.Equal(t, model.SerialLineEndingCRLF, got.LineEnding)
	require.True(t, got.RTSOnOpen)

	second, err := CreateSerialPort(db, model.SerialPort{
		Name: "board2", Device: "/dev/ttyACM0", BaudRate: 9600, DataBits: 8,
		Parity: model.SerialParityNone, StopBits: model.SerialStopBitsOne, FlowControl: "rtscts",
		LineEnding: model.SerialLineEndingLF, DTROnOpen: true, RTSOnOpen: true,
	})
	require.NoError(t, err)
	affected, err := DeleteSerialPorts(db, []int64{created.ID, second.ID})
	require.NoError(t, err)
	require.Equal(t, int64(2), affected)
	list, err = ListSerialPorts(db)
	require.NoError(t, err)
	require.Empty(t, list)
}

func TestSerialPortErrorPaths(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })

	_, err = GetSerialPort(db, 999)
	require.Error(t, err)
	require.ErrorIs(t, err, sql.ErrNoRows)

	err = UpdateSerialPort(db, model.SerialPort{ID: 999, Name: "x", Device: "/dev/ttyUSB0"})
	require.Error(t, err)
	require.ErrorIs(t, err, sql.ErrNoRows)

	err = DeleteSerialPort(db, 999)
	require.Error(t, err)
	require.ErrorIs(t, err, sql.ErrNoRows)

	n, err := DeleteSerialPorts(db, nil)
	require.NoError(t, err)
	require.Equal(t, int64(0), n)

	// Create two and delete many including missing ids.
	a, err := CreateSerialPort(db, model.SerialPort{Name: "a", Device: "/dev/ttyA", BaudRate: 9600, DataBits: 8, Parity: model.SerialParityNone, StopBits: model.SerialStopBitsOne, FlowControl: "none", LineEnding: model.SerialLineEndingCR})
	require.NoError(t, err)
	b, err := CreateSerialPort(db, model.SerialPort{Name: "b", Device: "/dev/ttyB", BaudRate: 9600, DataBits: 8, Parity: model.SerialParityNone, StopBits: model.SerialStopBitsOne, FlowControl: "none", LineEnding: model.SerialLineEndingLF, LocalEcho: true, DTROnOpen: false, RTSOnOpen: true, Notes: "n", SortOrder: 2})
	require.NoError(t, err)
	n, err = DeleteSerialPorts(db, []int64{a.ID, b.ID, 424242})
	require.NoError(t, err)
	require.Equal(t, int64(2), n)
}
