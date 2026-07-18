package service

import (
	"context"
	"errors"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SyncService) createConflict(config model.SyncConfig, local syncCurrentSnapshot, remote decodedSyncArtifact, etag string) (model.SyncResult, error) {
	localSummary := model.SyncRemoteVersion{SnapshotFingerprint: local.Fingerprint, CreatedAt: time.Now().UTC()}
	if version, err := s.findLocalVersion(local.Fingerprint); err == nil && version != nil {
		localSummary.VersionID, localSummary.VersionNumber, localSummary.CreatedAt = version.VersionID, version.VersionNumber, version.CreatedAt
	}
	remoteSummary := remoteVersion(remote.Metadata)
	if remoteSummary == nil {
		return model.SyncResult{}, errors.New("remote sync version metadata is missing")
	}
	conflict := model.SyncConflict{Local: localSummary, Remote: *remoteSummary}
	state := &syncConflictState{Summary: conflict, Local: local, Remote: remote, RemoteETag: etag}
	s.setRuntimeState(syncRuntimeState{State: model.SyncStateConflict, Message: "本地和云端均有变化", Remote: remoteSummary, Conflict: state})
	s.recordSyncEvent("sync", config, model.SyncEventConflict, localSummary.VersionNumber, remoteSummary.VersionNumber, "检测到同步冲突")
	return model.SyncResult{State: model.SyncStateConflict, Message: "本地和云端均有变化", Conflict: &conflict}, nil
}

func (s *SyncService) ResolveConflict(choice model.SyncConflictChoice) (model.SyncResult, error) {
	if !s.operationMu.TryLock() {
		return model.SyncResult{}, errors.New("sync operation is already running")
	}
	defer s.operationMu.Unlock()
	s.stateMu.RLock()
	conflict := s.state.Conflict
	s.stateMu.RUnlock()
	if conflict == nil {
		return model.SyncResult{}, errors.New("sync conflict is no longer available")
	}
	config, err := s.LoadConfig()
	if err != nil {
		return model.SyncResult{}, err
	}
	switch choice {
	case model.SyncConflictUseCloud:
		return s.downloadSnapshot(config, conflict.Remote, conflict.RemoteETag)
	case model.SyncConflictUseLocal:
		return s.resolveConflictWithLocal(config, conflict)
	case model.SyncConflictCancel:
		s.markPending("同步冲突已保留")
		s.recordSyncEvent("conflict", config, model.SyncEventConflict, 0, conflict.Remote.Metadata.VersionNumber, "已取消冲突处理")
		return model.SyncResult{State: model.SyncStatePending, Message: "同步冲突已保留"}, nil
	default:
		return model.SyncResult{}, errors.New("unsupported sync conflict choice")
	}
}

func (s *SyncService) resolveConflictWithLocal(config model.SyncConfig, conflict *syncConflictState) (model.SyncResult, error) {
	secrets, err := s.providerSecrets(config, nil)
	if err != nil {
		return model.SyncResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), syncNetworkTimeout)
	defer cancel()
	provider, err := s.providerFactory.Create(ctx, config, secrets)
	if err != nil {
		return model.SyncResult{}, err
	}
	remote := syncRemoteObject{Content: conflict.Remote.Content, ETag: conflict.RemoteETag}
	return s.uploadSnapshot(ctx, config, provider, conflict.Local, remote, conflict.Remote, true)
}

func (s *SyncService) findLocalVersion(fingerprint string) (*model.SyncVersion, error) {
	return store.FindSyncVersionByFingerprint(s.db, fingerprint)
}
