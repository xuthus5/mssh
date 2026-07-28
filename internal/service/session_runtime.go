package service

import (
	"fmt"
	"strings"

	ssh "github.com/xuthus5/mssh/internal/ssh"
)

//wails:ignore
func (s *SessionService) GetClientWrapper(connID string) (*ssh.ClientWrapper, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if strings.TrimSpace(connID) == "" {
		return nil, fmt.Errorf("invalid connection id")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	conn, ok := s.conns[connID]
	if !ok || conn.wrapper == nil {
		return nil, fmt.Errorf("connection %s not found", connID)
	}
	return conn.wrapper, nil
}

//wails:ignore
func (s *SessionService) ConnectionCount() int {
	if s == nil {
		return 0
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.conns)
}

//wails:ignore
func (s *SessionService) CloseAll() error {
	if s == nil {
		return nil
	}
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	return s.closeAll(false)
}
