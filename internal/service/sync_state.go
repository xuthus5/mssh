package service

import (
	"database/sql"
	"errors"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type syncBaseline struct {
	VersionID           string    `json:"version_id"`
	VersionNumber       int64     `json:"version_number"`
	SnapshotFingerprint string    `json:"snapshot_fingerprint"`
	ETag                string    `json:"etag"`
	ProviderID          string    `json:"provider_id"`
	LocalVersionID      int64     `json:"local_version_id"`
	SyncedAt            time.Time `json:"synced_at"`
}

type syncConflictState struct {
	Summary    model.SyncConflict
	Local      syncCurrentSnapshot
	Remote     decodedSyncArtifact
	RemoteETag string
}

type syncRuntimeState struct {
	State    model.SyncState
	Message  string
	Remote   *model.SyncRemoteVersion
	Conflict *syncConflictState
}

type syncCurrentSnapshot struct {
	Data        ExportData
	Fingerprint string
}

func syncBaselineSetting(provider model.SyncProvider) string {
	return "sync.baseline." + string(provider)
}

func (s *SyncService) loadBaseline(provider model.SyncProvider) (syncBaseline, error) {
	var baseline syncBaseline
	err := readSyncSetting(s.db, syncBaselineSetting(provider), &baseline)
	if errors.Is(err, sql.ErrNoRows) {
		return syncBaseline{}, nil
	}
	return baseline, err
}

func (s *SyncService) saveBaseline(provider model.SyncProvider, baseline syncBaseline) error {
	return writeSyncSetting(s.db, syncBaselineSetting(provider), baseline)
}

func (s *SyncService) setRuntimeState(state syncRuntimeState) {
	s.stateMu.Lock()
	s.state = state
	s.stateMu.Unlock()
}

func (s *SyncService) markPending(message string) {
	s.stateMu.Lock()
	s.state.State = model.SyncStatePending
	s.state.Message = message
	s.state.Conflict = nil
	s.stateMu.Unlock()
}

func (s *SyncService) Dashboard() (model.SyncDashboard, error) {
	config, err := s.LoadConfig()
	if err != nil {
		return model.SyncDashboard{}, err
	}
	versions, err := store.ListSyncVersions(s.db, 100)
	if err != nil {
		return model.SyncDashboard{}, err
	}
	events, err := store.ListSyncEvents(s.db, 200)
	if err != nil {
		return model.SyncDashboard{}, err
	}
	baseline, err := s.loadBaseline(config.Provider)
	if err != nil {
		return model.SyncDashboard{}, err
	}
	dashboard := model.SyncDashboard{Config: config, Versions: versions, Events: events, LastSyncedAt: formatOptionalTime(baseline.SyncedAt)}
	s.stateMu.RLock()
	runtime := s.state
	s.stateMu.RUnlock()
	dashboard.State, dashboard.Message = runtime.State, runtime.Message
	dashboard.RemoteVersion = runtime.Remote
	if runtime.Conflict != nil {
		dashboard.Conflict = &runtime.Conflict.Summary
	}
	if dashboard.RemoteVersion == nil && baseline.SnapshotFingerprint != "" {
		dashboard.RemoteVersion = &model.SyncRemoteVersion{VersionID: baseline.VersionID, VersionNumber: baseline.VersionNumber, SnapshotFingerprint: baseline.SnapshotFingerprint, CreatedAt: baseline.SyncedAt}
	}
	if err := s.enrichLocalDashboard(&dashboard, baseline); err != nil {
		return model.SyncDashboard{}, err
	}
	if !config.Enabled {
		dashboard.State = model.SyncStateDisabled
	} else if dashboard.State == "" {
		dashboard.State = model.SyncStateIdle
	}
	return dashboard, nil
}

func (s *SyncService) enrichLocalDashboard(dashboard *model.SyncDashboard, baseline syncBaseline) error {
	data, err := s.snapshot()
	if err != nil {
		return err
	}
	fingerprint, err := snapshotFingerprint(data)
	if err != nil {
		return err
	}
	dashboard.LocalVersion, err = store.FindSyncVersionByFingerprint(s.db, fingerprint)
	if err != nil {
		return err
	}
	if dashboard.State == model.SyncStateIdle || dashboard.State == model.SyncStateSynced || dashboard.State == "" {
		switch baseline.SnapshotFingerprint {
		case "":
			dashboard.State = model.SyncStateIdle
		case fingerprint:
			dashboard.State = model.SyncStateSynced
		default:
			dashboard.State = model.SyncStatePending
		}
	}
	return nil
}

func formatOptionalTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}
