//go:build linux

package crypto

import (
	"github.com/godbus/dbus/v5"
)

const secretServiceName = "org.freedesktop.secrets"

// secretServiceProber exposes the minimal DBus queries used to decide whether
// the Secret Service (org.freedesktop.secrets) is reachable on the session bus.
type secretServiceProber interface {
	NameOwner(name string) (string, error)
	ActivatableNames() ([]string, error)
}

type dbusSecretServiceProber struct {
	conn *dbus.Conn
}

func (p dbusSecretServiceProber) NameOwner(name string) (string, error) {
	var owner string
	err := p.conn.BusObject().Call("org.freedesktop.DBus.GetNameOwner", 0, name).Store(&owner)
	return owner, err
}

func (p dbusSecretServiceProber) ActivatableNames() ([]string, error) {
	var names []string
	err := p.conn.BusObject().Call("org.freedesktop.DBus.ListActivatableNames", 0).Store(&names)
	return names, err
}

// keychainPlatformAvailable reports whether a Secret Service provider is
// already registered or can be activated on the session bus. The session bus
// connection is a process-wide singleton shared with go-keyring, so it is not
// closed here.
func keychainPlatformAvailable() bool {
	conn, err := dbus.SessionBus()
	if err != nil {
		return false
	}
	return probeSecretService(dbusSecretServiceProber{conn: conn})
}

// probeSecretService returns true when org.freedesktop.secrets is owned by a
// provider or listed as activatable, meaning go-keyring operations can reach it.
func probeSecretService(p secretServiceProber) bool {
	owner, err := p.NameOwner(secretServiceName)
	if err == nil && owner != "" {
		return true
	}
	names, err := p.ActivatableNames()
	if err != nil {
		return false
	}
	for _, name := range names {
		if name == secretServiceName {
			return true
		}
	}
	return false
}
