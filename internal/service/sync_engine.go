package service

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type syncDirection string

const (
	syncDirectionStrategy syncDirection = "strategy"
	syncDirectionPush     syncDirection = "push"
	syncDirectionPull     syncDirection = "pull"
)

func (s *SyncService) TestProvider(input model.SyncConfigInput) error {
	config := configFromInput(input)
	if err := validateSyncConfig(config); err != nil {
		return err
	}
	secrets, err := s.providerSecrets(config, &input)
	if err != nil {
		return err
	}
	if err := validateProviderReady(config, secrets); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), syncNetworkTimeout)
	defer cancel()
	provider, err := s.providerFactory.Create(ctx, config, secrets)
	if err == nil {
		err = provider.Test(ctx)
	}
	status := model.SyncEventSuccess
	message := "连接测试成功"
	if err != nil {
		status, message = model.SyncEventFailed, "连接测试失败"
	}
	s.recordSyncEvent("test", config, status, 0, 0, message)
	return err
}

func (s *SyncService) SyncNow() (model.SyncResult, error) {
	return s.runManualSync(syncDirectionStrategy)
}

func (s *SyncService) PushNow() (model.SyncResult, error) {
	return s.runManualSync(syncDirectionPush)
}

func (s *SyncService) PullNow() (model.SyncResult, error) {
	return s.runManualSync(syncDirectionPull)
}

func (s *SyncService) runManualSync(direction syncDirection) (model.SyncResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*syncNetworkTimeout)
	defer cancel()
	return s.runSync(ctx, direction, "manual")
}

func (s *SyncService) runSync(ctx context.Context, direction syncDirection, action string) (model.SyncResult, error) {
	if !s.operationMu.TryLock() {
		return model.SyncResult{}, errors.New("sync operation is already running")
	}
	defer s.operationMu.Unlock()
	operationContext, cancel := context.WithTimeout(ctx, 2*syncNetworkTimeout)
	defer cancel()
	ctx = operationContext
	config, err := s.LoadConfig()
	if err != nil {
		return model.SyncResult{}, err
	}
	if !config.Enabled && action != "manual" {
		return model.SyncResult{State: model.SyncStateDisabled, Message: "云同步未启用"}, nil
	}
	s.setRuntimeState(syncRuntimeState{State: model.SyncStateSyncing, Message: "正在同步"})
	result, err := s.executeSync(ctx, config, direction)
	if err != nil {
		s.setRuntimeState(syncRuntimeState{State: model.SyncStateError, Message: err.Error()})
		s.recordSyncEvent(action, config, model.SyncEventFailed, 0, 0, "同步失败")
		return model.SyncResult{}, err
	}
	return result, nil
}

func (s *SyncService) executeSync(ctx context.Context, config model.SyncConfig, direction syncDirection) (model.SyncResult, error) {
	secrets, err := s.providerSecrets(config, nil)
	if err != nil {
		return model.SyncResult{}, err
	}
	if err := validateProviderReady(config, secrets); err != nil {
		return model.SyncResult{}, err
	}
	provider, err := s.providerFactory.Create(ctx, config, secrets)
	if err != nil {
		return model.SyncResult{}, err
	}
	local, err := s.currentSnapshot()
	if err != nil {
		return model.SyncResult{}, err
	}
	remoteObject, remoteArtifact, remoteFound, err := s.fetchRemote(ctx, provider)
	if err != nil {
		return model.SyncResult{}, err
	}
	baseline, err := s.loadBaseline(config.Provider)
	if err != nil {
		return model.SyncResult{}, err
	}
	return s.chooseSyncAction(ctx, config, direction, provider, local, remoteObject, remoteArtifact, remoteFound, baseline)
}

func (s *SyncService) currentSnapshot() (syncCurrentSnapshot, error) {
	data, err := s.snapshot()
	if err != nil {
		return syncCurrentSnapshot{}, err
	}
	fingerprint, err := snapshotFingerprint(data)
	if err != nil {
		return syncCurrentSnapshot{}, err
	}
	return syncCurrentSnapshot{Data: data, Fingerprint: fingerprint}, nil
}

func (s *SyncService) fetchRemote(ctx context.Context, provider syncProvider) (syncRemoteObject, decodedSyncArtifact, bool, error) {
	remote, err := provider.Fetch(ctx)
	if errors.Is(err, errSyncRemoteNotFound) {
		return syncRemoteObject{}, decodedSyncArtifact{}, false, nil
	}
	if err != nil {
		return syncRemoteObject{}, decodedSyncArtifact{}, false, err
	}
	masterKey, err := s.masterKey()
	if err != nil {
		return syncRemoteObject{}, decodedSyncArtifact{}, false, err
	}
	artifact, err := decodeSyncArtifact(remote.Content, masterKey)
	return remote, artifact, err == nil, err
}

