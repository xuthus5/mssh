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
	ID         int64      `json:"id"`
	FolderID   *int64     `json:"folder_id"`
	Name       string     `json:"name"`
	Host       string     `json:"host"`
	Port       int        `json:"port"`
	Username   string     `json:"username"`
	AuthMethod AuthMethod `json:"auth_method"`
	Password   string     `json:"password,omitempty"`
	KeyID      *int64     `json:"key_id,omitempty"`
	KeepAlive  int        `json:"keep_alive"`
	TermType   string     `json:"term_type"`
	SortOrder  int        `json:"sort_order"`
}

func (input SessionInput) Session() Session {
	return Session{ID: input.ID, FolderID: input.FolderID, Name: input.Name, Host: input.Host, Port: input.Port, Username: input.Username, AuthMethod: input.AuthMethod, Password: input.Password, KeyID: input.KeyID, KeepAlive: input.KeepAlive, TermType: input.TermType, SortOrder: input.SortOrder}
}

func SessionInputFrom(session Session) SessionInput {
	return SessionInput{ID: session.ID, FolderID: session.FolderID, Name: session.Name, Host: session.Host, Port: session.Port, Username: session.Username, AuthMethod: session.AuthMethod, Password: session.Password, KeyID: session.KeyID, KeepAlive: session.KeepAlive, TermType: session.TermType, SortOrder: session.SortOrder}
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

type ThemeInput struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	IsBuiltin bool   `json:"is_builtin"`
	Config    string `json:"config"`
}

func (input ThemeInput) Theme() Theme {
	return Theme{ID: input.ID, Name: input.Name, IsBuiltin: input.IsBuiltin, Config: input.Config}
}

func ThemeInputFrom(theme Theme) ThemeInput {
	return ThemeInput{ID: theme.ID, Name: theme.Name, IsBuiltin: theme.IsBuiltin, Config: theme.Config}
}
