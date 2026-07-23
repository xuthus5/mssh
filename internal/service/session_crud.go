package service

import (
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SessionService) ListFolders() ([]model.SessionFolder, error) {
	s.logger.Info("listing folders")
	return store.ListFolders(s.db)
}

func (s *SessionService) CreateFolder(name string, parentID *int64) (*model.SessionFolder, error) {
	normalized, err := validateFolderName(name)
	if err != nil {
		return nil, err
	}
	if err := validateOptionalParentFolderID(parentID); err != nil {
		return nil, err
	}
	s.logger.Info("creating folder", "name", normalized, "parentID", parentID)
	result, err := store.CreateFolder(s.db, normalized, parentID)
	if err != nil {
		s.logger.Error("create folder failed", "error", err)
	}
	return result, err
}

func (s *SessionService) UpdateFolder(id int64, name string) error {
	if id <= 0 {
		return fmt.Errorf("invalid folder id")
	}
	normalized, err := validateFolderName(name)
	if err != nil {
		return err
	}
	s.logger.Info("updating folder", "id", id, "name", normalized)
	err = store.UpdateFolder(s.db, id, normalized)
	if err != nil {
		s.logger.Error("update folder failed", "error", err)
	}
	return err
}

func (s *SessionService) DeleteFolder(id int64) error {
	if id <= 0 {
		return fmt.Errorf("invalid folder id")
	}
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "delete", TargetType: "folder", TargetID: fmt.Sprint(id), Summary: "删除会话分组", Outcome: outcome})
	}()
	s.logger.Info("deleting folder", "id", id)
	err := store.DeleteFolder(s.db, id)
	if err != nil {
		s.logger.Error("delete folder failed", "error", err)
	} else {
		outcome = "success"
	}
	return err
}

func (s *SessionService) SetDefaultFolder(id int64) error {
	if id <= 0 {
		return fmt.Errorf("invalid folder id")
	}
	s.logger.Info("setting default folder", "id", id)
	return store.SetDefaultFolder(s.db, id)
}

func (s *SessionService) MoveFolder(id int64, newParentID *int64) error {
	if id <= 0 {
		return fmt.Errorf("invalid folder id")
	}
	if err := validateOptionalParentFolderID(newParentID); err != nil {
		return err
	}
	s.logger.Info("moving folder", "id", id, "newParentID", newParentID)
	err := store.MoveFolder(s.db, id, newParentID)
	if err != nil {
		s.logger.Error("move folder failed", "error", err)
	}
	return err
}

func (s *SessionService) ListSessions(folderID *int64) ([]model.Session, error) {
	if err := validateOptionalAssetID("folder", folderID); err != nil {
		return nil, err
	}
	s.logger.Info("listing sessions", "folderID", folderID)
	sessions, err := store.ListSessions(s.db, folderID)
	if err != nil {
		return nil, err
	}
	return redactSessionPasswords(sessions), nil
}

func (s *SessionService) ListRecentSessions(limit int) ([]model.Session, error) {
	s.logger.Info("listing recent sessions", "limit", limit)
	sessions, err := store.ListRecentSessions(s.db, limit)
	if err != nil {
		return nil, err
	}
	return redactSessionPasswords(sessions), nil
}

func (s *SessionService) CreateSession(input model.SessionInput) (*model.Session, error) {
	if err := validateSessionAssetInput(input, false); err != nil {
		return nil, err
	}
	session := input.Session()
	if s.crypto != nil && session.Password != "" {
		sealed, err := sealSessionPassword(s.crypto, session.Password)
		if err != nil {
			return nil, fmt.Errorf("create session: encrypt password: %w", err)
		}
		session.Password = sealed
	}
	s.logger.Info("creating session", "name", session.Name, "authMethod", session.AuthMethod)
	result, err := store.CreateSessionWithTags(s.db, session, input.TagIDs)
	if err != nil {
		s.logger.Error("create session failed", "error", err)
		return nil, err
	}
	return redactSessionPassword(result), nil
}

func (s *SessionService) UpdateSession(input model.SessionInput) error {
	if err := validateSessionAssetInput(input, true); err != nil {
		return err
	}
	session := input.Session()
	existing, err := store.GetSession(s.db, session.ID)
	if err != nil {
		return fmt.Errorf("update session: %w", err)
	}
	if session.Password == "" {
		session.Password = existing.Password
	} else if s.crypto != nil {
		sealed, sealErr := sealSessionPassword(s.crypto, session.Password)
		if sealErr != nil {
			return fmt.Errorf("update session: encrypt password: %w", sealErr)
		}
		session.Password = sealed
	}
	s.logger.Info("updating session", "id", session.ID, "name", session.Name)
	err = store.UpdateSessionWithTags(s.db, session, input.TagIDs)
	if err != nil {
		s.logger.Error("update session failed", "error", err)
	}
	return err
}

func (s *SessionService) MoveSession(id int64, newFolderID *int64) error {
	if id <= 0 {
		return fmt.Errorf("invalid session id")
	}
	if err := validateOptionalAssetID("folder", newFolderID); err != nil {
		return err
	}
	s.logger.Info("moving session", "id", id, "newFolderID", newFolderID)
	err := store.MoveSession(s.db, id, newFolderID)
	if err != nil {
		s.logger.Error("move session failed", "error", err)
	}
	return err
}

func (s *SessionService) GetSession(id int64) (*model.Session, error) {
	if id <= 0 {
		return nil, fmt.Errorf("invalid session id")
	}
	s.logger.Info("getting session", "id", id)
	session, err := store.GetSession(s.db, id)
	if err != nil {
		return nil, err
	}
	return redactSessionPassword(session), nil
}

func (s *SessionService) sessionForConnect(id int64) (*model.Session, error) {
	if id <= 0 {
		return nil, fmt.Errorf("invalid session id")
	}
	session, err := store.GetSession(s.db, id)
	if err != nil {
		return nil, err
	}
	if s.crypto != nil && session.Password != "" {
		plain, openErr := openSessionPassword(s.crypto, session.Password)
		if openErr != nil {
			return nil, fmt.Errorf("decrypt session password: %w", openErr)
		}
		session.Password = plain
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
	for i := range sessions {
		if sessions[i].Password != "" {
			sessions[i].Password = ""
		}
	}
	return sessions
}
