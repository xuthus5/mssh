package model

type SettingInput struct {
	Key       string `json:"key"`
	Namespace string `json:"namespace"`
	Value     string `json:"value"`
	ValueType string `json:"value_type"`
	Version   int    `json:"version"`
}

func (input SettingInput) Setting() Setting {
	return Setting{Key: input.Key, Namespace: input.Namespace, Value: input.Value, ValueType: input.ValueType, Version: input.Version}
}

func SettingInputFrom(setting Setting) SettingInput {
	return SettingInput{Key: setting.Key, Namespace: setting.Namespace, Value: setting.Value, ValueType: setting.ValueType, Version: setting.Version}
}

type SessionInput struct {
	ID            int64      `json:"id"`
	FolderID      *int64     `json:"folder_id"`
	Name          string     `json:"name"`
	Host          string     `json:"host"`
	Port          int        `json:"port"`
	Username      string     `json:"username"`
	Notes         string     `json:"notes"`
	EnvironmentID *int64     `json:"environment_id,omitempty"`
	ProjectID     *int64     `json:"project_id,omitempty"`
	TagIDs        []int64    `json:"tag_ids"`
	AuthMethod    AuthMethod `json:"auth_method"`
	Password      string     `json:"password,omitempty"`
	KeyID         *int64     `json:"key_id,omitempty"`
	KeepAlive     int        `json:"keep_alive"`
	TermType      string     `json:"term_type"`
	SortOrder     int        `json:"sort_order"`
}

func (input SessionInput) Session() Session {
	return Session{ID: input.ID, FolderID: input.FolderID, Name: input.Name, Host: input.Host, Port: input.Port, Username: input.Username, Notes: input.Notes, EnvironmentID: input.EnvironmentID, ProjectID: input.ProjectID, AuthMethod: input.AuthMethod, Password: input.Password, KeyID: input.KeyID, KeepAlive: input.KeepAlive, TermType: input.TermType, SortOrder: input.SortOrder}
}

func SessionInputFrom(session Session) SessionInput {
	tagIDs := make([]int64, len(session.Tags))
	for index, tag := range session.Tags {
		tagIDs[index] = tag.ID
	}
	return SessionInput{ID: session.ID, FolderID: session.FolderID, Name: session.Name, Host: session.Host, Port: session.Port, Username: session.Username, Notes: session.Notes, EnvironmentID: session.EnvironmentID, ProjectID: session.ProjectID, TagIDs: tagIDs, AuthMethod: session.AuthMethod, Password: session.Password, KeyID: session.KeyID, KeepAlive: session.KeepAlive, TermType: session.TermType, SortOrder: session.SortOrder}
}

type TunnelInput struct {
	ID         int64      `json:"id"`
	SessionID  int64      `json:"session_id"`
	Name       string     `json:"name"`
	Type       TunnelType `json:"type"`
	LocalHost  string     `json:"local_host,omitempty"`
	LocalPort  int        `json:"local_port"`
	RemoteHost string     `json:"remote_host,omitempty"`
	RemotePort int        `json:"remote_port"`
}

func (input TunnelInput) Tunnel() Tunnel {
	return Tunnel{ID: input.ID, SessionID: input.SessionID, Name: input.Name, Type: input.Type, LocalHost: input.LocalHost, LocalPort: input.LocalPort, RemoteHost: input.RemoteHost, RemotePort: input.RemotePort}
}

func TunnelInputFrom(tunnel Tunnel) TunnelInput {
	return TunnelInput{ID: tunnel.ID, SessionID: tunnel.SessionID, Name: tunnel.Name, Type: tunnel.Type, LocalHost: tunnel.LocalHost, LocalPort: tunnel.LocalPort, RemoteHost: tunnel.RemoteHost, RemotePort: tunnel.RemotePort}
}

type MacroInput struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Command   string `json:"command"`
	Shortcut  string `json:"shortcut"`
	DelayMs   int    `json:"delay_ms"`
	SortOrder int    `json:"sort_order"`
}

func (input MacroInput) Macro() Macro {
	return Macro{ID: input.ID, Name: input.Name, Command: input.Command, Shortcut: input.Shortcut, DelayMs: input.DelayMs, SortOrder: input.SortOrder}
}

