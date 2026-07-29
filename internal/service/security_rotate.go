package service

import (
	"errors"
	"fmt"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SecurityService) rotateProtectedData(input model.SecurityRotateInput) error {
	if err := s.recoverPendingRotation(); err != nil {
		return err
	}
	vault, err := crypto.LoadVaultFile(crypto.VaultPath(s.dataDir))
	if err != nil {
		return fmt.Errorf("load vault: %w", err)
	}
	oldDEK, next, newDEK, err := deriveRotationKeys(input, vault)
	if err != nil {
		return err
	}
	defer clear(oldDEK)
	defer clear(newDEK)
	plan, err := buildReencryptPlan(s.db, &staticCrypto{key: oldDEK}, &staticCrypto{key: newDEK})
	if err != nil {
		return err
	}
	marker := securityRotationMarker{OldVault: vault, NewVault: next}
	if err := s.writePendingRotation(marker); err != nil {
		return err
	}
	if err := s.saveVault(next); err != nil {
		return s.handleRotationVaultSaveFailure(marker, err)
	}
	if err := applyReencryptPlanWithCleanup(s.db, plan, clearPendingRotationTx); err != nil {
		return s.handleRotationApplyFailure(marker, newDEK, err)
	}
	s.runtime.SetDEK(newDEK)
	return nil
}

func (s *SecurityService) handleRotationVaultSaveFailure(marker securityRotationMarker, saveErr error) error {
	current, err := crypto.LoadVaultFile(crypto.VaultPath(s.dataDir))
	if err != nil {
		return errors.Join(saveErr, fmt.Errorf("inspect vault after failed password rotation save: %w", err))
	}
	if current != marker.OldVault {
		return saveErr
	}
	return errors.Join(saveErr, s.clearPendingRotation())
}

func (s *SecurityService) handleRotationApplyFailure(marker securityRotationMarker, newDEK []byte, applyErr error) error {
	var commitErr *reencryptCommitError
	if !errors.As(applyErr, &commitErr) {
		return s.rollbackFailedRotation(marker, applyErr)
	}
	committed, verifyErr := s.rotationCommitApplied()
	if verifyErr != nil {
		s.runtime.Clear()
		return errors.Join(
			fmt.Errorf("commit password rotation: %w", applyErr),
			fmt.Errorf("verify password rotation commit: %w", verifyErr),
			errors.New("application vault was locked because password rotation outcome is unknown"),
		)
	}
	if !committed {
		return s.rollbackFailedRotation(marker, applyErr)
	}
	s.logger.Warn("password rotation commit response failed after commit completed", "error", commitErr)
	s.runtime.SetDEK(newDEK)
	return nil
}

func (s *SecurityService) rotationCommitApplied() (bool, error) {
	entry, err := store.GetSettingEntry(s.db, securityRotationPendingSetting)
	if err != nil {
		return false, err
	}
	return entry == nil, nil
}

func (s *SecurityService) rollbackFailedRotation(marker securityRotationMarker, applyErr error) error {
	rollbackErr := s.rollbackPendingRotation(marker)
	return errors.Join(fmt.Errorf("commit password rotation: %w", applyErr), rollbackErr)
}

func deriveRotationKeys(input model.SecurityRotateInput, vault crypto.VaultFile) ([]byte, crypto.VaultFile, []byte, error) {
	var oldDEK []byte
	next, newDEK, err := crypto.RotateVaultPassword(input.CurrentPassword, input.NewPassword, vault, func(dek, _ []byte) error {
		oldDEK = append([]byte(nil), dek...)
		return nil
	})
	return oldDEK, next, newDEK, err
}
