package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSerialShutdownWaitsForActiveOperation(t *testing.T) {
	database := testutil.NewTestDB(t)
	serialService := NewSerialService(database, testutil.NewTestLogger())
	assertDatabaseServiceShutdownWaits(t, database, func() error {
		_, err := serialService.List()
		return err
	}, serialService.Shutdown)
}

func TestSerialShutdownRejectsFallibleOperations(t *testing.T) {
	database := testutil.NewTestDB(t)
	serialService := NewSerialService(database, testutil.NewTestLogger())
	serialService.Shutdown()
	serialService.Shutdown()

	_, err := serialService.List()
	assertSerialStopped(t, err)
	_, err = serialService.Get(1)
	assertSerialStopped(t, err)
	_, err = serialService.Create(model.SerialPortInput{})
	assertSerialStopped(t, err)
	assertSerialStopped(t, serialService.Update(model.SerialPortInput{}))
	assertSerialStopped(t, serialService.Delete(1))
	_, err = serialService.DeleteMany([]int64{1})
	assertSerialStopped(t, err)
	_, err = serialService.ListDevices()
	assertSerialStopped(t, err)
	assertSerialStopped(t, serialService.reserveDevice("/dev/ttyUSB0", "term-1"))
	assertSerialStopped(t, serialService.reserveProfile(model.SerialPort{ID: 1, Device: "/dev/ttyUSB0"}, "term-1"))
}

func TestSerialShutdownAllowsReservedDeviceCleanup(t *testing.T) {
	database := testutil.NewTestDB(t)
	serialService := NewSerialService(database, testutil.NewTestLogger())
	require.NoError(t, serialService.reserveDevice("/dev/ttyUSB0", "term-1"))
	serialService.Shutdown()
	serialService.releaseDevice("/dev/ttyUSB0", "term-1")
	assert.Empty(t, serialService.ActiveDeviceMap())
}

func TestSerialShutdownHandlesNilReceiver(t *testing.T) {
	var serialService *SerialService
	assert.NotPanics(t, serialService.Shutdown)
	_, err := serialService.List()
	assertSerialStopped(t, err)
	assert.Empty(t, serialService.ActiveDeviceMap())
}

func TestSerialUpdateRejectsActiveProfile(t *testing.T) {
	database := testutil.NewTestDB(t)
	serialService := NewSerialService(database, testutil.NewTestLogger())
	created, err := serialService.Create(model.SerialPortInput{Name: "board", Device: "/dev/ttyUSB0"})
	require.NoError(t, err)
	require.NoError(t, serialService.reserveDevice(created.Device, "term-1"))

	err = serialService.Update(model.SerialPortInput{ID: created.ID, Name: "renamed", Device: created.Device})
	require.Error(t, err)
	assert.ErrorContains(t, err, "in use")
}

func TestSerialReservationRejectsDeletedProfileSnapshot(t *testing.T) {
	database := testutil.NewTestDB(t)
	serialService := NewSerialService(database, testutil.NewTestLogger())
	created, err := serialService.Create(model.SerialPortInput{Name: "board", Device: "/dev/ttyUSB0"})
	require.NoError(t, err)
	require.NoError(t, serialService.Delete(created.ID))

	err = serialService.reserveProfile(*created, "term-1")
	require.Error(t, err)
	assert.ErrorContains(t, err, "no longer available")
	assert.Empty(t, serialService.ActiveDeviceMap())
}

func TestSerialReservationRejectsChangedConfigurationSnapshot(t *testing.T) {
	database := testutil.NewTestDB(t)
	serialService := NewSerialService(database, testutil.NewTestLogger())
	created, err := serialService.Create(model.SerialPortInput{Name: "board", Device: "/dev/ttyUSB0"})
	require.NoError(t, err)
	require.NoError(t, serialService.Update(model.SerialPortInput{
		ID: created.ID, Name: created.Name, Device: created.Device, BaudRate: 9600,
	}))

	err = serialService.reserveProfile(*created, "term-1")
	require.Error(t, err)
	assert.ErrorContains(t, err, "profile changed")
	assert.Empty(t, serialService.ActiveDeviceMap())
}

func assertSerialStopped(t *testing.T, err error) {
	t.Helper()
	assertServiceStoppedError(t, err, "serial service is shutting down")
}
