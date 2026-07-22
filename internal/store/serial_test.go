package store

import (
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
