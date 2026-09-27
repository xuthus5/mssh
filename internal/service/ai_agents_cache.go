package service

import (
	"encoding/json"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const (
	aiAgentCLIStatusNamespace  = "ai"
	aiAgentCLIStatusSettingKey = "ai.agent_cli_status"
)

// GetAgentCLIStatuses returns the last detection snapshot without probing the
// machine again, so reopening settings still shows the previous result. Call
// DetectAgentCLIs to refresh it; the refresh writes the new snapshot.
func (s *AIService) GetAgentCLIStatuses() []model.AIAgentCLIStatus {
	_, finish, err := s.beginOperation()
	if err != nil {
		return []model.AIAgentCLIStatus{}
	}
	defer finish()
	if s.db == nil {
		return []model.AIAgentCLIStatus{}
	}
	entry, err := store.GetSettingEntry(s.db, aiAgentCLIStatusSettingKey)
	if err != nil || entry == nil {
		return []model.AIAgentCLIStatus{}
	}
	var statuses []model.AIAgentCLIStatus
	if err := json.Unmarshal([]byte(entry.Value), &statuses); err != nil || statuses == nil {
		return []model.AIAgentCLIStatus{}
	}
	return statuses
}

func (s *AIService) cacheAgentCLIStatuses(statuses []model.AIAgentCLIStatus) {
	if s == nil || s.db == nil {
		return
	}
	encoded, err := json.Marshal(statuses)
	if err != nil {
		return
	}
	err = store.SetSettings(s.db, []model.Setting{{
		Key:       aiAgentCLIStatusSettingKey,
		Namespace: aiAgentCLIStatusNamespace,
		Value:     string(encoded),
		ValueType: "array",
		Version:   1,
	}})
	if err != nil {
		s.logger.Warn("cache AI agent CLI statuses failed", "error", err)
	}
}
