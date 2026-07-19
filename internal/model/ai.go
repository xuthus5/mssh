package model

import "time"

type AIProviderType string

const (
	AIProviderOpenAICompatible AIProviderType = "openai_compatible"
	AIProviderAnthropic        AIProviderType = "anthropic"
	AIProviderGemini           AIProviderType = "gemini"
	AIProviderOllama           AIProviderType = "ollama"
)

type AIProviderProfile struct {
	ID                    int64          `json:"id"`
	Name                  string         `json:"name"`
	Provider              AIProviderType `json:"provider"`
	BaseURL               string         `json:"base_url"`
	DefaultModel          string         `json:"default_model"`
	Enabled               bool           `json:"enabled"`
	CredentialSaved       bool           `json:"credential_saved"`
	CredentialSessionOnly bool           `json:"credential_session_only"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
}

type AIProviderProfileInput struct {
	ID           int64          `json:"id"`
	Name         string         `json:"name"`
	Provider     AIProviderType `json:"provider"`
	BaseURL      string         `json:"base_url"`
	DefaultModel string         `json:"default_model"`
	Enabled      bool           `json:"enabled"`
	APIKey       string         `json:"api_key"`
}

type AIInteractionSettings struct {
	PanelWidth             int  `json:"panel_width"`
	ContextLines           int  `json:"context_lines"`
	IncludeSessionMetadata bool `json:"include_session_metadata"`
	IncludeSystemSummary   bool `json:"include_system_summary"`
	StreamResponses        bool `json:"stream_responses"`
	AutoScroll             bool `json:"auto_scroll"`
	RenderMarkdown         bool `json:"render_markdown"`
	HistoryRetentionDays   int  `json:"history_retention_days"`
	MaxConversations       int  `json:"max_conversations"`
}

type AISearchMode string

const (
	AISearchDisabled    AISearchMode = "disabled"
	AISearchAuto        AISearchMode = "auto"
	AISearchNative      AISearchMode = "native"
	AISearchIndependent AISearchMode = "independent"
)

type AISearchProvider string

const (
	AISearchProviderBrave  AISearchProvider = "brave"
	AISearchProviderTavily AISearchProvider = "tavily"
	AISearchProviderSerper AISearchProvider = "serper"
)

type AISearchSettings struct {
	Enabled               bool             `json:"enabled"`
	Mode                  AISearchMode     `json:"mode"`
	Provider              AISearchProvider `json:"provider"`
	TimeoutSeconds        int              `json:"timeout_seconds"`
	MaxResults            int              `json:"max_results"`
	RequireCitations      bool             `json:"require_citations"`
	CredentialSaved       bool             `json:"credential_saved"`
	CredentialSessionOnly bool             `json:"credential_session_only"`
}

type AISearchSettingsInput struct {
	Enabled          bool             `json:"enabled"`
	Mode             AISearchMode     `json:"mode"`
	Provider         AISearchProvider `json:"provider"`
	TimeoutSeconds   int              `json:"timeout_seconds"`
	MaxResults       int              `json:"max_results"`
	RequireCitations bool             `json:"require_citations"`
	APIKey           string           `json:"api_key"`
}

type AISecuritySettings struct {
	AutoExecuteReadOnly   bool     `json:"auto_execute_read_only"`
	CommandTimeoutSeconds int      `json:"command_timeout_seconds"`
	MaxOutputBytes        int      `json:"max_output_bytes"`
	MaxPlanSteps          int      `json:"max_plan_steps"`
	AllowPatterns         []string `json:"allow_patterns"`
	DenyPatterns          []string `json:"deny_patterns"`
	RedactionPatterns     []string `json:"redaction_patterns"`
}

type AISettings struct {
	DefaultProviderID  *int64                `json:"default_provider_id"`
	FallbackProviderID *int64                `json:"fallback_provider_id"`
	Interaction        AIInteractionSettings `json:"interaction"`
	Search             AISearchSettings      `json:"search"`
	Security           AISecuritySettings    `json:"security"`
}

type AISettingsInput struct {
	DefaultProviderID  *int64                `json:"default_provider_id"`
	FallbackProviderID *int64                `json:"fallback_provider_id"`
	Interaction        AIInteractionSettings `json:"interaction"`
	Search             AISearchSettingsInput `json:"search"`
	Security           AISecuritySettings    `json:"security"`
}

type AISettingsDashboard struct {
	Settings          AISettings          `json:"settings"`
	Providers         []AIProviderProfile `json:"providers"`
	KeychainAvailable bool                `json:"keychain_available"`
}

type AIAgentCLIStatus struct {
	Name       string    `json:"name"`
	Command    string    `json:"command"`
	Installed  bool      `json:"installed"`
	Path       string    `json:"path"`
	Version    string    `json:"version"`
	Error      string    `json:"error"`
	DetectedAt time.Time `json:"detected_at"`
}

type AICitation struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

type AICommandRisk string

const (
	AICommandRiskReadOnly AICommandRisk = "read_only"
	AICommandRiskModify   AICommandRisk = "modify"
	AICommandRiskHigh     AICommandRisk = "high"
	AICommandRiskBlocked  AICommandRisk = "blocked"
)

type AICommandProposal struct {
	Command              string        `json:"command"`
	Purpose              string        `json:"purpose"`
	Risk                 AICommandRisk `json:"risk"`
	Blocked              bool          `json:"blocked"`
	BlockedReason        string        `json:"blocked_reason"`
	CanAutoExecute       bool          `json:"can_auto_execute"`
	RequiresConfirmation bool          `json:"requires_confirmation"`
}

type AIChatRequest struct {
	ConversationID  int64  `json:"conversation_id"`
	SessionID       int64  `json:"session_id"`
	TerminalID      string `json:"terminal_id"`
	Prompt          string `json:"prompt"`
	TerminalContext string `json:"terminal_context"`
	UseSearch       bool   `json:"use_search"`
}

type AIChatResponse struct {
	ConversationID int64               `json:"conversation_id"`
	Answer         string              `json:"answer"`
	Commands       []AICommandProposal `json:"commands"`
	Citations      []AICitation        `json:"citations"`
	ProviderID     int64               `json:"provider_id"`
}

type AICommandExecutionInput struct {
	ConversationID int64  `json:"conversation_id"`
	SessionID      int64  `json:"session_id"`
	TerminalID     string `json:"terminal_id"`
	Command        string `json:"command"`
	Approved       bool   `json:"approved"`
}

type AIConversation struct {
	ID        int64     `json:"id"`
	SessionID int64     `json:"session_id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AIMessage struct {
	ID             int64     `json:"id"`
	ConversationID int64     `json:"conversation_id"`
	Role           string    `json:"role"`
	Content        string    `json:"content"`
	CreatedAt      time.Time `json:"created_at"`
}
