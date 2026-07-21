package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
)

const (
	syncArtifactVersion = 1
	syncNetworkTimeout  = 20 * time.Second
)

var errSyncVaultMissing = errors.New("backup does not include application vault metadata")

type syncArtifactMetadata struct {
	VersionID           string    `json:"version_id"`
	VersionNumber       int64     `json:"version_number"`
	ParentVersionID     string    `json:"parent_version_id"`
	SnapshotFingerprint string    `json:"snapshot_fingerprint"`
	DeviceID            string    `json:"device_id"`
	CreatedAt           time.Time `json:"created_at"`
}

type syncArtifact struct {
	ArtifactVersion int                         `json:"artifact_version"`
	Metadata        syncArtifactMetadata        `json:"metadata"`
	Vault           *backupcrypto.VaultFile     `json:"vault,omitempty"`
	Backup          backupcrypto.BackupEnvelope `json:"backup"`
}

type decodedSyncArtifact struct {
	Data     ExportData
	Metadata syncArtifactMetadata
	Vault    *backupcrypto.VaultFile
	Content  []byte
}

func encodeSyncArtifact(data ExportData, masterKey string, metadata syncArtifactMetadata, vault *backupcrypto.VaultFile) ([]byte, error) {
	plaintext, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("encode sync snapshot: %w", err)
	}
	backup, err := backupcrypto.EncryptBackup(plaintext, []byte(masterKey))
	if err != nil {
		return nil, fmt.Errorf("encrypt sync snapshot: %w", err)
	}
	payload := syncArtifact{ArtifactVersion: syncArtifactVersion, Metadata: metadata, Backup: backup, Vault: vault}
	content, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode sync artifact: %w", err)
	}
	return append(content, '\n'), nil
}

func decodeSyncArtifact(content []byte, masterKey string) (decodedSyncArtifact, error) {
	var artifact syncArtifact
	if err := json.Unmarshal(content, &artifact); err != nil {
		return decodedSyncArtifact{}, fmt.Errorf("decode sync artifact: %w", err)
	}
	if artifact.ArtifactVersion == 0 {
		return decodeLegacySyncArtifact(content, masterKey)
	}
	if artifact.ArtifactVersion != syncArtifactVersion {
		return decodedSyncArtifact{}, fmt.Errorf("unsupported sync artifact version %d", artifact.ArtifactVersion)
	}
	data, err := decryptSyncBackup(artifact.Backup, masterKey)
	if err != nil {
		return decodedSyncArtifact{}, err
	}
	fingerprint, err := snapshotFingerprint(data)
	if err != nil {
		return decodedSyncArtifact{}, err
	}
	if artifact.Metadata.SnapshotFingerprint == "" || artifact.Metadata.SnapshotFingerprint != fingerprint {
		return decodedSyncArtifact{}, errors.New("sync artifact fingerprint mismatch")
	}
	return decodedSyncArtifact{Data: data, Metadata: artifact.Metadata, Vault: artifact.Vault, Content: content}, nil
}

// peekSyncArtifactVault extracts the vault envelope without decrypting the backup payload.
func peekSyncArtifactVault(content []byte) (*backupcrypto.VaultFile, error) {
	var artifact syncArtifact
	if err := json.Unmarshal(content, &artifact); err != nil {
		return nil, fmt.Errorf("decode sync artifact: %w", err)
	}
	if artifact.ArtifactVersion == 0 {
		return nil, errSyncVaultMissing
	}
	if artifact.Vault == nil {
		return nil, errSyncVaultMissing
	}
	return artifact.Vault, nil
}

func decodeLegacySyncArtifact(content []byte, masterKey string) (decodedSyncArtifact, error) {
	var envelope backupcrypto.BackupEnvelope
	if err := json.Unmarshal(content, &envelope); err != nil {
		return decodedSyncArtifact{}, err
	}
	data, err := decryptSyncBackup(envelope, masterKey)
	if err != nil {
		return decodedSyncArtifact{}, err
	}
	fingerprint, err := snapshotFingerprint(data)
	if err != nil {
		return decodedSyncArtifact{}, err
	}
	return decodedSyncArtifact{Data: data, Metadata: syncArtifactMetadata{SnapshotFingerprint: fingerprint}, Content: content}, nil
}

func decryptSyncBackup(envelope backupcrypto.BackupEnvelope, masterKey string) (ExportData, error) {
	plaintext, err := backupcrypto.DecryptBackup(envelope, []byte(masterKey))
	if err != nil {
		return ExportData{}, err
	}
	var data ExportData
	if err := decodeSnapshot(plaintext, &data); err != nil {
		return ExportData{}, err
	}
	return data, nil
}

func snapshotFingerprint(data ExportData) (string, error) {
	canonical := ExportData{FormatVersion: data.FormatVersion, Tables: make(map[string][]map[string]any, len(data.Tables))}
	for table, rows := range data.Tables {
		ordered := append([]map[string]any(nil), rows...)
		sort.Slice(ordered, func(left, right int) bool {
			leftJSON, _ := json.Marshal(ordered[left])
			rightJSON, _ := json.Marshal(ordered[right])
			return string(leftJSON) < string(rightJSON)
		})
		canonical.Tables[table] = ordered
	}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return "", fmt.Errorf("fingerprint sync snapshot: %w", err)
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

func remoteVersion(metadata syncArtifactMetadata) *model.SyncRemoteVersion {
	if metadata.SnapshotFingerprint == "" {
		return nil
	}
	return &model.SyncRemoteVersion{
		VersionID: metadata.VersionID, VersionNumber: metadata.VersionNumber,
		SnapshotFingerprint: metadata.SnapshotFingerprint, DeviceID: metadata.DeviceID, CreatedAt: metadata.CreatedAt,
	}
}
