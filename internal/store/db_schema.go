package store

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

const syncVersionsTableSQL = `CREATE TABLE IF NOT EXISTS sync_versions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	version_id TEXT NOT NULL UNIQUE,
	version_number INTEGER NOT NULL DEFAULT 0,
	parent_version_id TEXT NOT NULL DEFAULT '',
	snapshot_fingerprint TEXT NOT NULL,
	provider TEXT NOT NULL CHECK(provider IN ('gist','webdav','s3')),
	source TEXT NOT NULL,
	file_name TEXT NOT NULL UNIQUE,
	size_bytes INTEGER NOT NULL DEFAULT 0,
	protected INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
)`

const syncEventsTableSQL = `CREATE TABLE IF NOT EXISTS sync_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	action TEXT NOT NULL,
	provider TEXT NOT NULL CHECK(provider IN ('gist','webdav','s3')),
	strategy TEXT NOT NULL CHECK(strategy IN ('smart','cloud_first','local_first')),
	status TEXT NOT NULL CHECK(status IN ('success','failed','conflict','noop')),
	local_version INTEGER NOT NULL DEFAULT 0,
	remote_version INTEGER NOT NULL DEFAULT 0,
	message TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL
)`

const aiProviderProfilesTableSQL = `CREATE TABLE IF NOT EXISTS ai_provider_profiles (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	provider TEXT NOT NULL CHECK(provider IN ('openai_compatible','anthropic','gemini','ollama')),
	base_url TEXT NOT NULL,
	default_model TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	context_window_size INTEGER NOT NULL DEFAULT 0,
	skip_tls_verify INTEGER NOT NULL DEFAULT 0,
	max_tokens INTEGER NOT NULL DEFAULT 0,
	temperature REAL,
	top_p REAL,
	frequency_penalty REAL,
	presence_penalty REAL,
	custom_headers TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const aiSettingsTableSQL = `CREATE TABLE IF NOT EXISTS ai_settings (
	id INTEGER PRIMARY KEY CHECK(id = 1),
	default_provider_id INTEGER REFERENCES ai_provider_profiles(id) ON DELETE SET NULL,
	fallback_provider_id INTEGER REFERENCES ai_provider_profiles(id) ON DELETE SET NULL,
	interaction_json TEXT NOT NULL,
	search_json TEXT NOT NULL,
	security_json TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const aiConversationsTableSQL = `CREATE TABLE IF NOT EXISTS ai_conversations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	title TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const aiMessagesTableSQL = `CREATE TABLE IF NOT EXISTS ai_messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
	role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
	content TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const aiCommandExecutionsTableSQL = `CREATE TABLE IF NOT EXISTS ai_command_executions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	conversation_id INTEGER REFERENCES ai_conversations(id) ON DELETE SET NULL,
	session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	terminal_id TEXT NOT NULL,
	command TEXT NOT NULL,
	risk TEXT NOT NULL CHECK(risk IN ('read_only','modify','high','blocked')),
	approved INTEGER NOT NULL DEFAULT 0,
	outcome TEXT NOT NULL CHECK(outcome IN ('success','failed','blocked')),
	error TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const aiAgentTasksTableSQL = `CREATE TABLE IF NOT EXISTS ai_agent_tasks (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	engine TEXT NOT NULL CHECK(engine IN ('native','local_cli')),
	cli TEXT NOT NULL DEFAULT '' CHECK(cli IN ('','codex','claude','opencode')),
	prompt TEXT NOT NULL,
	status TEXT NOT NULL CHECK(status IN ('pending','running','waiting_approval','completed','failed','cancelled','interrupted')),
	step_count INTEGER NOT NULL DEFAULT 0, result TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	started_at TEXT, finished_at TEXT
)`

const aiAgentStepsTableSQL = `CREATE TABLE IF NOT EXISTS ai_agent_steps (
	id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES ai_agent_tasks(id) ON DELETE CASCADE,
	sequence INTEGER NOT NULL, kind TEXT NOT NULL, model_output TEXT NOT NULL DEFAULT '', tool_name TEXT NOT NULL DEFAULT '',
	tool_input TEXT NOT NULL DEFAULT '', tool_output TEXT NOT NULL DEFAULT '',
	risk TEXT NOT NULL DEFAULT 'read_only' CHECK(risk IN ('read_only','modify','high','blocked')),
	approval_status TEXT NOT NULL DEFAULT 'not_required' CHECK(approval_status IN ('not_required','pending','approved','rejected')),
	error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	UNIQUE(task_id, sequence)
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
	{name: "serial_ports", sql: serialPortsTableSQL},
	{name: "session_tags_tag_idx", sql: "CREATE INDEX IF NOT EXISTS session_tags_tag_idx ON session_tags(tag_id, session_id)"},
	{name: "tunnels", sql: tunnelsTableSQL}, {name: "macros", sql: macrosTableSQL}, {name: "command_history", sql: commandHistoryTableSQL},
	{name: "session_logs", sql: logsTableSQL}, {name: "transfer_jobs", sql: transferJobsTableSQL}, {name: "audit_events", sql: auditEventsTableSQL},
	{name: "audit_events_action_idx", sql: "CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events(action, created_at DESC)"},
	{name: "audit_events_session_idx", sql: "CREATE INDEX IF NOT EXISTS audit_events_session_idx ON audit_events(session_id, created_at DESC)"},
	{name: "sync_versions", sql: syncVersionsTableSQL},
	{name: "sync_versions_created_idx", sql: "CREATE INDEX IF NOT EXISTS sync_versions_created_idx ON sync_versions(created_at DESC)"},
	{name: "sync_events", sql: syncEventsTableSQL},
	{name: "sync_events_created_idx", sql: "CREATE INDEX IF NOT EXISTS sync_events_created_idx ON sync_events(created_at DESC)"},
	{name: "ai_provider_profiles", sql: aiProviderProfilesTableSQL}, {name: "ai_settings", sql: aiSettingsTableSQL},
	{name: "ai_conversations", sql: aiConversationsTableSQL}, {name: "ai_messages", sql: aiMessagesTableSQL},
	{name: "ai_messages_conversation_idx", sql: "CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx ON ai_messages(conversation_id, id)"},
	{name: "ai_command_executions", sql: aiCommandExecutionsTableSQL},
	{name: "ai_agent_tasks", sql: aiAgentTasksTableSQL},
	{name: "ai_agent_steps", sql: aiAgentStepsTableSQL},
	{name: "ai_agent_tasks_active_session_idx", sql: "CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_tasks_active_session_idx ON ai_agent_tasks(session_id) WHERE status IN ('pending','running','waiting_approval')"},
	{name: "ai_agent_tasks_session_idx", sql: "CREATE INDEX IF NOT EXISTS ai_agent_tasks_session_idx ON ai_agent_tasks(session_id, id DESC)"},
	{name: "ai_agent_steps_task_idx", sql: "CREATE INDEX IF NOT EXISTS ai_agent_steps_task_idx ON ai_agent_steps(task_id, sequence)"},
	{name: "settings", sql: settingsTableSQL}, {name: "themes", sql: themeDefinitionsSchema}, {name: "terminal_theme_profiles", sql: themeProfilesSchema},
}
