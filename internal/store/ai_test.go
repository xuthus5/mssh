package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestAIProviderProfileCRUD(t *testing.T) {
	db := setupTestDB(t)
	created, err := SaveAIProviderProfile(db, model.AIProviderProfileInput{
		Name: "OpenAI", Provider: model.AIProviderOpenAICompatible,
		BaseURL: "https://api.openai.com/v1", DefaultModel: "gpt-5", Enabled: true,
	})
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
	created.Name = "Primary"
	updated, err := SaveAIProviderProfile(db, model.AIProviderProfileInput{
		ID: created.ID, Name: created.Name, Provider: created.Provider,
		BaseURL: created.BaseURL, DefaultModel: created.DefaultModel, Enabled: true,
	})
	require.NoError(t, err)
	assert.Equal(t, "Primary", updated.Name)
	profiles, err := ListAIProviderProfiles(db)
	require.NoError(t, err)
	assert.Len(t, profiles, 1)
	require.NoError(t, DeleteAIProviderProfile(db, created.ID))
	profile, err := GetAIProviderProfile(db, created.ID)
	require.NoError(t, err)
	assert.Nil(t, profile)
}

func TestAISettingsRoundTrip(t *testing.T) {
	db := setupTestDB(t)
	defaults := model.AISettings{Interaction: model.AIInteractionSettings{PanelWidth: 420}}
	loaded, err := LoadAISettings(db, defaults)
	require.NoError(t, err)
	assert.Equal(t, 420, loaded.Interaction.PanelWidth)
	loaded.Search.Enabled = true
	loaded.Security.MaxPlanSteps = 8
	require.NoError(t, SaveAISettings(db, loaded))
	loaded, err = LoadAISettings(db, model.AISettings{})
	require.NoError(t, err)
	assert.True(t, loaded.Search.Enabled)
	assert.Equal(t, 8, loaded.Security.MaxPlanSteps)
}

func TestAIHistoryLifecycle(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{
		Name: "ai", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthAgent, KeepAlive: 30,
	})
	require.NoError(t, err)
	conversationID, err := CreateAIConversation(db, session.ID, "排查服务")
	require.NoError(t, err)
	require.NoError(t, AddAIMessage(db, conversationID, "user", "检查 nginx"))
	conversations, err := ListAIConversations(db, session.ID, 10)
	require.NoError(t, err)
	assert.Len(t, conversations, 1)
	messages, err := ListAIMessages(db, conversationID)
	require.NoError(t, err)
	assert.Equal(t, "检查 nginx", messages[0].Content)
	require.NoError(t, DeleteAIConversation(db, conversationID))
	messages, err = ListAIMessages(db, conversationID)
	require.NoError(t, err)
	assert.Empty(t, messages)
}

func TestAIHistoryRejectsInvalidTimestamps(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{
		Name: "ai", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthAgent, KeepAlive: 30,
	})
	require.NoError(t, err)
	conversationID, err := CreateAIConversation(db, session.ID, "invalid")
	require.NoError(t, err)
	_, err = db.Exec("UPDATE ai_conversations SET created_at='invalid' WHERE id=?", conversationID)
	require.NoError(t, err)
	_, err = ListAIConversations(db, session.ID, 10)
	assert.ErrorContains(t, err, "created_at")
}

func TestAIHistoryPrunesAndRecordsExecutions(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{Name: "ai", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent, KeepAlive: 30})
	require.NoError(t, err)
	first, err := CreateAIConversation(db, session.ID, "first")
	require.NoError(t, err)
	second, err := CreateAIConversation(db, session.ID, "second")
	require.NoError(t, err)
	_, err = db.Exec("UPDATE ai_conversations SET updated_at=datetime('now', '-60 days') WHERE id=?", first)
	require.NoError(t, err)
	require.NoError(t, PruneAIConversations(db, 30, 1))
	conversations, err := ListAIConversations(db, session.ID, 10)
	require.NoError(t, err)
	require.Len(t, conversations, 1)
	assert.Equal(t, second, conversations[0].ID)
	require.NoError(t, RecordAICommandExecution(db, model.AICommandExecutionInput{SessionID: session.ID, TerminalID: "term", Command: "pwd", Approved: true}, model.AICommandRiskReadOnly, "success", ""))
	assertTableRowCount(t, rowCountExpectation{db: db, table: "ai_command_executions", expected: 1})
}

func TestAIStoreReportsDatabaseAndDecodeErrors(t *testing.T) {
	db := setupTestDB(t)
	_, err := db.Exec(`INSERT INTO ai_settings (id, interaction_json, search_json, security_json) VALUES (1, '{', '{}', '{}')`)
	require.NoError(t, err)
	_, err = LoadAISettings(db, model.AISettings{})
	assert.ErrorContains(t, err, "interaction")
	_, err = SaveAIProviderProfile(db, model.AIProviderProfileInput{ID: 999, Name: "missing", Provider: model.AIProviderOllama, BaseURL: "http://localhost", DefaultModel: "x"})
	assert.ErrorContains(t, err, "not found")
	require.NoError(t, db.Close())
	_, err = ListAIProviderProfiles(db)
	assert.Error(t, err)
	_, err = SaveAIProviderProfile(db, model.AIProviderProfileInput{Name: "closed", Provider: model.AIProviderOllama, BaseURL: "http://localhost", DefaultModel: "x"})
	assert.Error(t, err)
	_, err = GetAIProviderProfile(db, 1)
	assert.Error(t, err)
	_, err = LoadAISettings(db, model.AISettings{})
	assert.Error(t, err)
	assert.Error(t, DeleteAIProviderProfile(db, 1))
	assert.Error(t, SaveAISettings(db, model.AISettings{}))
	_, err = CreateAIConversation(db, 1, "closed")
	assert.Error(t, err)
	assert.Error(t, AddAIMessage(db, 1, "user", "closed"))
	_, err = ListAIConversations(db, 1, 10)
	assert.Error(t, err)
	_, err = ListAIMessages(db, 1)
	assert.Error(t, err)
	assert.Error(t, DeleteAIConversation(db, 1))
	assert.Error(t, PruneAIConversations(db, 1, 1))
	assert.Error(t, RecordAICommandExecution(db, model.AICommandExecutionInput{SessionID: 1}, model.AICommandRiskReadOnly, "success", ""))
}

func TestAIMessageRejectsInvalidTimestamp(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{Name: "ai", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent, KeepAlive: 30})
	require.NoError(t, err)
	conversationID, err := CreateAIConversation(db, session.ID, "invalid")
	require.NoError(t, err)
	require.NoError(t, AddAIMessage(db, conversationID, "user", "hello"))
	_, err = db.Exec("UPDATE ai_messages SET created_at='invalid' WHERE conversation_id=?", conversationID)
	require.NoError(t, err)
	_, err = ListAIMessages(db, conversationID)
	assert.ErrorContains(t, err, "created_at")
}
