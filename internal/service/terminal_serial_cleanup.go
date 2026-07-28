package service

import (
	"errors"
	"fmt"

	"github.com/xuthus5/mssh/internal/serial"
)

type unregisteredSerialResource struct {
	terminalID string
	device     string
	port       *serial.PortSession
	leaseOwner *SerialService
}

func (t *TerminalService) rollbackUnregisteredSerial(
	resource unregisteredSerialResource,
	cause error,
) error {
	resource.device = serial.CanonicalDevicePath(resource.device)
	t.resourceMu.Lock()
	defer t.resourceMu.Unlock()
	if err := closeUnregisteredSerial(resource); err != nil {
		if t.pendingSerialCleanups == nil {
			t.pendingSerialCleanups = make(map[string]unregisteredSerialResource)
		}
		t.pendingSerialCleanups[resource.terminalID] = resource
		return errors.Join(cause, fmt.Errorf("close unregistered serial resource: %w", err))
	}
	delete(t.pendingSerialCleanups, resource.terminalID)
	return cause
}

func (t *TerminalService) retryPendingSerialCleanups() error {
	return t.retryPendingSerialCleanupsForDevice("")
}

func (t *TerminalService) retryPendingSerialCleanupForDevice(device string) error {
	canonicalDevice := serial.CanonicalDevicePath(device)
	if canonicalDevice == "" {
		return fmt.Errorf("serial device is required")
	}
	return t.retryPendingSerialCleanupsForDevice(canonicalDevice)
}

func (t *TerminalService) retryPendingSerialCleanupsForDevice(canonicalDevice string) error {
	if t == nil {
		return nil
	}
	t.resourceMu.Lock()
	defer t.resourceMu.Unlock()
	var retryErr error
	for terminalID, resource := range t.pendingSerialCleanups {
		if canonicalDevice != "" && resource.device != canonicalDevice {
			continue
		}
		if err := closeUnregisteredSerial(resource); err != nil {
			retryErr = errors.Join(retryErr, fmt.Errorf("close pending serial resource %s: %w", terminalID, err))
			continue
		}
		delete(t.pendingSerialCleanups, terminalID)
	}
	return retryErr
}

func closeUnregisteredSerial(resource unregisteredSerialResource) error {
	if resource.port != nil {
		if err := resource.port.Close(); err != nil {
			return err
		}
	}
	if resource.leaseOwner != nil {
		resource.leaseOwner.releaseDevice(resource.device, resource.terminalID)
	}
	return nil
}
