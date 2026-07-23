package service

import (
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SessionService) DeleteSession(id int64) error {
	if id <= 0 {
		return fmt.Errorf("invalid session id")
	}
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "delete", TargetType: "session", TargetID: fmt.Sprint(id), SessionID: &id, Summary: "删除 SSH 会话", Outcome: outcome})
	}()
	s.logger.Info("deleting session", "id", id)
	s.stopTunnelsForSessions([]int64{id})
	s.cancelTransfersForSessions([]int64{id})
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
	s.stopTunnelsForSessions(normalized)
	s.cancelTransfersForSessions(normalized)
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
