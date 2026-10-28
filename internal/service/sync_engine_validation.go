package service

import (
	"errors"
	"strings"
)

func validateRemoteArtifactLineage(metadata syncArtifactMetadata, baseline syncBaseline) error {
	if err := validateRemoteArtifactMetadata(metadata); err != nil {
		return err
	}
	if !hasSyncBaseline(baseline) {
		return nil
	}
	if baseline.VersionID == "" || baseline.VersionNumber <= 0 || baseline.SnapshotFingerprint == "" {
		return errors.New("sync baseline version metadata is invalid")
	}
	if metadata.VersionNumber < baseline.VersionNumber {
		return errors.New("remote sync version rollback rejected")
	}
	if metadata.VersionNumber == baseline.VersionNumber {
		if metadata.VersionID != baseline.VersionID || metadata.SnapshotFingerprint != baseline.SnapshotFingerprint {
			return errors.New("remote sync version fork rejected")
		}
		return nil
	}
	if metadata.VersionNumber == baseline.VersionNumber+1 && metadata.ParentVersionID != baseline.VersionID {
		return errors.New("remote sync version parent does not match baseline")
	}
	return nil
}

func validateRemoteArtifactMetadata(metadata syncArtifactMetadata) error {
	if strings.TrimSpace(metadata.VersionID) == "" || metadata.VersionNumber <= 0 || metadata.SnapshotFingerprint == "" {
		return errors.New("remote sync version metadata is incomplete")
	}
	if metadata.VersionNumber == 1 && metadata.ParentVersionID != "" {
		return errors.New("remote sync root version parent is invalid")
	}
	if metadata.VersionNumber > 1 && strings.TrimSpace(metadata.ParentVersionID) == "" {
		return errors.New("remote sync version parent is missing")
	}
	return nil
}

func hasSyncBaseline(baseline syncBaseline) bool {
	return baseline.VersionID != "" || baseline.VersionNumber != 0 || baseline.SnapshotFingerprint != ""
}
