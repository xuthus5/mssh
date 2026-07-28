package service

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"sync"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/serial"
	"github.com/xuthus5/mssh/internal/store"
)

// SerialService manages serial port profiles and device discovery.
type SerialService struct {
	db        *sql.DB
	logger    *slog.Logger
	lifecycle serviceOperationGate

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
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	return store.ListSerialPorts(s.db)
}

func (s *SerialService) Get(id int64) (*model.SerialPort, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if id <= 0 {
		return nil, fmt.Errorf("invalid serial port id")
	}
	return store.GetSerialPort(s.db, id)
}

func (s *SerialService) Create(input model.SerialPortInput) (*model.SerialPort, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	port, err := normalizeSerialPort(input.SerialPort())
	if err != nil {
		return nil, err
	}
	return store.CreateSerialPort(s.db, port)
}

func (s *SerialService) Update(input model.SerialPortInput) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if input.ID <= 0 {
		return fmt.Errorf("serial port id is required")
	}
	port, err := normalizeSerialPort(input.SerialPort())
	if err != nil {
		return err
	}
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	if err := s.ensureProfilesNotInUseLocked([]int64{input.ID}); err != nil {
		return err
	}
	return store.UpdateSerialPort(s.db, port)
}

func (s *SerialService) Delete(id int64) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if id <= 0 {
		return fmt.Errorf("invalid serial port id")
	}
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	if err := s.ensureProfilesNotInUseLocked([]int64{id}); err != nil {
		return err
	}
	return store.DeleteSerialPort(s.db, id)
}

// DeleteMany removes multiple serial profiles.
func (s *SerialService) DeleteMany(ids []int64) (int64, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return 0, err
	}
	defer finish()
	clean := normalizeSerialProfileIDs(ids)
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	if err := s.ensureProfilesNotInUseLocked(clean); err != nil {
		return 0, err
	}
	return store.DeleteSerialPorts(s.db, clean)
}

func normalizeSerialProfileIDs(ids []int64) []int64 {
	clean := make([]int64, 0, len(ids))
	seen := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		clean = append(clean, id)
	}
	return clean
}

func (s *SerialService) ensureProfilesNotInUseLocked(ids []int64) error {
	for _, id := range ids {
		port, err := store.GetSerialPort(s.db, id)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return fmt.Errorf("check serial profile usage: %w", err)
		}
		if _, active := s.activeDevices[serial.CanonicalDevicePath(port.Device)]; active {
			return fmt.Errorf("serial profile %q is in use and cannot be modified", port.Name)
		}
	}
	return nil
}

func (s *SerialService) ListDevices() ([]string, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	return serial.ListDevices()
}

// ActiveDeviceMap returns device path -> terminal id for currently open serial sessions.
func (s *SerialService) ActiveDeviceMap() map[string]string {
	if s == nil {
		return map[string]string{}
	}
	s.activeMu.RLock()
	defer s.activeMu.RUnlock()
	out := make(map[string]string, len(s.activeDevices))
	for device, terminalID := range s.activeDevices {
		out[device] = terminalID
	}
	return out
}

func (s *SerialService) reserveProfile(profile model.SerialPort, terminalID string) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	device := serial.CanonicalDevicePath(profile.Device)
	if profile.ID <= 0 || device == "" {
		return fmt.Errorf("serial profile is invalid")
	}
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	if err := s.verifyProfileSnapshotLocked(profile); err != nil {
		return err
	}
	return s.reserveDeviceLocked(device, terminalID)
}

func (s *SerialService) verifyProfileSnapshotLocked(profile model.SerialPort) error {
	current, err := store.GetSerialPort(s.db, profile.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("serial profile is no longer available")
	}
	if err != nil {
		return fmt.Errorf("verify serial profile: %w", err)
	}
	if !serialOpenConfigurationEqual(*current, profile) {
		return fmt.Errorf("serial profile changed; retry connection")
	}
	return nil
}

func (s *SerialService) reserveDevice(device, terminalID string) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	device = serial.CanonicalDevicePath(device)
	if device == "" {
		return fmt.Errorf("serial device is required")
	}
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	return s.reserveDeviceLocked(device, terminalID)
}

func (s *SerialService) reserveDeviceLocked(device, terminalID string) error {
	if owner, ok := s.activeDevices[device]; ok && owner != terminalID {
		return fmt.Errorf("serial device %s is already open in another terminal", device)
	}
	s.activeDevices[device] = terminalID
	return nil
}

func (s *SerialService) releaseDevice(device, terminalID string) {
	if s == nil {
		return
	}
	device = serial.CanonicalDevicePath(device)
	if device == "" {
		return
	}
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	if owner, ok := s.activeDevices[device]; ok && owner == terminalID {
		delete(s.activeDevices, device)
	}
}
