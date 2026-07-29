package service

import (
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/xuthus5/mssh/internal/fsutil"
)

func (s *SyncService) exportSnapshot(path string) error {
	masterKey, err := s.masterKey()
	if err != nil {
		return err
	}
	data, err := s.snapshot()
	if err != nil {
		return err
	}
	fingerprint, err := snapshotFingerprint(data)
	if err != nil {
		return err
	}
	deviceID, err := s.deviceID()
	if err != nil {
		return err
	}
	vault, err := s.artifactVault()
	if err != nil {
		return err
	}
	metadata := syncArtifactMetadata{SnapshotFingerprint: fingerprint, DeviceID: deviceID, CreatedAt: time.Now().UTC()}
	content, err := encodeSyncArtifact(data, masterKey, metadata, vault)
	if err != nil {
		return err
	}
	if err := writePrivateFileAtomic(path, content); err != nil {
		return err
	}
	s.logger.Info("exported encrypted configuration", "path", path)
	return nil
}

func (s *SyncService) importSnapshot(path string) error {
	masterKey, err := s.masterKey()
	if err != nil {
		return err
	}
	content, err := readLocalBackup(path)
	if err != nil {
		return err
	}
	return s.importSnapshotContentWithKey(content, path, masterKey)
}

func (s *SyncService) importSnapshotContentWithKey(content []byte, path, masterKey string) error {
	artifact, err := decodeSyncArtifact(content, masterKey)
	if err != nil {
		return err
	}
	if err := validateSnapshot(s.db, artifact.Data); err != nil {
		return fmt.Errorf("validate: %w", err)
	}
	if _, err := s.prepareImportRestore(masterKey); err != nil {
		return fmt.Errorf("prepare: %w", err)
	}
	if err := s.restore(artifact.Data); err != nil {
		return err
	}
	if err := s.applyRestoredProxySettingsWithinCryptoOperation(); err != nil {
		return err
	}
	s.finishImportedSnapshot(path)
	return nil
}

func (s *SyncService) prepareImportRestore(masterKey string) (ExportData, error) {
	if s.lifecycle != nil {
		if err := s.lifecycle.PrepareDestructiveSync(); err != nil {
			return ExportData{}, err
		}
	}
	data, err := s.snapshot()
	if err != nil {
		return ExportData{}, err
	}
	if masterKey == "" {
		return data, nil
	}
	if err := s.writeRecoveryPointData(masterKey, data); err != nil {
		return ExportData{}, err
	}
	return data, nil
}

func (s *SyncService) finishImportedSnapshot(path string) {
	s.markPending("已导入本地版本，等待同步")
	s.notifyDataChanged()
	if s.logger != nil {
		s.logger.Info("imported encrypted configuration", "path", path)
	}
}

func readLocalBackup(path string) ([]byte, error) {
	file, info, err := fsutil.OpenRegularFileFollowingSymlinks(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > maxCloudBackupSize {
		closeErr := file.Close()
		return nil, errors.Join(fmt.Errorf("local backup exceeds %d bytes", maxCloudBackupSize), closeErr)
	}
	content, readErr := io.ReadAll(io.LimitReader(file, maxCloudBackupSize+1))
	closeErr := file.Close()
	if readErr != nil || closeErr != nil {
		return nil, errors.Join(readErr, closeErr)
	}
	if len(content) > maxCloudBackupSize {
		return nil, fmt.Errorf("local backup exceeds %d bytes", maxCloudBackupSize)
	}
	return content, nil
}
