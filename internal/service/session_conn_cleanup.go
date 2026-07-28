package service

import (
	"errors"
	"fmt"
	"net"
)

func (conn *managedConn) closeConnection() error {
	if conn == nil {
		return nil
	}
	conn.closeMu.Lock()
	defer conn.closeMu.Unlock()
	if conn.closed {
		return nil
	}
	conn.cleanupOnce.Do(func() {
		if conn.cleanup != nil {
			conn.cleanup()
		}
	})
	if conn.wrapper == nil {
		conn.closed = true
		return nil
	}

	var err error
	if conn.closeAttempted {
		if conn.wrapper.Inner != nil {
			err = conn.wrapper.Inner.Close()
		}
	} else {
		conn.closeAttempted = true
		err = conn.wrapper.Close()
	}
	if err != nil && !errors.Is(err, net.ErrClosed) {
		return err
	}
	conn.closed = true
	return nil
}

// DisconnectForSessions closes any remaining SSH client wrappers owned by the sessions.
//
//wails:ignore
func (s *SessionService) DisconnectForSessions(sessionIDs []int64) error {
	if s == nil || len(sessionIDs) == 0 {
		return nil
	}
	wanted := positiveSessionIDs(sessionIDs)
	if len(wanted) == 0 {
		return nil
	}

	s.mu.Lock()
	connIDs := make([]string, 0)
	for connID, conn := range s.conns {
		if conn == nil {
			continue
		}
		if _, ok := wanted[conn.sessionID]; ok {
			connIDs = append(connIDs, connID)
		}
	}
	s.mu.Unlock()

	var disconnectErr error
	for _, connID := range connIDs {
		if err := s.disconnect(connID, false); err != nil {
			disconnectErr = errors.Join(disconnectErr, fmt.Errorf("disconnect connection %s: %w", connID, err))
		}
	}
	return disconnectErr
}
