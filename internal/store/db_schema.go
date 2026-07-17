package store

const databaseFormatVersion = 5

const foldersTableSQL = `CREATE TABLE IF NOT EXISTS session_folders (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	parent_id INTEGER REFERENCES session_folders(id),
	is_default INTEGER NOT NULL DEFAULT 0,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const keysTableSQL = `CREATE TABLE IF NOT EXISTS ssh_keys (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	type TEXT NOT NULL CHECK(type IN ('rsa','ed25519','ecdsa')),
	private_key TEXT NOT NULL,
	public_key TEXT,
	has_passphrase INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const assetEnvironmentsTableSQL = `CREATE TABLE IF NOT EXISTS asset_environments (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	name_key TEXT NOT NULL UNIQUE,
	color_token TEXT NOT NULL CHECK(color_token IN ('slate','red','orange','amber','yellow','lime','green','teal','cyan','blue','violet','pink')),
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const assetProjectsTableSQL = `CREATE TABLE IF NOT EXISTS asset_projects (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	name_key TEXT NOT NULL UNIQUE,
	code TEXT NOT NULL DEFAULT '',
	code_key TEXT,
	description TEXT NOT NULL DEFAULT '',
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const assetTagsTableSQL = `CREATE TABLE IF NOT EXISTS asset_tags (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	name_key TEXT NOT NULL UNIQUE,
	color_token TEXT NOT NULL CHECK(color_token IN ('slate','red','orange','amber','yellow','lime','green','teal','cyan','blue','violet','pink')),
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const sessionsTableSQL = `CREATE TABLE IF NOT EXISTS sessions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	folder_id INTEGER REFERENCES session_folders(id),
	name TEXT NOT NULL,
	host TEXT NOT NULL,
	port INTEGER NOT NULL DEFAULT 22,
	username TEXT NOT NULL,
	notes TEXT NOT NULL DEFAULT '',
	environment_id INTEGER REFERENCES asset_environments(id) ON DELETE RESTRICT,
	project_id INTEGER REFERENCES asset_projects(id) ON DELETE RESTRICT,
	auth_method TEXT NOT NULL CHECK(auth_method IN ('password','key','agent','keyboard-interactive')),
	password TEXT,
	key_id INTEGER REFERENCES ssh_keys(id),
	keep_alive INTEGER NOT NULL DEFAULT 30,
	term_type TEXT NOT NULL DEFAULT 'xterm-256color',
	sort_order INTEGER NOT NULL DEFAULT 0,
	last_connected_at TEXT,
	connection_count INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const sessionTagsTableSQL = `CREATE TABLE IF NOT EXISTS session_tags (
	session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	tag_id INTEGER NOT NULL REFERENCES asset_tags(id) ON DELETE CASCADE,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY(session_id, tag_id)
)`

const tunnelsTableSQL = `CREATE TABLE IF NOT EXISTS tunnels (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id INTEGER NOT NULL REFERENCES sessions(id),
	name TEXT NOT NULL,
	type TEXT NOT NULL CHECK(type IN ('local','remote','dynamic')),
	local_host TEXT,
	local_port INTEGER,
	remote_host TEXT,
	remote_port INTEGER,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const macrosTableSQL = `CREATE TABLE IF NOT EXISTS macros (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	command TEXT NOT NULL,
	shortcut TEXT,
	delay_ms INTEGER NOT NULL DEFAULT 0,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const commandHistoryTableSQL = `CREATE TABLE IF NOT EXISTS command_history (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	command TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const logsTableSQL = `CREATE TABLE IF NOT EXISTS session_logs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id INTEGER REFERENCES sessions(id),
	started_at TEXT NOT NULL,
	ended_at TEXT,
	data_path TEXT NOT NULL
)`

const transferJobsTableSQL = `CREATE TABLE IF NOT EXISTS transfer_jobs (
	id TEXT PRIMARY KEY,
	session_id INTEGER NOT NULL,
	session_name TEXT NOT NULL,
	direction TEXT NOT NULL CHECK(direction IN ('upload','download')),
	source_path TEXT NOT NULL,
	target_path TEXT NOT NULL,
	total_bytes INTEGER NOT NULL DEFAULT 0,
	transferred_bytes INTEGER NOT NULL DEFAULT 0,
	speed INTEGER NOT NULL DEFAULT 0,
	eta INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),
	error TEXT NOT NULL DEFAULT '',
	started_at TEXT NOT NULL,
	completed_at TEXT
)`

const auditEventsTableSQL = `CREATE TABLE IF NOT EXISTS audit_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	action TEXT NOT NULL,
	target_type TEXT NOT NULL,
	target_id TEXT NOT NULL DEFAULT '',
	session_id INTEGER,
	summary TEXT NOT NULL,
	outcome TEXT NOT NULL CHECK(outcome IN ('success','failed')),
	created_at TEXT NOT NULL
)`

type schemaStatement struct {
	name string
	sql  string
}

var finalSchemaStatements = []schemaStatement{
	{name: "session_folders", sql: foldersTableSQL}, {name: "ssh_keys", sql: keysTableSQL},
	{name: "asset_environments", sql: assetEnvironmentsTableSQL}, {name: "asset_projects", sql: assetProjectsTableSQL},
	{name: "asset_projects_code_key_idx", sql: "CREATE UNIQUE INDEX IF NOT EXISTS asset_projects_code_key_idx ON asset_projects(code_key) WHERE code_key IS NOT NULL"},
	{name: "asset_tags", sql: assetTagsTableSQL}, {name: "sessions", sql: sessionsTableSQL}, {name: "session_tags", sql: sessionTagsTableSQL},
	{name: "session_tags_tag_idx", sql: "CREATE INDEX IF NOT EXISTS session_tags_tag_idx ON session_tags(tag_id, session_id)"},
	{name: "tunnels", sql: tunnelsTableSQL}, {name: "macros", sql: macrosTableSQL}, {name: "command_history", sql: commandHistoryTableSQL},
	{name: "session_logs", sql: logsTableSQL}, {name: "transfer_jobs", sql: transferJobsTableSQL}, {name: "audit_events", sql: auditEventsTableSQL},
	{name: "audit_events_action_idx", sql: "CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events(action, created_at DESC)"},
	{name: "audit_events_session_idx", sql: "CREATE INDEX IF NOT EXISTS audit_events_session_idx ON audit_events(session_id, created_at DESC)"},
	{name: "settings", sql: settingsTableSQL}, {name: "themes", sql: themeDefinitionsSchema}, {name: "terminal_theme_profiles", sql: themeProfilesSchema},
}

var applicationTablesInDropOrder = []string{
	"terminal_theme_profiles", "themes", "session_logs", "transfer_jobs", "audit_events", "tunnels", "session_tags", "sessions",
	"asset_tags", "asset_projects", "asset_environments", "ssh_keys", "session_folders", "settings", "macros", "command_history",
}
