package model

import "time"

type AssetColorToken string

const (
	AssetColorSlate  AssetColorToken = "slate"
	AssetColorRed    AssetColorToken = "red"
	AssetColorOrange AssetColorToken = "orange"
	AssetColorAmber  AssetColorToken = "amber"
	AssetColorYellow AssetColorToken = "yellow"
	AssetColorLime   AssetColorToken = "lime"
	AssetColorGreen  AssetColorToken = "green"
	AssetColorTeal   AssetColorToken = "teal"
	AssetColorCyan   AssetColorToken = "cyan"
	AssetColorBlue   AssetColorToken = "blue"
	AssetColorViolet AssetColorToken = "violet"
	AssetColorPink   AssetColorToken = "pink"
)

type AssetEnvironment struct {
	ID           int64           `json:"id"`
	Name         string          `json:"name"`
	ColorToken   AssetColorToken `json:"color_token"`
	SortOrder    int             `json:"sort_order"`
	SessionCount int             `json:"session_count"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

type AssetProject struct {
	ID           int64     `json:"id"`
	Name         string    `json:"name"`
	Code         string    `json:"code"`
	Description  string    `json:"description"`
	SortOrder    int       `json:"sort_order"`
	SessionCount int       `json:"session_count"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type AssetTag struct {
	ID           int64           `json:"id"`
	Name         string          `json:"name"`
	ColorToken   AssetColorToken `json:"color_token"`
	SessionCount int             `json:"session_count"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

type AssetEnvironmentInput struct {
	ID         int64           `json:"id"`
	Name       string          `json:"name"`
	ColorToken AssetColorToken `json:"color_token"`
	SortOrder  int             `json:"sort_order"`
}

type AssetProjectInput struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Code        string `json:"code"`
	Description string `json:"description"`
	SortOrder   int    `json:"sort_order"`
}

type AssetTagInput struct {
	ID         int64           `json:"id"`
	Name       string          `json:"name"`
	ColorToken AssetColorToken `json:"color_token"`
}

type AssetDeleteInput struct {
	ID            int64  `json:"id"`
	Mode          string `json:"mode"`
	ReplacementID *int64 `json:"replacement_id"`
}

type AssetDeleteImpact struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	SessionCount int    `json:"session_count"`
}

type BulkAssetAssignmentInput struct {
	SessionIDs []int64 `json:"session_ids"`
	TargetID   *int64  `json:"target_id"`
}

type BulkTagUpdateInput struct {
	SessionIDs []int64 `json:"session_ids"`
	TagIDs     []int64 `json:"tag_ids"`
	Operation  string  `json:"operation"`
}
