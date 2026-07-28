package store

import (
	"database/sql"
	"errors"
	"fmt"
)

type AIConversationExchange struct {
	ConversationID   int64
	SessionID        int64
	Title            string
	UserContent      string
	AssistantContent string
	RetentionDays    int
	MaxConversations int
}

func SaveAIConversationExchange(db *sql.DB, exchange AIConversationExchange) (int64, error) {
	tx, err := db.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin AI conversation exchange: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	conversationID, err := resolveAIConversation(tx, exchange)
	if err != nil {
		return 0, err
	}
	if err := insertAIExchange(tx, conversationID, exchange); err != nil {
		return 0, err
	}
	if err := pruneAIConversationsTx(tx, exchange.RetentionDays, exchange.MaxConversations); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit AI conversation exchange: %w", err)
	}
	return conversationID, nil
}

func resolveAIConversation(tx *sql.Tx, exchange AIConversationExchange) (int64, error) {
	if exchange.ConversationID == 0 {
		result, err := tx.Exec(`INSERT INTO ai_conversations (session_id, title) VALUES (?, ?)`, exchange.SessionID, exchange.Title)
		if err != nil {
			return 0, fmt.Errorf("create AI conversation: %w", err)
		}
		conversationID, err := result.LastInsertId()
		if err != nil {
			return 0, fmt.Errorf("create AI conversation id: %w", err)
		}
		return conversationID, nil
	}
	var sessionID int64
	err := tx.QueryRow(`SELECT session_id FROM ai_conversations WHERE id=?`, exchange.ConversationID).Scan(&sessionID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("AI conversation does not belong to session")
	}
	if err != nil {
		return 0, fmt.Errorf("load AI conversation target: %w", err)
	}
	if sessionID != exchange.SessionID {
		return 0, fmt.Errorf("AI conversation does not belong to session")
	}
	return exchange.ConversationID, nil
}

func insertAIExchange(tx *sql.Tx, conversationID int64, exchange AIConversationExchange) error {
	if _, err := tx.Exec(`INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, 'user', ?)`, conversationID, exchange.UserContent); err != nil {
		return fmt.Errorf("add AI user message: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, 'assistant', ?)`, conversationID, exchange.AssistantContent); err != nil {
		return fmt.Errorf("add AI assistant message: %w", err)
	}
	if _, err := tx.Exec(`UPDATE ai_conversations SET updated_at=datetime('now') WHERE id=?`, conversationID); err != nil {
		return fmt.Errorf("touch AI conversation: %w", err)
	}
	return nil
}

func pruneAIConversationsTx(tx *sql.Tx, retentionDays, maxConversations int) error {
	if retentionDays > 0 {
		if _, err := tx.Exec(`DELETE FROM ai_conversations WHERE updated_at < datetime('now', ?)`, fmt.Sprintf("-%d days", retentionDays)); err != nil {
			return fmt.Errorf("prune AI conversations by age: %w", err)
		}
	}
	if maxConversations > 0 {
		if _, err := tx.Exec(`DELETE FROM ai_conversations WHERE id NOT IN (SELECT id FROM ai_conversations ORDER BY updated_at DESC LIMIT ?)`, maxConversations); err != nil {
			return fmt.Errorf("prune AI conversations by count: %w", err)
		}
	}
	return nil
}