func MacroInputFrom(macro Macro) MacroInput {
	return MacroInput{ID: macro.ID, Name: macro.Name, Command: macro.Command, Shortcut: macro.Shortcut, DelayMs: macro.DelayMs, SortOrder: macro.SortOrder}
}

type ThemeDefinitionInput struct {
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
}

func (input ThemeDefinitionInput) ThemeDefinition() ThemeDefinition {
	return ThemeDefinition{ID: input.ID, Name: input.Name, Mode: input.Mode, SourceType: input.SourceType, SourceName: input.SourceName, SourceURL: input.SourceURL, SourceAuthor: input.SourceAuthor, SourceLicense: input.SourceLicense, SourceVersion: input.SourceVersion, SourceFingerprint: input.SourceFingerprint, ColorPayload: input.ColorPayload, RawPayload: input.RawPayload, IsBuiltin: input.IsBuiltin}
}

func ThemeDefinitionInputFrom(theme ThemeDefinition) ThemeDefinitionInput {
	return ThemeDefinitionInput{ID: theme.ID, Name: theme.Name, Mode: theme.Mode, SourceType: theme.SourceType, SourceName: theme.SourceName, SourceURL: theme.SourceURL, SourceAuthor: theme.SourceAuthor, SourceLicense: theme.SourceLicense, SourceVersion: theme.SourceVersion, SourceFingerprint: theme.SourceFingerprint, ColorPayload: theme.ColorPayload, RawPayload: theme.RawPayload, IsBuiltin: theme.IsBuiltin}
}

type ThemeProfileInput struct {
	ID                int64       `json:"id"`
	Name              string      `json:"name"`
	ThemeID           int64       `json:"theme_id"`
	FollowGlobalStyle bool        `json:"follow_global_style"`
	FontFamily        string      `json:"font_family"`
	FontSize          int         `json:"font_size"`
	CursorStyle       CursorStyle `json:"cursor_style"`
	ColorOverrides    string      `json:"color_overrides"`
}

func (input ThemeProfileInput) ThemeProfile() ThemeProfile {
	return ThemeProfile{ID: input.ID, Name: input.Name, ThemeID: input.ThemeID, FollowGlobalStyle: input.FollowGlobalStyle, FontFamily: input.FontFamily, FontSize: input.FontSize, CursorStyle: input.CursorStyle, ColorOverrides: input.ColorOverrides}
}

func ThemeProfileInputFrom(profile ThemeProfile) ThemeProfileInput {
	return ThemeProfileInput{ID: profile.ID, Name: profile.Name, ThemeID: profile.ThemeID, FollowGlobalStyle: profile.FollowGlobalStyle, FontFamily: profile.FontFamily, FontSize: profile.FontSize, CursorStyle: profile.CursorStyle, ColorOverrides: profile.ColorOverrides}
}

type TerminalGlobalStyleInput struct {
	FontFamily          string      `json:"font_family"`
	FontSize            int         `json:"font_size"`
	CursorStyle         CursorStyle `json:"cursor_style"`
	SelectionBackground string      `json:"selection_background"`
}

func (input TerminalGlobalStyleInput) TerminalGlobalStyle() TerminalGlobalStyle {
	return TerminalGlobalStyle(input)
}

func TerminalGlobalStyleInputFrom(style TerminalGlobalStyle) TerminalGlobalStyleInput {
	return TerminalGlobalStyleInput(style)
}

type ThemeAssignmentsInput struct {
	DarkProfileID       int64 `json:"dark_profile_id"`
	LightProfileID      int64 `json:"light_profile_id"`
	FollowInterfaceMode bool  `json:"follow_interface_mode"`
	FixedProfileID      int64 `json:"fixed_profile_id"`
}

type ThemeConfigurationInput struct {
	GlobalStyle TerminalGlobalStyleInput `json:"global_style"`
	Profiles    []ThemeProfileInput      `json:"profiles"`
	Assignments ThemeAssignmentsInput    `json:"assignments"`
}

func (input ThemeAssignmentsInput) ThemeAssignments() ThemeAssignments {
	return ThemeAssignments(input)
}
