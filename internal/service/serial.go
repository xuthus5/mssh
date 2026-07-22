package service

import (
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/serial"
	"github.com/xuthus5/mssh/internal/store"
)

// SerialService manages serial port profiles and device discovery.
type SerialService struct {
	db     *sql.DB
	logger *slog.Logger

	activeMu sync.RWMutex
	// device path -> terminal id currently holding the exclusive open
	activeDevices map[string]string
}

func NewSerialService(db *sql.DB, logger *slog.Logger) *SerialService {
	return &SerialService{
		db:            db,
		logger:        logger,
		activeDevices: make(map[string]string),
	}
}

func (s *SerialService) List() ([]model.SerialPort, error) {
	return store.ListSerialPorts(s.db)
}

func (s *SerialService) Get(id int64) (*model.SerialPort, error) {
	return store.GetSerialPort(s.db, id)
}

func (s *SerialService) Create(input model.SerialPortInput) (*model.SerialPort, error) {
	port, err := normalizeSerialPort(input.SerialPort())
	if err != nil {
		return nil, err
	}
	return store.CreateSerialPort(s.db, port)
}

func (s *SerialService) Update(input model.SerialPortInput) error {
	if input.ID <= 0 {
		return fmt.Errorf("serial port id is required")
	}
	port, err := normalizeSerialPort(input.SerialPort())
	if err != nil {
		return err
	}
	return store.UpdateSerialPort(s.db, port)
}

func (s *SerialService) Delete(id int64) error {
	if err := s.ensureProfilesNotInUse([]int64{id}); err != nil {
		return err
	}
	return store.DeleteSerialPort(s.db, id)
}

// DeleteMany removes multiple serial profiles.
func (s *SerialService) DeleteMany(ids []int64) (int64, error) {
	clean := make([]int64, 0, len(ids))
	seen := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		clean = append(clean, id)
	}
	if err := s.ensureProfilesNotInUse(clean); err != nil {
		return 0, err
	}
	return store.DeleteSerialPorts(s.db, clean)
}

func (s *SerialService) ensureProfilesNotInUse(ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	active := s.ActiveDeviceMap()
	if len(active) == 0 {
		return nil
	}
	for _, id := range ids {
		port, err := store.GetSerialPort(s.db, id)
		if err != nil {
			// Missing profiles are ignored so delete remains idempotent for callers.
			continue
		}
		if _, ok := active[strings.TrimSpace(port.Device)]; ok {
			return fmt.Errorf("serial profile %q is in use and cannot be deleted", port.Name)
		}
	}
	return nil
}

func (s *SerialService) ListDevices() ([]string, error) {
	return serial.ListDevices()
}

// ActiveDeviceMap returns device path -> terminal id for currently open serial sessions.
func (s *SerialService) ActiveDeviceMap() map[string]string {
	s.activeMu.RLock()
	defer s.activeMu.RUnlock()
	out := make(map[string]string, len(s.activeDevices))
	for device, terminalID := range s.activeDevices {
		out[device] = terminalID
	}
	return out
}

func (s *SerialService) reserveDevice(device, terminalID string) error {
	device = strings.TrimSpace(device)
	if device == "" {
		return fmt.Errorf("serial device is required")
	}
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	if owner, ok := s.activeDevices[device]; ok && owner != terminalID {
		return fmt.Errorf("serial device %s is already open in another terminal", device)
	}
	s.activeDevices[device] = terminalID
	return nil
}

func (s *SerialService) releaseDevice(device, terminalID string) {
	device = strings.TrimSpace(device)
	if device == "" {
		return
	}
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	if owner, ok := s.activeDevices[device]; ok && owner == terminalID {
		delete(s.activeDevices, device)
	}
}

func normalizeSerialPort(port model.SerialPort) (model.SerialPort, error) {
	port.Name = strings.TrimSpace(port.Name)
	port.Device = strings.TrimSpace(port.Device)
	port.Notes = strings.TrimSpace(port.Notes)
	port.FlowControl = strings.TrimSpace(port.FlowControl)
	port.LineEnding = model.SerialLineEnding(strings.TrimSpace(string(port.LineEnding)))
	if port.Name == "" {
		return model.SerialPort{}, fmt.Errorf("serial port name is required")
	}
	if port.Device == "" {
		return model.SerialPort{}, fmt.Errorf("serial device is required")
	}
	baud, err := normalizeBaudRate(port.BaudRate)
	if err != nil {
		return model.SerialPort{}, err
	}
	port.BaudRate = baud
	if port.DataBits == 0 {
		port.DataBits = 8
	}
	if port.DataBits < 5 || port.DataBits > 8 {
		return model.SerialPort{}, fmt.Errorf("data bits must be 5-8")
	}
	if err := normalizeSerialEnums(&port); err != nil {
		return model.SerialPort{}, err
	}
	// DTR/RTS defaults stay as provided by SerialPortInput conversion.
	return port, nil
}

func normalizeBaudRate(baud int) (int, error) {
	if baud <= 0 {
		baud = 115200
	}
	if baud < 300 || baud > 4_000_000 {
		return 0, fmt.Errorf("baud rate must be between 300 and 4000000")
	}
	return baud, nil
}

func normalizeSerialEnums(port *model.SerialPort) error {
	if port.Parity == "" {
		port.Parity = model.SerialParityNone
	}
	switch port.Parity {
	case model.SerialParityNone, model.SerialParityOdd, model.SerialParityEven, model.SerialParityMark, model.SerialParitySpace:
	default:
		return fmt.Errorf("unsupported parity %q", port.Parity)
	}
	if port.StopBits == "" {
		port.StopBits = model.SerialStopBitsOne
	}
	switch port.StopBits {
	case model.SerialStopBitsOne, model.SerialStopBitsOnePointFive, model.SerialStopBitsTwo:
	default:
		return fmt.Errorf("unsupported stop bits %q", port.StopBits)
	}
	if port.FlowControl == "" {
		port.FlowControl = "none"
	}
	switch port.FlowControl {
	case "none", "xonxoff", "rtscts", "dsrdtr":
	default:
		return fmt.Errorf("unsupported flow control %q", port.FlowControl)
	}
	if port.LineEnding == "" {
		port.LineEnding = model.SerialLineEndingCR
	}
	switch port.LineEnding {
	case model.SerialLineEndingCR, model.SerialLineEndingLF, model.SerialLineEndingCRLF:
	default:
		return fmt.Errorf("unsupported line ending %q", port.LineEnding)
	}
	return nil
}