func (s *SyncService) chooseSyncAction(ctx context.Context, config model.SyncConfig, direction syncDirection, provider syncProvider, local syncCurrentSnapshot, remote syncRemoteObject, artifact decodedSyncArtifact, found bool, baseline syncBaseline) (model.SyncResult, error) {
	if !found {
		if direction == syncDirectionPull {
			return model.SyncResult{}, errSyncRemoteNotFound
		}
		return s.uploadSnapshot(ctx, config, provider, local, remote, artifact, false)
	}
	if direction == syncDirectionPush {
		return s.uploadSnapshot(ctx, config, provider, local, remote, artifact, found)
	}
	if direction == syncDirectionPull {
		return s.downloadSnapshot(config, artifact, remote.ETag)
	}
	if local.Fingerprint == artifact.Metadata.SnapshotFingerprint {
		return s.completeNoop(config, artifact, remote.ETag)
	}
	switch config.Strategy {
	case model.SyncStrategyCloudFirst:
		return s.downloadSnapshot(config, artifact, remote.ETag)
	case model.SyncStrategyLocalFirst:
		return s.uploadSnapshot(ctx, config, provider, local, remote, artifact, true)
	case model.SyncStrategySmart:
		return s.smartSync(ctx, config, provider, local, remote, artifact, baseline)
	default:
		return model.SyncResult{}, errors.New("unsupported sync strategy")
	}
}

func (s *SyncService) smartSync(ctx context.Context, config model.SyncConfig, provider syncProvider, local syncCurrentSnapshot, remote syncRemoteObject, artifact decodedSyncArtifact, baseline syncBaseline) (model.SyncResult, error) {
	if baseline.SnapshotFingerprint == "" {
		return s.createConflict(config, local, artifact, remote.ETag)
	}
	localChanged := local.Fingerprint != baseline.SnapshotFingerprint
	remoteChanged := artifact.Metadata.SnapshotFingerprint != baseline.SnapshotFingerprint
	if localChanged && remoteChanged {
		return s.createConflict(config, local, artifact, remote.ETag)
	}
	if remoteChanged {
		return s.downloadSnapshot(config, artifact, remote.ETag)
	}
	if localChanged {
		return s.uploadSnapshot(ctx, config, provider, local, remote, artifact, true)
	}
	return s.completeNoop(config, artifact, remote.ETag)
}

func (s *SyncService) uploadSnapshot(ctx context.Context, config model.SyncConfig, provider syncProvider, local syncCurrentSnapshot, remote syncRemoteObject, artifact decodedSyncArtifact, found bool) (model.SyncResult, error) {
	if found {
		if _, err := s.saveVersion(remote.Content, artifact.Metadata, config.Provider, "remote-before-upload", false); err != nil {
			return model.SyncResult{}, err
		}
	}
	masterKey, err := s.masterKey()
	if err != nil {
		return model.SyncResult{}, err
	}
	deviceID, err := s.deviceID()
	if err != nil {
		return model.SyncResult{}, err
	}
	metadata := syncArtifactMetadata{VersionID: uuid.NewString(), SnapshotFingerprint: local.Fingerprint, DeviceID: deviceID, CreatedAt: time.Now().UTC()}
	if found {
		metadata.VersionNumber, metadata.ParentVersionID = artifact.Metadata.VersionNumber+1, artifact.Metadata.VersionID
	} else {
		metadata.VersionNumber = 1
	}
	content, err := encodeSyncArtifact(local.Data, masterKey, metadata)
	if err != nil {
		return model.SyncResult{}, err
	}
	updated, err := provider.Put(ctx, content, remote.ETag)
	if err != nil {
		return model.SyncResult{}, err
	}
	version, err := s.saveVersion(content, metadata, config.Provider, "upload", false)
	if err != nil {
		return model.SyncResult{}, err
	}
	if config.Provider == model.SyncProviderGist && updated.ProviderID != "" && updated.ProviderID != config.Gist.GistID {
		if err := s.saveGistID(config, updated.ProviderID); err != nil {
			return model.SyncResult{}, err
		}
	}
	if err := s.finishSuccessfulSync(config, metadata, updated.ETag, version.ID); err != nil {
		return model.SyncResult{}, err
	}
	s.recordSyncEvent("upload", config, model.SyncEventSuccess, version.ID, metadata.VersionNumber, "已上传本地版本")
	return model.SyncResult{State: model.SyncStateSynced, Message: "已上传本地版本"}, nil
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
