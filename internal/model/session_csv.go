package model

type SessionCSVConflictPolicy string

type SessionCSVColumn string

const (
	SessionCSVConflictSkip      SessionCSVConflictPolicy = "skip"
	SessionCSVConflictOverwrite SessionCSVConflictPolicy = "overwrite"
)

const (
	SessionCSVColumnName         SessionCSVColumn = "name"
	SessionCSVColumnHost         SessionCSVColumn = "host"
	SessionCSVColumnPort         SessionCSVColumn = "port"
	SessionCSVColumnUsername     SessionCSVColumn = "username"
	SessionCSVColumnAuthMethod   SessionCSVColumn = "auth_method"
	SessionCSVColumnPassword     SessionCSVColumn = "password"
	SessionCSVColumnKeyName      SessionCSVColumn = "key_name"
	SessionCSVColumnKeyPublicKey SessionCSVColumn = "key_public_key"
	SessionCSVColumnFolderPath   SessionCSVColumn = "folder_path"
	SessionCSVColumnEnvironment  SessionCSVColumn = "environment"
	SessionCSVColumnProject      SessionCSVColumn = "project"
	SessionCSVColumnTags         SessionCSVColumn = "tags"
	SessionCSVColumnNotes        SessionCSVColumn = "notes"
	SessionCSVColumnKeepAlive    SessionCSVColumn = "keep_alive"
	SessionCSVColumnTermType     SessionCSVColumn = "term_type"
)

type SessionCSVExportOptions struct {
	SessionIDs       []int64 `json:"session_ids"`
	IncludePasswords bool    `json:"include_passwords"`
	// ConfirmPassword is required when IncludePasswords is true (step-up auth).
	ConfirmPassword string `json:"confirm_password,omitempty"`
}

type SessionCSVExportResult struct {
	Count             int  `json:"count"`
	IncludedPasswords bool `json:"included_passwords"`
}

type SessionCSVImportOptions struct {
	ConflictPolicy SessionCSVConflictPolicy    `json:"conflict_policy"`
	HeaderMapping  map[SessionCSVColumn]string `json:"header_mapping,omitempty"`
	DefaultValues  map[SessionCSVColumn]string `json:"default_values,omitempty"`
}

type SessionCSVPreview struct {
	Headers    []string   `json:"headers"`
	SampleRows [][]string `json:"sample_rows"`
	TotalRows  int        `json:"total_rows"`
}

type SessionCSVImportResult struct {
	Row       int    `json:"row"`
	Name      string `json:"name"`
	Host      string `json:"host"`
	Status    string `json:"status"`
	SessionID int64  `json:"session_id,omitempty"`
	Error     string `json:"error,omitempty"`
}

type SessionCSVImportSummary struct {
	Total    int                      `json:"total"`
	Imported int                      `json:"imported"`
	Updated  int                      `json:"updated"`
	Skipped  int                      `json:"skipped"`
	Failed   int                      `json:"failed"`
	Results  []SessionCSVImportResult `json:"results"`
}
