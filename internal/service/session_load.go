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
		if loaded.Password != "" {
			plain, openErr := openSessionPassword(s.crypto, loaded.Password)
			if openErr != nil {
				return fmt.Errorf("decrypt session password: %w", openErr)
			}
			loaded.Password = plain
		}
		session = loaded
		return nil
	})
	if err != nil {
		return nil, err
	}
	return session, nil
}

func redactSessionPassword(session *model.Session) *model.Session {
	if session == nil {
		return nil
	}
	copy := *session
	if copy.Password != "" {
		copy.Password = ""
	}
	return &copy
}

func redactSessionPasswords(sessions []model.Session) []model.Session {
	for index := range sessions {
		if sessions[index].Password != "" {
			sessions[index].Password = ""
		}
	}
	return sessions
}
