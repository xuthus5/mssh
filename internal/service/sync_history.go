package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SyncService) ListVersions() ([]model.SyncVersion, error) {
	return store.ListSyncVersions(s.db, 200)
}

func (s *SyncService) ListEvents() ([]model.SyncEvent, error) {
	return store.ListSyncEvents(s.db, 300)
}

func (s *SyncService) saveVersion(content []byte, metadata syncArtifactMetadata, provider model.SyncProvider, source string, protected bool) (*model.SyncVersion, error) {
	existing, err := store.FindSyncVersionByFingerprint(s.db, metadata.SnapshotFingerprint)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		if protected && !existing.Protected {
			if err := store.SetSyncVersionProtected(s.db, existing.ID, true); err != nil {
				return nil, err
			}
			existing.Protected = true
		}
		return existing, nil
	}
	if err := s.ensureVersionDirectory(); err != nil {
		return nil, err
	}
	if metadata.VersionID == "" {
		metadata.VersionID = uuid.NewString()
	}
	fileName := metadata.CreatedAt.UTC().Format("20060102T150405.000000000Z") + "-" + metadata.VersionID + syncBackupFileName
	path := syncVersionPath(s.dataDir, fileName)
	if err := writePrivateFileAtomic(path, content); err != nil {
		return nil, fmt.Errorf("write sync version: %w", err)
	}
	version := model.SyncVersion{
		VersionID: metadata.VersionID, VersionNumber: metadata.VersionNumber, ParentVersionID: metadata.ParentVersionID,
		SnapshotFingerprint: metadata.SnapshotFingerprint, Provider: provider, Source: source, FileName: fileName,
		SizeBytes: int64(len(content)), Protected: protected, CreatedAt: metadata.CreatedAt,
	}
	version, err = store.InsertSyncVersion(s.db, version)
	if err != nil {
		_ = os.Remove(path)
		return nil, err
	}
	return &version, nil
}

func (s *SyncService) saveCurrentVersion(provider model.SyncProvider, source string, protected bool) (*model.SyncVersion, error) {
	masterKey, err := s.masterKey()
	if err != nil {
		return nil, err
	}
	data, err := s.snapshot()
	if err != nil {
		return nil, err
	}
	fingerprint, err := snapshotFingerprint(data)
	if err != nil {
		return nil, err
	}
	deviceID, err := s.deviceID()
	if err != nil {
		return nil, err
	}
	metadata := syncArtifactMetadata{VersionID: uuid.NewString(), SnapshotFingerprint: fingerprint, DeviceID: deviceID, CreatedAt: time.Now().UTC()}
	vault, vaultErr := s.artifactVault()
	if vaultErr != nil {
		return nil, vaultErr
	}
	content, err := encodeSyncArtifact(data, masterKey, metadata, vault)
	if err != nil {
		return nil, err
	}
	return s.saveVersion(content, metadata, provider, source, protected)
}

func (s *SyncService) DeleteVersion(id int64) error {
	version, err := store.GetSyncVersion(s.db, id)
	if err != nil {
		return err
	}
	if version == nil {
		return errors.New("sync version not found")
	}
	if version.Protected {
		return errors.New("protected sync version cannot be deleted")
	}
	if err := store.DeleteSyncVersion(s.db, id); err != nil {
		return err
	}
	if err := os.Remove(s.versionFilePath(*version)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("delete sync version file: %w", err)
	}
	return nil
}

func (s *SyncService) applyRetention(config model.SyncConfig) error {
	versions, err := store.ListSyncVersions(s.db, 500)
	if err != nil {
		return err
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -config.RetentionDays)
	for index, version := range versions {
		if version.Protected || index < config.RetentionCount && !version.CreatedAt.Before(cutoff) {
			continue
		}
		if err := s.DeleteVersion(version.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *SyncService) recordSyncEvent(action string, config model.SyncConfig, status model.SyncEventStatus, local, remote int64, message string) {
	event := model.SyncEvent{
		Action: action, Provider: config.Provider, Strategy: config.Strategy, Status: status,
		LocalVersion: local, RemoteVersion: remote, Message: message, CreatedAt: time.Now().UTC(),
	}
	if _, err := store.InsertSyncEvent(s.db, event); err != nil && s.logger != nil {
		s.logger.Error("record sync event failed", "action", action, "error", err)
	}
}

func (s *SyncService) ensureVersionDirectory() error {
	if s.dataDir == "" {
		return errors.New("sync data directory is unavailable")
	}
	directory := filepath.Join(s.dataDir, "sync", "versions")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create sync version directory: %w", err)
	}
	if err := os.Chmod(filepath.Join(s.dataDir, "sync"), 0o700); err != nil {
		return fmt.Errorf("secure sync directory: %w", err)
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return fmt.Errorf("secure sync version directory: %w", err)
	}
	return nil
}

func (s *SyncService) versionFilePath(version model.SyncVersion) string {
	return syncVersionPath(s.dataDir, filepath.Base(version.FileName))
}
