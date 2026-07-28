package service

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/serial"
	"github.com/xuthus5/mssh/internal/store"
)

func TestOpenSerialContextRollbackRetainsOwnershipUntilShutdownRetry(t *testing.T) {
	terminalSvc, serialSvc, profileID := newSerialRollbackFixture(t, 2, "/dev/ttyTEST-context-rollback")
	ctx, cancel := context.WithCancel(t.Context())
	closeErr := errors.New("serial context rollback close failed once")
	port := &retryCloseSerialPort{
		liveSerialPort: liveSerialPort{closeC: make(chan struct{})},
		firstCloseErr:  closeErr,
	}
	replaceSerialPortOpener(t, func(profile model.SerialPort) (*serial.PortSession, error) {
		cancel()
		return serial.NewLivePortSessionForTest(profile.Device, port), nil
	})

	_, err := terminalSvc.OpenSerial(ctx, profileID, 80, 24)

	require.ErrorIs(t, err, context.Canceled)
	require.ErrorIs(t, err, closeErr)
	require.Len(t, serialSvc.ActiveDeviceMap(), 1)
	require.Equal(t, 1, port.CloseCount())

	require.NoError(t, terminalSvc.Shutdown())
	require.Equal(t, 2, port.CloseCount())
	require.Empty(t, serialSvc.ActiveDeviceMap())
}

func TestOpenSerialRegistrationRollbackRetainsRetryableHandleAndLease(t *testing.T) {
	terminalSvc, serialSvc, profileID := newSerialRollbackFixture(t, 1, "/dev/ttyTEST-register-rollback")
	existingCloseErr := errors.New("existing terminal eviction failed once")
	existing := &retryCloseTerminalIO{closeErrors: []error{existingCloseErr, nil}}
	require.NoError(t, terminalSvc.registerTerminal("existing", "", 0, existing))

	rollbackCloseErr := errors.New("unregistered serial close failed once")
	port := &retryCloseSerialPort{
		liveSerialPort: liveSerialPort{closeC: make(chan struct{})},
		firstCloseErr:  rollbackCloseErr,
	}
	replaceSerialPortOpener(t, func(profile model.SerialPort) (*serial.PortSession, error) {
		return serial.NewLivePortSessionForTest(profile.Device, port), nil
	})

	_, err := terminalSvc.OpenSerial(t.Context(), profileID, 80, 24)

	require.ErrorIs(t, err, existingCloseErr)
	require.ErrorIs(t, err, rollbackCloseErr)
	require.Equal(t, 1, terminalSvc.Count())
	require.Len(t, serialSvc.ActiveDeviceMap(), 1)
	require.Equal(t, 1, port.CloseCount())

	require.NoError(t, terminalSvc.Shutdown())
	require.Equal(t, 2, existing.CloseCount())
	require.Equal(t, 2, port.CloseCount())
	require.Empty(t, serialSvc.ActiveDeviceMap())
}

func TestOpenSerialRetriesPendingRollbackBeforeNextOpen(t *testing.T) {
	terminalSvc, serialSvc, profileID := newSerialRollbackFixture(t, 2, "/dev/ttyTEST-next-open-retry")
	ctx, cancel := context.WithCancel(t.Context())
	firstPort := &retryCloseSerialPort{
		liveSerialPort: liveSerialPort{closeC: make(chan struct{})},
		firstCloseErr:  errors.New("serial close failed before next open"),
	}
	openCalls := 0
	replaceSerialPortOpener(t, func(profile model.SerialPort) (*serial.PortSession, error) {
		openCalls++
		if openCalls == 1 {
			cancel()
			return serial.NewLivePortSessionForTest(profile.Device, firstPort), nil
		}
		return newLiveSerialSession(profile.Device), nil
	})

	_, err := terminalSvc.OpenSerial(ctx, profileID, 80, 24)
	require.Error(t, err)
	require.Equal(t, 1, firstPort.CloseCount())
	require.Len(t, serialSvc.ActiveDeviceMap(), 1)

	terminalID, err := terminalSvc.OpenSerial(t.Context(), profileID, 80, 24)
	require.NoError(t, err)
	t.Cleanup(func() { _ = terminalSvc.Close(terminalID) })
	require.Equal(t, 2, firstPort.CloseCount())
	require.Equal(t, terminalID, serialSvc.ActiveDeviceMap()[serial.CanonicalDevicePath("/dev/ttyTEST-next-open-retry")])
}

