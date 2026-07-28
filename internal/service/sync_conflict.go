package service

import (
	"context"
	"errors"
	"fmt"
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
	state := &syncConflictState{
		Summary: conflict, Local: local,
		RemoteContent: append([]byte(nil), remote.Content...), RemoteMetadata: remote.Metadata, RemoteETag: etag,
	}
	s.setRuntimeState(syncRuntimeState{State: model.SyncStateConflict, Message: "本地和云端均有变化", Remote: remoteSummary, Conflict: state})
	s.recordSyncEvent("sync", config, model.SyncEventConflict, localSummary.VersionNumber, remoteSummary.VersionNumber, "检测到同步冲突")
	return model.SyncResult{State: model.SyncStateConflict, Message: "本地和云端均有变化", Conflict: &conflict}, nil
}

func (s *SyncService) ResolveConflict(choice model.SyncConflictChoice) (model.SyncResult, error) {
	operationContext, finish, err := s.beginCancelableSyncOperation(context.Background())
	if err != nil {
		return model.SyncResult{}, err
	}
	defer finish()
	s.stateMu.RLock()
	conflict := s.state.Conflict
	s.stateMu.RUnlock()
	if conflict == nil {
		return model.SyncResult{}, errors.New("sync conflict is no longer available")
	}
	config, err := s.loadConfig()
	if err != nil {
		return model.SyncResult{}, err
	}
	var result model.SyncResult
	err = withCryptoOperation(s.crypto, func() error {
		switch choice {
		case model.SyncConflictUseCloud:
			remote, remoteErr := s.conflictArtifact(conflict)
			if remoteErr != nil {
				return remoteErr
			}
			result, err = s.downloadSnapshot(config, remote, conflict.RemoteETag)
		case model.SyncConflictUseLocal:
			result, err = s.resolveConflictWithLocal(operationContext, config, conflict)
		case model.SyncConflictCancel:
			s.markPending("同步冲突已保留")
			s.recordSyncEvent("conflict", config, model.SyncEventConflict, 0, conflict.RemoteMetadata.VersionNumber, "已取消冲突处理")
			result = model.SyncResult{State: model.SyncStatePending, Message: "同步冲突已保留"}
		default:
			err = errors.New("unsupported sync conflict choice")
		}
		return err
	})
	return result, err
}

func (s *SyncService) resolveConflictWithLocal(parent context.Context, config model.SyncConfig, conflict *syncConflictState) (model.SyncResult, error) {
	secrets, err := s.providerSecretsUnlocked(config, nil)
	if err != nil {
		return model.SyncResult{}, err
	}
	ctx, cancel := context.WithTimeout(parent, syncNetworkTimeout)
	defer cancel()
	provider, err := s.providerFactory.Create(ctx, config, secrets)
	if err != nil {
		return model.SyncResult{}, err
	}
	artifact, err := s.conflictArtifact(conflict)
	if err != nil {
		return model.SyncResult{}, err
	}
	remote := syncRemoteObject{Content: append([]byte(nil), conflict.RemoteContent...), ETag: conflict.RemoteETag}
	return s.uploadSnapshot(ctx, config, provider, conflict.Local, remote, artifact, true)
}

func (s *SyncService) conflictArtifact(conflict *syncConflictState) (decodedSyncArtifact, error) {
	if conflict == nil || len(conflict.RemoteContent) == 0 {
		return decodedSyncArtifact{}, errors.New("sync conflict snapshot is no longer available")
	}
	masterKey, err := s.masterKey()
	if err != nil {
		return decodedSyncArtifact{}, err
	}
	artifact, err := decodeSyncArtifact(conflict.RemoteContent, masterKey)
	if err != nil {
		return decodedSyncArtifact{}, fmt.Errorf("decode conflict snapshot: %w", err)
	}
	if artifact.Metadata != conflict.RemoteMetadata {
		return decodedSyncArtifact{}, errors.New("sync conflict snapshot metadata changed")
	}
	return artifact, nil
}

func (s *SyncService) findLocalVersion(fingerprint string) (*model.SyncVersion, error) {
	return store.FindSyncVersionByFingerprint(s.db, fingerprint)
}
