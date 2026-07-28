package service

import "fmt"

func (s *AIService) validateAITarget(conversationID, sessionID int64, terminalID string) error {
	if err := s.validateAIConversationTarget(conversationID, sessionID); err != nil {
		return err
	}
	if s.terminals == nil {
		return nil
	}
	terminalSessionID, ok := s.terminals.terminalSessionID(terminalID)
	if !ok {
		return fmt.Errorf("AI terminal is unavailable")
	}
	if terminalSessionID != sessionID {
		return fmt.Errorf("AI terminal does not belong to session")
	}
	return nil
}

func (s *AIService) validateAIConversationTarget(conversationID, sessionID int64) error {
	if conversationID == 0 {
		return nil
	}
	if conversationID < 0 {
		return fmt.Errorf("invalid AI conversation id")
	}
	var matches bool
	err := s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM ai_conversations WHERE id=? AND session_id=?)`, conversationID, sessionID).Scan(&matches)
	if err != nil {
		return fmt.Errorf("validate AI conversation target: %w", err)
	}
	if !matches {
		return fmt.Errorf("AI conversation does not belong to session")
	}
	return nil
}