func TestOpenSerialKeepsPendingRollbackAfterRepeatedCloseFailure(t *testing.T) {
	terminalSvc, serialSvc, profileID := newSerialRollbackFixture(t, 2, "/dev/ttyTEST-repeated-rollback")
	ctx, cancel := context.WithCancel(t.Context())
	firstCloseErr := errors.New("first unregistered serial close failure")
	secondCloseErr := errors.New("second unregistered serial close failure")
	port := &sequencedCloseSerialPort{
		liveSerialPort: liveSerialPort{closeC: make(chan struct{})},
		closeErrors:    []error{firstCloseErr, secondCloseErr},
	}
	openCalls := 0
	replaceSerialPortOpener(t, func(profile model.SerialPort) (*serial.PortSession, error) {
		openCalls++
		cancel()
		return serial.NewLivePortSessionForTest(profile.Device, port), nil
	})

	_, err := terminalSvc.OpenSerial(ctx, profileID, 80, 24)
	require.ErrorIs(t, err, firstCloseErr)
	require.Equal(t, 1, port.CloseCount())
	require.Len(t, serialSvc.ActiveDeviceMap(), 1)

	_, err = terminalSvc.OpenSerial(t.Context(), profileID, 80, 24)
	require.ErrorIs(t, err, secondCloseErr)
	require.Equal(t, 1, openCalls)
	require.Equal(t, 2, port.CloseCount())
	require.Len(t, serialSvc.ActiveDeviceMap(), 1)

	require.NoError(t, terminalSvc.Shutdown())
	require.Equal(t, 3, port.CloseCount())
	require.Empty(t, serialSvc.ActiveDeviceMap())
}

func TestOpenSerialPendingCleanupIsScopedToTargetDevice(t *testing.T) {
	const deviceA = "/dev/ttyTEST-pending-device-a"
	const deviceB = "/dev/ttyTEST-pending-device-b"
	terminalSvc, serialSvc, profileAID := newSerialRollbackFixture(t, 2, deviceA)
	profileB, err := serialSvc.Create(model.SerialPortInput{Name: deviceB, Device: deviceB})
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(t.Context())
	firstCloseErr := errors.New("device A first cleanup failure")
	secondCloseErr := errors.New("device A second cleanup failure")
	portA := &sequencedCloseSerialPort{
		liveSerialPort: liveSerialPort{closeC: make(chan struct{})},
		closeErrors:    []error{firstCloseErr, secondCloseErr},
	}
	openCalls := 0
	replaceSerialPortOpener(t, func(profile model.SerialPort) (*serial.PortSession, error) {
		openCalls++
		if profile.ID == profileAID {
			cancel()
			return serial.NewLivePortSessionForTest(profile.Device, portA), nil
		}
		return newLiveSerialSession(profile.Device), nil
	})

	_, err = terminalSvc.OpenSerial(ctx, profileAID, 80, 24)
	require.ErrorIs(t, err, firstCloseErr)
	require.Equal(t, 1, portA.CloseCount())

	terminalBID, err := terminalSvc.OpenSerial(t.Context(), profileB.ID, 80, 24)
	require.NoError(t, err)
	t.Cleanup(func() { _ = terminalSvc.Close(terminalBID) })
	require.Equal(t, 2, openCalls)
	require.Equal(t, 1, portA.CloseCount())
	require.Equal(t, terminalBID, serialSvc.ActiveDeviceMap()[serial.CanonicalDevicePath(deviceB)])
	require.NotEmpty(t, serialSvc.ActiveDeviceMap()[serial.CanonicalDevicePath(deviceA)])

	_, err = terminalSvc.OpenSerial(t.Context(), profileAID, 80, 24)
	require.ErrorIs(t, err, secondCloseErr)
	require.Equal(t, 2, portA.CloseCount())
	require.Equal(t, terminalBID, serialSvc.ActiveDeviceMap()[serial.CanonicalDevicePath(deviceB)])
	require.NotEmpty(t, serialSvc.ActiveDeviceMap()[serial.CanonicalDevicePath(deviceA)])
}

