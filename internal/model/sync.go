package model

import "time"

type SyncProvider string

const (
	SyncProviderGist   SyncProvider = "gist"
	SyncProviderWebDAV SyncProvider = "webdav"
	SyncProviderS3     SyncProvider = "s3"
)

type SyncStrategy string

const (
	SyncStrategySmart      SyncStrategy = "smart"
	SyncStrategyCloudFirst SyncStrategy = "cloud_first"
	SyncStrategyLocalFirst SyncStrategy = "local_first"
)

type SyncState string

const (
	SyncStateDisabled SyncState = "disabled"
	SyncStateIdle     SyncState = "idle"
	SyncStateSyncing  SyncState = "syncing"
	SyncStateSynced   SyncState = "synced"
	SyncStatePending  SyncState = "pending"
	SyncStateConflict SyncState = "conflict"
	SyncStateError    SyncState = "error"
)

type SyncEventStatus string

const (
	SyncEventSuccess  SyncEventStatus = "success"
	SyncEventFailed   SyncEventStatus = "failed"
	SyncEventConflict SyncEventStatus = "conflict"
	SyncEventNoop     SyncEventStatus = "noop"
)

type SyncConflictChoice string

const (
	SyncConflictUseCloud SyncConflictChoice = "use_cloud"
	SyncConflictUseLocal SyncConflictChoice = "use_local"
	SyncConflictCancel   SyncConflictChoice = "cancel"
)

type GistSyncConfig struct {
	GistID     string `json:"gist_id"`
	TokenSaved bool   `json:"token_saved"`
}

type WebDAVSyncConfig struct {
	URL           string `json:"url"`
	Username      string `json:"username"`
	PasswordSaved bool   `json:"password_saved"`
}

type S3SyncConfig struct {
	Endpoint       string `json:"endpoint"`
	Region         string `json:"region"`
	Bucket         string `json:"bucket"`
	Prefix         string `json:"prefix"`
	AccessKeyID    string `json:"access_key_id"`
	SecretKeySaved bool   `json:"secret_key_saved"`
	PathStyle      bool   `json:"path_style"`
}

type SyncConfig struct {
	Enabled         bool             `json:"enabled"`
	MasterKeySaved  bool             `json:"master_key_saved"`
	Provider        SyncProvider     `json:"provider"`
	Strategy        SyncStrategy     `json:"strategy"`
	IntervalMinutes int              `json:"interval_minutes"`
	RetentionCount  int              `json:"retention_count"`
	RetentionDays   int              `json:"retention_days"`
	Gist            GistSyncConfig   `json:"gist"`
	WebDAV          WebDAVSyncConfig `json:"webdav"`
	S3              S3SyncConfig     `json:"s3"`
}

type GistSyncConfigInput struct {
	GistID     string `json:"gist_id"`
	Token      string `json:"token"`
	ClearToken bool   `json:"clear_token"`
}

type WebDAVSyncConfigInput struct {
	URL           string `json:"url"`
	Username      string `json:"username"`
	Password      string `json:"password"`
	ClearPassword bool   `json:"clear_password"`
}

type S3SyncConfigInput struct {
	Endpoint       string `json:"endpoint"`
	Region         string `json:"region"`
	Bucket         string `json:"bucket"`
	Prefix         string `json:"prefix"`
	AccessKeyID    string `json:"access_key_id"`
	SecretKey      string `json:"secret_key"`
	ClearSecretKey bool   `json:"clear_secret_key"`
	PathStyle      bool   `json:"path_style"`
}

type SyncConfigInput struct {
	Enabled         bool                  `json:"enabled"`
	Provider        SyncProvider          `json:"provider"`
	Strategy        SyncStrategy          `json:"strategy"`
	IntervalMinutes int                   `json:"interval_minutes"`
	RetentionCount  int                   `json:"retention_count"`
	RetentionDays   int                   `json:"retention_days"`
	MasterKey       string                `json:"master_key"`
	Gist            GistSyncConfigInput   `json:"gist"`
	WebDAV          WebDAVSyncConfigInput `json:"webdav"`
	S3              S3SyncConfigInput     `json:"s3"`
}

type SyncVersion struct {
	ID                  int64        `json:"id"`
	VersionID           string       `json:"version_id"`
	VersionNumber       int64        `json:"version_number"`
	ParentVersionID     string       `json:"parent_version_id"`
	SnapshotFingerprint string       `json:"snapshot_fingerprint"`
	Provider            SyncProvider `json:"provider"`
	Source              string       `json:"source"`
	FileName            string       `json:"file_name"`
	SizeBytes           int64        `json:"size_bytes"`
	Protected           bool         `json:"protected"`
	CreatedAt           time.Time    `json:"created_at"`
}

type SyncRemoteVersion struct {
	VersionID           string    `json:"version_id"`
	VersionNumber       int64     `json:"version_number"`
	SnapshotFingerprint string    `json:"snapshot_fingerprint"`
	DeviceID            string    `json:"device_id"`
	CreatedAt           time.Time `json:"created_at"`
}

type SyncEvent struct {
	ID            int64           `json:"id"`
	Action        string          `json:"action"`
	Provider      SyncProvider    `json:"provider"`
	Strategy      SyncStrategy    `json:"strategy"`
	Status        SyncEventStatus `json:"status"`
	LocalVersion  int64           `json:"local_version"`
	RemoteVersion int64           `json:"remote_version"`
	Message       string          `json:"message"`
	CreatedAt     time.Time       `json:"created_at"`
}

type SyncConflict struct {
	Local  SyncRemoteVersion `json:"local"`
	Remote SyncRemoteVersion `json:"remote"`
}

type SyncDashboard struct {
	Config        SyncConfig         `json:"config"`
	State         SyncState          `json:"state"`
	Message       string             `json:"message"`
	LastSyncedAt  string             `json:"last_synced_at"`
	LocalVersion  *SyncVersion       `json:"local_version,omitempty"`
	RemoteVersion *SyncRemoteVersion `json:"remote_version,omitempty"`
	Conflict      *SyncConflict      `json:"conflict,omitempty"`
	Versions      []SyncVersion      `json:"versions"`
	Events        []SyncEvent        `json:"events"`
}

type SyncResult struct {
	State    SyncState     `json:"state"`
	Message  string        `json:"message"`
	Conflict *SyncConflict `json:"conflict,omitempty"`
}
