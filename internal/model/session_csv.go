package model

type SessionCSVConflictPolicy string

const (
	SessionCSVConflictSkip      SessionCSVConflictPolicy = "skip"
	SessionCSVConflictOverwrite SessionCSVConflictPolicy = "overwrite"
)

type SessionCSVExportOptions struct {
	SessionIDs       []int64 `json:"session_ids"`
	IncludePasswords bool    `json:"include_passwords"`
}

type SessionCSVExportResult struct {
	Count             int  `json:"count"`
	IncludedPasswords bool `json:"included_passwords"`
}

type SessionCSVImportOptions struct {
	ConflictPolicy SessionCSVConflictPolicy `json:"conflict_policy"`
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
