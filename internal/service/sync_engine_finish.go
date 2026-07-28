package service

import (
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

type syncCompletion struct {
	Config         model.SyncConfig
	Metadata       syncArtifactMetadata
	ETag           string
	LocalVersionID int64
}

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
	version, err := s.saveVersion(artifact.Content, artifact.Metadata, config.Provider, "download", false)
	if err != nil {
		return model.SyncResult{}, err
	}
	completion := syncCompletion{Config: config, Metadata: artifact.Metadata, ETag: etag, LocalVersionID: version.ID}
	if err := s.finishDownloadedSync(completion, artifact.Data); err != nil {
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
	completion := syncCompletion{Config: config, Metadata: artifact.Metadata, ETag: etag, LocalVersionID: version.ID}
	if err := s.finishSuccessfulSync(completion); err != nil {
		return model.SyncResult{}, err
	}
	s.recordSyncEvent("sync", config, model.SyncEventNoop, version.ID, artifact.Metadata.VersionNumber, "本地与云端无变化")
	return model.SyncResult{State: model.SyncStateSynced, Message: "本地与云端无变化"}, nil
}

func (s *SyncService) finishSuccessfulSync(completion syncCompletion) error {
	previous, err := s.loadBaseline(completion.Config.Provider)
	if err != nil {
		return err
	}
	commit := successfulSyncCommit{Provider: completion.Config.Provider, Previous: previous, Baseline: completion.baseline()}
	if err := s.commitSuccessfulSync(commit); err != nil {
		return err
	}
	s.finalizeSuccessfulSync(completion)
	return nil
}

func (s *SyncService) finishDownloadedSync(completion syncCompletion, data ExportData) error {
	previous, err := s.loadBaseline(completion.Config.Provider)
	if err != nil {
		return err
	}
	commit := successfulSyncCommit{
		Provider: completion.Config.Provider, Previous: previous, Baseline: completion.baseline(), Restore: &data,
	}
	if err := s.commitSuccessfulSync(commit); err != nil {
		return err
	}
	if err := s.applyRestoredProxySettingsWithinCryptoOperation(); err != nil {
		return err
	}
	s.finalizeSuccessfulSync(completion)
	return nil
}

func (completion syncCompletion) baseline() syncBaseline {
	return syncBaseline{
		VersionID: completion.Metadata.VersionID, VersionNumber: completion.Metadata.VersionNumber,
		SnapshotFingerprint: completion.Metadata.SnapshotFingerprint, ETag: completion.ETag,
		LocalVersionID: completion.LocalVersionID, SyncedAt: time.Now().UTC(),
	}
}

func (s *SyncService) finalizeSuccessfulSync(completion syncCompletion) {
	s.setRuntimeState(syncRuntimeState{State: model.SyncStateSynced, Message: "同步完成", Remote: remoteVersion(completion.Metadata)})
	if err := s.applyRetention(completion.Config); err != nil && s.logger != nil {
		s.logger.Warn("apply sync retention failed", "provider", completion.Config.Provider, "error", err)
	}
}
