package model

import "time"

type ThemeMode string

const (
	ThemeModeDark      ThemeMode = "dark"
	ThemeModeLight     ThemeMode = "light"
	ThemeModeUniversal ThemeMode = "universal"
)

type ThemeSourceType string

const (
	ThemeSourceBuiltin   ThemeSourceType = "builtin"
	ThemeSourceITerm2    ThemeSourceType = "iterm2"
	ThemeSourceCommunity ThemeSourceType = "community"
	ThemeSourceCustom    ThemeSourceType = "custom"
)

type CursorStyle string

const (
	CursorStyleBlock     CursorStyle = "block"
	CursorStyleUnderline CursorStyle = "underline"
	CursorStyleBar       CursorStyle = "bar"
)

type TerminalColorPayload struct {
	Background string   `json:"background"`
	Foreground string   `json:"foreground"`
	Cursor     string   `json:"cursor"`
	Selection  string   `json:"selection"`
	ANSI       []string `json:"ansi"`
}

type ThemeDefinition struct {
	ID                int64           `json:"id"`
	Name              string          `json:"name"`
	Mode              ThemeMode       `json:"mode"`
	SourceType        ThemeSourceType `json:"source_type"`
	SourceName        string          `json:"source_name"`
	SourceURL         string          `json:"source_url"`
	SourceAuthor      string          `json:"source_author"`
	SourceLicense     string          `json:"source_license"`
	SourceVersion     string          `json:"source_version"`
	SourceFingerprint string          `json:"source_fingerprint"`
	ColorPayload      string          `json:"color_payload"`
	RawPayload        string          `json:"raw_payload"`
	IsBuiltin         bool            `json:"is_builtin"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

type ThemeProfile struct {
	ID             int64            `json:"id"`
	Name           string           `json:"name"`
	ThemeID        int64            `json:"theme_id"`
	Definition     *ThemeDefinition `json:"definition,omitempty"`
	FontFamily     string           `json:"font_family"`
	FontSize       int              `json:"font_size"`
	CursorStyle    CursorStyle      `json:"cursor_style"`
	ColorOverrides string           `json:"color_overrides"`
	CreatedAt      time.Time        `json:"created_at"`
	UpdatedAt      time.Time        `json:"updated_at"`
}

type ThemeAssignments struct {
	DarkProfileID       int64 `json:"dark_profile_id"`
	LightProfileID      int64 `json:"light_profile_id"`
	FollowInterfaceMode bool  `json:"follow_interface_mode"`
	FixedProfileID      int64 `json:"fixed_profile_id"`
}

type ThemeImportStatus string

const (
	ThemeImportImported  ThemeImportStatus = "imported"
	ThemeImportDuplicate ThemeImportStatus = "duplicate"
	ThemeImportFailed    ThemeImportStatus = "failed"
)

type ThemeImportResult struct {
	File         string            `json:"file"`
	Name         string            `json:"name"`
	Status       ThemeImportStatus `json:"status"`
	DefinitionID int64             `json:"definition_id"`
	ProfileID    int64             `json:"profile_id"`
	Error        string            `json:"error"`
}

type ThemeImportSummary struct {
	Results []ThemeImportResult `json:"results"`
}

type BuiltinThemeResetResult struct {
	DarkReset  bool `json:"dark_reset"`
	LightReset bool `json:"light_reset"`
	FixedReset bool `json:"fixed_reset"`
}
