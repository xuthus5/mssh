package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

func CreateAIConversation(db *sql.DB, sessionID int64, title string) (int64, error) {
	result, err := db.Exec(`INSERT INTO ai_conversations (session_id, title) VALUES (?, ?)`, sessionID, title)
	if err != nil {
		return 0, fmt.Errorf("create ai conversation: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("create ai conversation id: %w", err)
	}
	return id, nil
}

func AddAIMessage(db *sql.DB, conversationID int64, role, content string) error {
	if _, err := db.Exec(`INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)`, conversationID, role, content); err != nil {
		return fmt.Errorf("add ai message: %w", err)
	}
	if _, err := db.Exec(`UPDATE ai_conversations SET updated_at=datetime('now') WHERE id=?`, conversationID); err != nil {
		return fmt.Errorf("touch ai conversation: %w", err)
	}
	return nil
}

func ListAIConversations(db *sql.DB, sessionID int64, limit int) ([]model.AIConversation, error) {
	rows, err := db.Query(`SELECT id, session_id, title, created_at, updated_at FROM ai_conversations WHERE session_id=? ORDER BY updated_at DESC LIMIT ?`, sessionID, limit)
	if err != nil {
		return nil, fmt.Errorf("list ai conversations: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]model.AIConversation, 0)
	for rows.Next() {
		var conversation model.AIConversation
		var createdAt, updatedAt string
		if err := rows.Scan(&conversation.ID, &conversation.SessionID, &conversation.Title, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan ai conversation: %w", err)
		}
		conversation.CreatedAt, err = time.Parse("2006-01-02 15:04:05", createdAt)
		if err != nil {
			return nil, fmt.Errorf("parse ai conversation created_at: %w", err)
		}
		conversation.UpdatedAt, err = time.Parse("2006-01-02 15:04:05", updatedAt)
		if err != nil {
			return nil, fmt.Errorf("parse ai conversation updated_at: %w", err)
		}
		result = append(result, conversation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate ai conversations: %w", err)
	}
	return result, nil
}

func ListAIMessages(db *sql.DB, conversationID int64) ([]model.AIMessage, error) {
	rows, err := db.Query(`SELECT id, conversation_id, role, content, created_at FROM ai_messages WHERE conversation_id=? ORDER BY id`, conversationID)
	if err != nil {
		return nil, fmt.Errorf("list ai messages: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]model.AIMessage, 0)
	for rows.Next() {
		var message model.AIMessage
		var createdAt string
		if err := rows.Scan(&message.ID, &message.ConversationID, &message.Role, &message.Content, &createdAt); err != nil {
			return nil, fmt.Errorf("scan ai message: %w", err)
		}
		message.CreatedAt, err = time.Parse("2006-01-02 15:04:05", createdAt)
		if err != nil {
			return nil, fmt.Errorf("parse ai message created_at: %w", err)
		}
		result = append(result, message)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate ai messages: %w", err)
	}
	return result, nil
}

func DeleteAIConversation(db *sql.DB, id int64) error {
	if _, err := db.Exec("DELETE FROM ai_conversations WHERE id=?", id); err != nil {
		return fmt.Errorf("delete ai conversation: %w", err)
	}
	return nil
}

func PruneAIConversations(db *sql.DB, retentionDays, maxConversations int) error {
	if retentionDays > 0 {
		if _, err := db.Exec(`DELETE FROM ai_conversations WHERE updated_at < datetime('now', ?)`, fmt.Sprintf("-%d days", retentionDays)); err != nil {
			return fmt.Errorf("prune ai conversations by age: %w", err)
		}
	}
	if maxConversations > 0 {
		if _, err := db.Exec(`DELETE FROM ai_conversations WHERE id NOT IN (SELECT id FROM ai_conversations ORDER BY updated_at DESC LIMIT ?)`, maxConversations); err != nil {
			return fmt.Errorf("prune ai conversations by count: %w", err)
		}
	}
	return nil
}

func RecordAICommandExecution(db *sql.DB, input model.AICommandExecutionInput, risk model.AICommandRisk, outcome, errorMessage string) error {
	var conversationID any
	if input.ConversationID > 0 {
		conversationID = input.ConversationID
	}
	_, err := db.Exec(`INSERT INTO ai_command_executions (conversation_id, session_id, terminal_id, command, risk, approved, outcome, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, conversationID, input.SessionID, input.TerminalID, input.Command, risk, input.Approved, outcome, errorMessage)
	if err != nil {
		return fmt.Errorf("record ai command execution: %w", err)
	}
	return nil
}
