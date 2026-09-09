package service

import (
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SessionService) sessionForConnect(id int64) (*model.Session, error) {
	if id <= 0 {
		return nil, fmt.Errorf("invalid session id")
	}
	var session *model.Session
	err := withCryptoOperation(s.crypto, func() error {
		loaded, loadErr := store.GetSession(s.db, id)
		if loadErr != nil {
			return loadErr
		}
		if err := openSessionPasswords(s.crypto, loaded); err != nil {
			return err
		}
		session = loaded
		return nil
	})
	if err != nil {
		return nil, err
	}
	return session, nil
}

// GetSessionCredentials returns the session login username and decrypted password.
func (s *SessionService) GetSessionCredentials(id int64) (*model.SessionCredentials, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	session, err := s.sessionForConnect(id)
	if err != nil {
		return nil, err
	}
	credentials := &model.SessionCredentials{Username: session.Username, Password: session.Password}
	if session.JumpHost != nil {
		credentials.JumpHostPassword = session.JumpHost.Password
	}
	return credentials, nil
}

func redactSessionPassword(session *model.Session) *model.Session {
	if session == nil {
		return nil
	}
	copy := *session
	copy.Password = ""
	copy.JumpHost = session.JumpHost.Clone()
	if copy.JumpHost != nil {
		copy.JumpHost.Password = ""
	}
	return &copy
}

func redactSessionPasswords(sessions []model.Session) []model.Session {
	if sessions == nil {
		return nil
	}
	redacted := make([]model.Session, len(sessions))
	for index := range sessions {
		redacted[index] = *redactSessionPassword(&sessions[index])
	}
	return redacted
}
