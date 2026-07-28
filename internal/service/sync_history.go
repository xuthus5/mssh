package service

import (
	"bytes"
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
	finish, err := s.beginReadOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	return store.ListSyncVersions(s.db, 200)
}

func (s *SyncService) ListEvents() ([]model.SyncEvent, error) {
	finish, err := s.beginReadOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	return store.ListSyncEvents(s.db, 300)
}

func (s *SyncService) saveVersion(content []byte, metadata syncArtifactMetadata, provider model.SyncProvider, source string, protected bool) (*model.SyncVersion, error) {
	if len(content) > maxCloudBackupSize {
		return nil, fmt.Errorf("sync version exceeds %d bytes", maxCloudBackupSize)
	}
	existing, err := store.FindSyncVersionByFingerprint(s.db, metadata.SnapshotFingerprint)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return s.reuseVersion(existing, content, protected)
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
		if removeErr := os.Remove(path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			return nil, errors.Join(err, fmt.Errorf("remove untracked sync version file: %w", removeErr))
		}
		return nil, err
	}
	return &version, nil
}

func (s *SyncService) reuseVersion(existing *model.SyncVersion, content []byte, protected bool) (*model.SyncVersion, error) {
	if err := s.ensureVersionFile(existing, content); err != nil {
		return nil, err
	}
	if protected && !existing.Protected {
		if err := store.SetSyncVersionProtected(s.db, existing.ID, true); err != nil {
			return nil, err
		}
		existing.Protected = true
	}
	return existing, nil
}

func (s *SyncService) ensureVersionFile(version *model.SyncVersion, content []byte) error {
	healthy, size, err := s.inspectVersionFile(*version, content)
	if err != nil {
		return err
	}
	path := s.versionFilePath(*version)
	if !healthy {
		if err := s.ensureVersionDirectory(); err != nil {
			return err
		}
		if err := writePrivateFileAtomic(path, content); err != nil {
			return fmt.Errorf("rebuild sync version file: %w", err)
		}
		size = int64(len(content))
	}
	if size != version.SizeBytes {
		if err := store.SetSyncVersionSize(s.db, version.ID, size); err != nil {
			return err
		}
		version.SizeBytes = size
	}
	return nil
}

func (s *SyncService) inspectVersionFile(version model.SyncVersion, candidate []byte) (bool, int64, error) {
	path := s.versionFilePath(version)
	info, err := os.Lstat(path)
	if err == nil {
		if !info.Mode().IsRegular() {
			return false, 0, errors.New("sync version path is not a regular file")
		}
		if info.Size() > maxCloudBackupSize {
			return false, info.Size(), nil
		}
		content, openedInfo, readErr := readBoundedRegularFileWithInfo(
			path, "sync version file", maxCloudBackupSize,
		)
		if readErr != nil {
			return false, 0, fmt.Errorf("read sync version file: %w", readErr)
		}
		private := !privateFileModeNeedsRepair(openedInfo.Mode())
		if bytes.Equal(content, candidate) {
			return private, int64(len(content)), nil
		}
		masterKey, keyErr := s.masterKey()
		if keyErr != nil {
			return false, 0, keyErr
		}
		artifact, decodeErr := decodeSyncArtifact(content, masterKey)
		return private && decodeErr == nil && artifact.Metadata.SnapshotFingerprint == version.SnapshotFingerprint,
			int64(len(content)), nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return false, 0, fmt.Errorf("inspect sync version file: %w", err)
	}
	return false, 0, nil
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
	if id <= 0 {
		return errors.New("invalid sync version id")
	}
	if err := s.beginSyncOperation(); err != nil {
		return err
	}
	defer s.operationMu.Unlock()
	return s.deleteVersion(id)
}

func (s *SyncService) deleteVersion(id int64) error {
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
	staged, err := stageVersionFile(s.versionFilePath(*version))
	if err != nil {
		return err
	}
	if err := store.DeleteSyncVersion(s.db, id); err != nil {
		return errors.Join(err, staged.rollback())
	}
	if err := staged.remove(); err != nil && s.logger != nil {
		s.logger.Warn("remove staged sync version failed", "versionID", id, "path", staged.stagedPath, "error", err)
	}
	return nil
}

type stagedVersionFile struct {
	originalPath string
	stagedPath   string
	exists       bool
}

func stageVersionFile(path string) (stagedVersionFile, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return stagedVersionFile{originalPath: path}, nil
	}
	if err != nil {
		return stagedVersionFile{}, fmt.Errorf("inspect sync version file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return stagedVersionFile{}, errors.New("sync version path is not a regular file")
	}
	staged := stagedVersionFile{
		originalPath: path, stagedPath: path + ".deleting-" + uuid.NewString(), exists: true,
	}
	if err := os.Rename(staged.originalPath, staged.stagedPath); err != nil {
		return stagedVersionFile{}, fmt.Errorf("stage sync version deletion: %w", err)
	}
	return staged, nil
}

func (s stagedVersionFile) rollback() error {
	if !s.exists {
		return nil
	}
	if err := os.Rename(s.stagedPath, s.originalPath); err != nil {
		return fmt.Errorf("restore sync version file: %w", err)
	}
	return nil
}

func (s stagedVersionFile) remove() error {
	if !s.exists {
		return nil
	}
	if err := os.Remove(s.stagedPath); err != nil {
		return fmt.Errorf("delete staged sync version file: %w", err)
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
		if err := s.deleteVersion(version.ID); err != nil {
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
