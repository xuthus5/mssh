package service

import (
	"fmt"
	"strings"

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

func (s *SessionService) DeleteSessions(ids []int64) (int, error) {
	normalized, err := normalizedSessionIDs(ids)
	if err != nil {
		return 0, err
	}
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{
			Action: "batch_delete", TargetType: "session",
			Summary: fmt.Sprintf("批量删除 %d 个 SSH 会话", len(normalized)), Outcome: outcome,
		})
	}()
	s.logger.Info("deleting sessions", "count", len(normalized))
	if err := store.DeleteSessions(s.db, normalized); err != nil {
		s.logger.Error("delete sessions failed", "error", err)
		return 0, err
	}
	outcome = "success"
	return len(normalized), nil
}

func (s *SessionService) SessionsDeleteImpact(ids []int64) (*model.SessionDeleteImpact, error) {
	normalized, err := normalizedSessionIDs(ids)
	if err != nil {
		return nil, err
	}
	impact := &model.SessionDeleteImpact{}
	placeholders := make([]string, len(normalized))
	arguments := make([]any, len(normalized))
	for index, id := range normalized {
		placeholders[index] = "?"
		arguments[index] = id
	}
	inClause := strings.Join(placeholders, ",")
	queries := []struct {
		query  string
		target *int
	}{
		{"SELECT COUNT(*) FROM tunnels WHERE session_id IN (" + inClause + ")", &impact.Tunnels},
		{"SELECT COUNT(*) FROM command_history WHERE session_id IN (" + inClause + ")", &impact.History},
		{"SELECT COUNT(*) FROM session_logs WHERE session_id IN (" + inClause + ")", &impact.Recordings},
	}
	for _, item := range queries {
		if err := s.db.QueryRow(item.query, arguments...).Scan(item.target); err != nil {
			return nil, fmt.Errorf("sessions delete impact: %w", err)
		}
	}
	return impact, nil
}

func normalizedSessionIDs(ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, fmt.Errorf("at least one session id is required")
	}
	seen := make(map[int64]struct{}, len(ids))
	result := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			return nil, fmt.Errorf("invalid session id %d", id)
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result, nil
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
	s.logger.Info("getting session", "id", id)
	session, err := store.GetSession(s.db, id)
	if err != nil {
		return nil, err
	}
	return redactSessionPassword(session), nil
}

func (s *SessionService) sessionForConnect(id int64) (*model.Session, error) {
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
