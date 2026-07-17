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
	s.logger.Info("creating folder", "name", name, "parentID", parentID)
	result, err := store.CreateFolder(s.db, name, parentID)
	if err != nil {
		s.logger.Error("create folder failed", "error", err)
	}
	return result, err
}

func (s *SessionService) UpdateFolder(id int64, name string) error {
	s.logger.Info("updating folder", "id", id, "name", name)
	err := store.UpdateFolder(s.db, id, name)
	if err != nil {
		s.logger.Error("update folder failed", "error", err)
	}
	return err
}

func (s *SessionService) DeleteFolder(id int64) error {
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
	s.logger.Info("setting default folder", "id", id)
	return store.SetDefaultFolder(s.db, id)
}

func (s *SessionService) MoveFolder(id int64, newParentID *int64) error {
	s.logger.Info("moving folder", "id", id, "newParentID", newParentID)
	err := store.MoveFolder(s.db, id, newParentID)
	if err != nil {
		s.logger.Error("move folder failed", "error", err)
	}
	return err
}

func (s *SessionService) ListSessions(folderID *int64) ([]model.Session, error) {
	s.logger.Info("listing sessions", "folderID", folderID)
	return store.ListSessions(s.db, folderID)
}

func (s *SessionService) ListRecentSessions(limit int) ([]model.Session, error) {
	s.logger.Info("listing recent sessions", "limit", limit)
	return store.ListRecentSessions(s.db, limit)
}

func (s *SessionService) CreateSession(input model.SessionInput) (*model.Session, error) {
	if err := validateSessionAssetInput(input, false); err != nil {
		return nil, err
	}
	session := input.Session()
	s.logger.Info("creating session", "name", session.Name, "authMethod", session.AuthMethod)
	result, err := store.CreateSessionWithTags(s.db, session, input.TagIDs)
	if err != nil {
		s.logger.Error("create session failed", "error", err)
	}
	return result, err
}

func (s *SessionService) UpdateSession(input model.SessionInput) error {
	if err := validateSessionAssetInput(input, true); err != nil {
		return err
	}
	session := input.Session()
	s.logger.Info("updating session", "id", session.ID, "name", session.Name)
	err := store.UpdateSessionWithTags(s.db, session, input.TagIDs)
	if err != nil {
		s.logger.Error("update session failed", "error", err)
	}
	return err
}

func (s *SessionService) DeleteSession(id int64) error {
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "delete", TargetType: "session", TargetID: fmt.Sprint(id), SessionID: &id, Summary: "删除 SSH 会话", Outcome: outcome})
	}()
	s.logger.Info("deleting session", "id", id)
	err := store.DeleteSession(s.db, id)
	if err != nil {
		s.logger.Error("delete session failed", "error", err)
	} else {
		outcome = "success"
	}
	return err
}

func (s *SessionService) SessionDeleteImpact(id int64) (*model.SessionDeleteImpact, error) {
	impact := &model.SessionDeleteImpact{}
	queries := []struct {
		query  string
		target *int
	}{
		{"SELECT COUNT(*) FROM tunnels WHERE session_id = ?", &impact.Tunnels},
		{"SELECT COUNT(*) FROM command_history WHERE session_id = ?", &impact.History},
		{"SELECT COUNT(*) FROM session_logs WHERE session_id = ?", &impact.Recordings},
	}
	for _, item := range queries {
		if err := s.db.QueryRow(item.query, id).Scan(item.target); err != nil {
			return nil, fmt.Errorf("session delete impact: %w", err)
		}
	}
	return impact, nil
}

func (s *SessionService) MoveSession(id int64, newFolderID *int64) error {
	s.logger.Info("moving session", "id", id, "newFolderID", newFolderID)
	err := store.MoveSession(s.db, id, newFolderID)
	if err != nil {
		s.logger.Error("move session failed", "error", err)
	}
	return err
}

func (s *SessionService) GetSession(id int64) (*model.Session, error) {
	s.logger.Info("getting session", "id", id)
	return store.GetSession(s.db, id)
}