func TestTerminalShutdownRetriesEveryPendingSerialCleanup(t *testing.T) {
	const deviceA = "/dev/ttyTEST-shutdown-device-a"
	const deviceB = "/dev/ttyTEST-shutdown-device-b"
	terminalSvc, serialSvc, _ := newSerialRollbackFixture(t, 2, deviceA)
	closeErr := errors.New("device A shutdown cleanup failed once")
	portA := &sequencedCloseSerialPort{
		liveSerialPort: liveSerialPort{closeC: make(chan struct{})},
		closeErrors:    []error{closeErr},
	}
	portB := &sequencedCloseSerialPort{liveSerialPort: liveSerialPort{closeC: make(chan struct{})}}
	require.NoError(t, serialSvc.reserveDevice(deviceA, "pending-a"))
	require.NoError(t, serialSvc.reserveDevice(deviceB, "pending-b"))
	terminalSvc.resourceMu.Lock()
	terminalSvc.pendingSerialCleanups["pending-a"] = unregisteredSerialResource{
		terminalID: "pending-a", device: serial.CanonicalDevicePath(deviceA),
		port: serial.NewLivePortSessionForTest(deviceA, portA), leaseOwner: serialSvc,
	}
	terminalSvc.pendingSerialCleanups["pending-b"] = unregisteredSerialResource{
		terminalID: "pending-b", device: serial.CanonicalDevicePath(deviceB),
		port: serial.NewLivePortSessionForTest(deviceB, portB), leaseOwner: serialSvc,
	}
	terminalSvc.resourceMu.Unlock()

	err := terminalSvc.Shutdown()

	require.ErrorIs(t, err, closeErr)
	require.Equal(t, 1, portA.CloseCount())
	require.Equal(t, 1, portB.CloseCount())
	require.Equal(t, map[string]string{serial.CanonicalDevicePath(deviceA): "pending-a"}, serialSvc.ActiveDeviceMap())
	require.Equal(t, []string{"pending-a"}, pendingSerialCleanupIDsForTest(terminalSvc))

	require.NoError(t, terminalSvc.Shutdown())
	require.Equal(t, 2, portA.CloseCount())
	require.Empty(t, serialSvc.ActiveDeviceMap())
	require.Empty(t, pendingSerialCleanupIDsForTest(terminalSvc))
}

type sequencedCloseSerialPort struct {
	liveSerialPort
	closeErrors []error
	closeCalls  int
	once        sync.Once
}

func (p *sequencedCloseSerialPort) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	call := p.closeCalls
	p.closeCalls++
	if call < len(p.closeErrors) && p.closeErrors[call] != nil {
		return p.closeErrors[call]
	}
	p.once.Do(func() { close(p.closeC) })
	p.closed = true
	return nil
}

func (p *sequencedCloseSerialPort) CloseCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.closeCalls
}

func newSerialRollbackFixture(
	t *testing.T,
	maxSize int,
	device string,
) (*TerminalService, *SerialService, int64) {
	t.Helper()
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	serialSvc := NewSerialService(db, slog.Default())
	profile, err := serialSvc.Create(model.SerialPortInput{Name: device, Device: device})
	require.NoError(t, err)
	terminalSvc := NewTerminalService(nil, discardEventBus{}, maxSize, slog.Default())
	terminalSvc.SetSerialService(serialSvc)
	return terminalSvc, serialSvc, profile.ID
}

func replaceSerialPortOpener(
	t *testing.T,
	opener func(model.SerialPort) (*serial.PortSession, error),
) {
	t.Helper()
	original := openSerialPortSession
	openSerialPortSession = opener
	t.Cleanup(func() { openSerialPortSession = original })
}

func pendingSerialCleanupIDsForTest(terminalSvc *TerminalService) []string {
	terminalSvc.resourceMu.Lock()
	defer terminalSvc.resourceMu.Unlock()
	ids := make([]string, 0, len(terminalSvc.pendingSerialCleanups))
	for terminalID := range terminalSvc.pendingSerialCleanups {
		ids = append(ids, terminalID)
	}
	return ids
}
