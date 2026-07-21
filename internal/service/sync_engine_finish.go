package service

import (
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SyncService) downloadSnapshot(config model.SyncConfig, artifact decodedSyncArtifact, etag string) (model.SyncResult, error) {
	if err := validateSnapshot(s.db, artifact.Data); err != nil {
		return model.SyncResult{}, err
	}
	if s.lifecycle != nil {
		if err := s.lifecycle.PrepareDestructiveSync(); err != nil {
			return model.SyncResult{}, err
		}
	}
	if _, err := s.saveCurrentVersion(config.Provider, "pre-download", false); err != nil {
		return model.SyncResult{}, err
	}
	if err := s.restore(artifact.Data); err != nil {
		return model.SyncResult{}, err
	}
	version, err := s.saveVersion(artifact.Content, artifact.Metadata, config.Provider, "download", false)
	if err != nil {
		return model.SyncResult{}, err
	}
	if err := s.finishSuccessfulSync(config, artifact.Metadata, etag, version.ID); err != nil {
		return model.SyncResult{}, err
	}
	s.notifyDataChanged()
	s.recordSyncEvent("download", config, model.SyncEventSuccess, version.ID, artifact.Metadata.VersionNumber, "已采用云端版本")
	return model.SyncResult{State: model.SyncStateSynced, Message: "已采用云端版本"}, nil
}

func (s *SyncService) completeNoop(config model.SyncConfig, artifact decodedSyncArtifact, etag string) (model.SyncResult, error) {
	version, err := s.saveVersion(artifact.Content, artifact.Metadata, config.Provider, "sync", false)
	if err != nil {
		return model.SyncResult{}, err
	}
	if err := s.finishSuccessfulSync(config, artifact.Metadata, etag, version.ID); err != nil {
		return model.SyncResult{}, err
	}
	s.recordSyncEvent("sync", config, model.SyncEventNoop, version.ID, artifact.Metadata.VersionNumber, "本地与云端无变化")
	return model.SyncResult{State: model.SyncStateSynced, Message: "本地与云端无变化"}, nil
}

func (s *SyncService) finishSuccessfulSync(config model.SyncConfig, metadata syncArtifactMetadata, etag string, localVersionID int64) error {
	previous, err := s.loadBaseline(config.Provider)
	if err != nil {
		return err
	}
	if previous.LocalVersionID > 0 && previous.LocalVersionID != localVersionID {
		if err := store.SetSyncVersionProtected(s.db, previous.LocalVersionID, false); err != nil {
			return err
		}
	}
	if err := store.SetSyncVersionProtected(s.db, localVersionID, true); err != nil {
		return err
	}
	baseline := syncBaseline{VersionID: metadata.VersionID, VersionNumber: metadata.VersionNumber, SnapshotFingerprint: metadata.SnapshotFingerprint, ETag: etag, LocalVersionID: localVersionID, SyncedAt: time.Now().UTC()}
	if err := s.saveBaseline(config.Provider, baseline); err != nil {
		return err
	}
	if err := s.applyRetention(config); err != nil {
		return err
	}
	s.setRuntimeState(syncRuntimeState{State: model.SyncStateSynced, Message: "同步完成", Remote: remoteVersion(metadata)})
	return nil
}
