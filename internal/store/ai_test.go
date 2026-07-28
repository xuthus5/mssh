package store

import (
	"database/sql"
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
	assert.ErrorContains(t, DeleteAIProviderProfile(db, created.ID), "not found")
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

func TestAISettingsSaveAndPruneIsAtomic(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{Name: "ai", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent, KeepAlive: 30})
	require.NoError(t, err)
	conversationID, err := CreateAIConversation(db, session.ID, "protected")
	require.NoError(t, err)
	_, err = db.Exec("UPDATE ai_conversations SET updated_at=datetime('now', '-60 days') WHERE id=?", conversationID)
	require.NoError(t, err)
	initial := model.AISettings{Interaction: model.AIInteractionSettings{PanelWidth: 420}}
	require.NoError(t, SaveAISettings(db, initial))
	_, err = db.Exec(`CREATE TRIGGER fail_ai_prune BEFORE DELETE ON ai_conversations BEGIN SELECT RAISE(ABORT, 'prune failed'); END`)
	require.NoError(t, err)
	updated := initial
	updated.Interaction.PanelWidth = 500
	updated.Interaction.HistoryRetentionDays = 30
	require.ErrorContains(t, SaveAISettingsAndPrune(db, updated), "prune failed")
	loaded, err := LoadAISettings(db, model.AISettings{})
	require.NoError(t, err)
	assert.Equal(t, 420, loaded.Interaction.PanelWidth)
	conversations, err := ListAIConversations(db, session.ID, 10)
	require.NoError(t, err)
	assert.Len(t, conversations, 1)
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

func TestAIConversationExchangeIsAtomicAndSessionScoped(t *testing.T) {
	db := setupTestDB(t)
	first, err := CreateSession(db, model.Session{Name: "first", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent, KeepAlive: 30})
	require.NoError(t, err)
	second, err := CreateSession(db, model.Session{Name: "second", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent, KeepAlive: 30})
	require.NoError(t, err)
	exchange := AIConversationExchange{SessionID: first.ID, Title: "question", UserContent: "user one", AssistantContent: "assistant one", RetentionDays: 30, MaxConversations: 10}
	conversationID, err := SaveAIConversationExchange(db, exchange)
	require.NoError(t, err)
	exchange.ConversationID = conversationID
	exchange.UserContent = "user two"
	exchange.AssistantContent = "assistant two"
	_, err = SaveAIConversationExchange(db, exchange)
	require.NoError(t, err)
	messages, err := ListAIMessages(db, conversationID)
	require.NoError(t, err)
	assert.Len(t, messages, 4)

	exchange.SessionID = second.ID
	_, err = SaveAIConversationExchange(db, exchange)
	assert.ErrorContains(t, err, "does not belong")
	exchange.ConversationID = 999
	_, err = SaveAIConversationExchange(db, exchange)
	assert.ErrorContains(t, err, "does not belong")
	messages, err = ListAIMessages(db, conversationID)
	require.NoError(t, err)
	assert.Len(t, messages, 4)
}

func TestAIConversationExchangeRollsBackOnPersistenceFailure(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{Name: "ai", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent, KeepAlive: 30})
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TRIGGER fail_assistant_message BEFORE INSERT ON ai_messages WHEN NEW.role = 'assistant' BEGIN SELECT RAISE(ABORT, 'assistant persistence failed'); END`)
	require.NoError(t, err)
	_, err = SaveAIConversationExchange(db, AIConversationExchange{SessionID: session.ID, Title: "question", UserContent: "user", AssistantContent: "assistant"})
	assert.ErrorContains(t, err, "assistant persistence failed")
	conversations, err := ListAIConversations(db, session.ID, 10)
	require.NoError(t, err)
	assert.Empty(t, conversations)
}

func TestAIConversationExchangeRollsBackOnUserAndTouchFailures(t *testing.T) {
	for _, testCase := range []struct {
		name    string
		trigger string
	}{
		{name: "user", trigger: `CREATE TRIGGER fail_user_message BEFORE INSERT ON ai_messages WHEN NEW.role = 'user' BEGIN SELECT RAISE(ABORT, 'user persistence failed'); END`},
		{name: "touch", trigger: `CREATE TRIGGER fail_conversation_touch BEFORE UPDATE ON ai_conversations BEGIN SELECT RAISE(ABORT, 'touch persistence failed'); END`},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			db := setupTestDB(t)
			session, err := CreateSession(db, model.Session{Name: "ai", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent, KeepAlive: 30})
			require.NoError(t, err)
			_, err = db.Exec(testCase.trigger)
			require.NoError(t, err)
			_, err = SaveAIConversationExchange(db, AIConversationExchange{SessionID: session.ID, Title: "question", UserContent: "user", AssistantContent: "assistant"})
			assert.Error(t, err)
			conversations, listErr := ListAIConversations(db, session.ID, 10)
			require.NoError(t, listErr)
			assert.Empty(t, conversations)
		})
	}
}

func TestAIConversationExchangeRollsBackOnPruneFailures(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		configure func(*testing.T, *sql.DB, int64) AIConversationExchange
	}{
		{name: "retention", configure: func(t *testing.T, db *sql.DB, sessionID int64) AIConversationExchange {
			conversationID, err := CreateAIConversation(db, sessionID, "old")
			require.NoError(t, err)
			_, err = db.Exec("UPDATE ai_conversations SET updated_at=datetime('now', '-60 days') WHERE id=?", conversationID)
			require.NoError(t, err)
			return AIConversationExchange{SessionID: sessionID, Title: "new", UserContent: "user", AssistantContent: "assistant", RetentionDays: 30}
		}},
		{name: "count", configure: func(t *testing.T, db *sql.DB, sessionID int64) AIConversationExchange {
			conversationID, err := CreateAIConversation(db, sessionID, "old")
			require.NoError(t, err)
			_, err = db.Exec("UPDATE ai_conversations SET updated_at=datetime('now', '-1 day') WHERE id=?", conversationID)
			require.NoError(t, err)
			return AIConversationExchange{SessionID: sessionID, Title: "new", UserContent: "user", AssistantContent: "assistant", MaxConversations: 1}
		}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			db := setupTestDB(t)
			session, err := CreateSession(db, model.Session{Name: "ai", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent, KeepAlive: 30})
			require.NoError(t, err)
			exchange := testCase.configure(t, db, session.ID)
			_, err = db.Exec(`CREATE TRIGGER fail_conversation_prune BEFORE DELETE ON ai_conversations BEGIN SELECT RAISE(ABORT, 'prune persistence failed'); END`)
			require.NoError(t, err)
			_, err = SaveAIConversationExchange(db, exchange)
			assert.ErrorContains(t, err, "prune persistence failed")
			conversations, listErr := ListAIConversations(db, session.ID, 10)
			require.NoError(t, listErr)
			assert.Len(t, conversations, 1)
		})
	}
}

func TestAIConversationExchangeReportsTargetAndCommitErrors(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{Name: "ai", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent, KeepAlive: 30})
	require.NoError(t, err)
	conversationID, err := CreateAIConversation(db, session.ID, "existing")
	require.NoError(t, err)
	_, err = db.Exec("ALTER TABLE ai_conversations RENAME TO unavailable_ai_conversations")
	require.NoError(t, err)
	_, err = SaveAIConversationExchange(db, AIConversationExchange{ConversationID: conversationID, SessionID: session.ID})
	assert.ErrorContains(t, err, "load AI conversation target")

	commitDB := setupTestDB(t)
	_, err = commitDB.Exec("PRAGMA defer_foreign_keys = ON")
	require.NoError(t, err)
	_, err = SaveAIConversationExchange(commitDB, AIConversationExchange{SessionID: 999, Title: "invalid", UserContent: "user", AssistantContent: "assistant"})
	assert.ErrorContains(t, err, "commit AI conversation exchange")
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
	_, err = SaveAIConversationExchange(db, AIConversationExchange{SessionID: 1})
	assert.Error(t, err)
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
