package service

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SessionService) DeleteSession(id int64) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if id <= 0 {
		return fmt.Errorf("invalid session id")
	}
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "delete", TargetType: "session", TargetID: fmt.Sprint(id), SessionID: &id, Summary: "删除 SSH 会话", Outcome: outcome})
	}()
	s.logger.Info("deleting session", "id", id)
	releaseConnectGuard := s.beginSessionDeletion([]int64{id})
	defer releaseConnectGuard()
	releaseTerminalGuard := s.guardTerminalOpensForDeletion([]int64{id})
	defer releaseTerminalGuard()
	releaseTunnelGuard := s.guardTunnelStartsForDeletion([]int64{id})
	defer releaseTunnelGuard()
	if err := s.prepareSessionsForDeletion([]int64{id}); err != nil {
		s.logger.Error("prepare session deletion failed", "id", id, "error", err)
		return err
	}
	err = s.normalizeSessionDeleteError(
		store.DeleteSessionWithRecordingDirectory(s.db, id, s.recordingsDirectory()),
	)
	if err != nil {
		s.logger.Error("delete session failed", "error", err)
	} else {
		outcome = "success"
	}
	return err
}

func (s *SessionService) DeleteSessions(ids []int64) (int, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return 0, err
	}
	defer finish()
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
	releaseConnectGuard := s.beginSessionDeletion(normalized)
	defer releaseConnectGuard()
	releaseTerminalGuard := s.guardTerminalOpensForDeletion(normalized)
	defer releaseTerminalGuard()
	releaseTunnelGuard := s.guardTunnelStartsForDeletion(normalized)
	defer releaseTunnelGuard()
	if err := s.prepareSessionsForDeletion(normalized); err != nil {
		s.logger.Error("prepare sessions deletion failed", "error", err)
		return 0, err
	}
	err = s.normalizeSessionDeleteError(
		store.DeleteSessionsWithRecordingDirectory(s.db, normalized, s.recordingsDirectory()),
	)
	if err != nil {
		s.logger.Error("delete sessions failed", "error", err)
		return 0, err
	}
	outcome = "success"
	return len(normalized), nil
}

func (s *SessionService) prepareSessionsForDeletion(sessionIDs []int64) error {
	s.CancelConnectForSessions(sessionIDs)
	terminalErr := s.closeTerminalsForSessions(sessionIDs)
	tunnelErr := s.stopTunnelsForSessions(sessionIDs)
	s.cancelTransfersForSessions(sessionIDs)
	connectionErr := s.DisconnectForSessions(sessionIDs)
	var cleanupErr error
	if terminalErr != nil {
		cleanupErr = errors.Join(cleanupErr, fmt.Errorf("close session terminals: %w", terminalErr))
	}
	if tunnelErr != nil {
		cleanupErr = errors.Join(cleanupErr, fmt.Errorf("stop session tunnels: %w", tunnelErr))
	}
	if connectionErr != nil {
		cleanupErr = errors.Join(cleanupErr, fmt.Errorf("disconnect session connections: %w", connectionErr))
	}
	return cleanupErr
}

func (s *SessionService) normalizeSessionDeleteError(err error) error {
	if err == nil {
		return nil
	}
	if !errors.Is(err, store.ErrRecordingCleanupDeferred) {
		return err
	}
	if s.logger != nil {
		s.logger.Warn("session recordings pending maintenance cleanup", "error", err)
	}
	return nil
}

func (s *SessionService) recordingsDirectory() string {
	if strings.TrimSpace(s.dataDir) == "" {
		return ""
	}
	return filepath.Join(s.dataDir, "recordings")
}

func (s *SessionService) SessionsDeleteImpact(ids []int64) (*model.SessionDeleteImpact, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
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
		{"SELECT COUNT(*) FROM transfer_jobs WHERE session_id IN (" + inClause + ") AND status IN ('queued','running')", &impact.Transfers},
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
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if id <= 0 {
		return nil, fmt.Errorf("invalid session id")
	}
	impact := &model.SessionDeleteImpact{}
	queries := []struct {
		query  string
		target *int
	}{
		{"SELECT COUNT(*) FROM tunnels WHERE session_id = ?", &impact.Tunnels},
		{"SELECT COUNT(*) FROM command_history WHERE session_id = ?", &impact.History},
		{"SELECT COUNT(*) FROM session_logs WHERE session_id = ?", &impact.Recordings},
		{"SELECT COUNT(*) FROM transfer_jobs WHERE session_id = ? AND status IN ('queued','running')", &impact.Transfers},
	}
	for _, item := range queries {
		if err := s.db.QueryRow(item.query, id).Scan(item.target); err != nil {
			return nil, fmt.Errorf("session delete impact: %w", err)
		}
	}
	return impact, nil
}
