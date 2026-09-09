package service

import (
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func validateSSHJumpHost(jump *model.SSHJumpHost) error {
	if jump == nil {
		return nil
	}
	if err := validateSessionText("SSH jump host", strings.TrimSpace(jump.Host), 1, sessionHostLimit); err != nil {
		return err
	}
	if jump.Port < 1 || jump.Port > 65535 {
		return fmt.Errorf("SSH jump host port must be between 1 and 65535")
	}
	if err := validateSessionText("SSH jump username", strings.TrimSpace(jump.Username), 1, sessionUsernameLimit); err != nil {
		return err
	}
	if err := validateSessionAuthMethod(jump.AuthMethod); err != nil {
		return fmt.Errorf("SSH jump host: %w", err)
	}
	if jump.AuthMethod == model.AuthKey && jump.KeyID == nil {
		return fmt.Errorf("SSH jump host key auth requires a valid key id")
	}
	return validateOptionalAssetID("SSH jump host key", jump.KeyID)
}

func normalizeSSHJumpHost(jump *model.SSHJumpHost) *model.SSHJumpHost {
	cloned := jump.Clone()
	if cloned == nil {
		return nil
	}
	cloned.Host = strings.TrimSpace(cloned.Host)
	cloned.Username = strings.TrimSpace(cloned.Username)
	if cloned.AuthMethod != model.AuthKey {
		cloned.KeyID = nil
	}
	if cloned.AuthMethod == model.AuthKey || cloned.AuthMethod == model.AuthAgent {
		cloned.Password = ""
	}
	return cloned
}

func sameSSHJumpHostIdentity(first, second *model.SSHJumpHost) bool {
	return first != nil && second != nil &&
		strings.TrimSpace(first.Host) == strings.TrimSpace(second.Host) && first.Port == second.Port &&
		strings.TrimSpace(first.Username) == strings.TrimSpace(second.Username) && first.AuthMethod == second.AuthMethod
}

func (s *SessionService) prepareSSHJumpHost(jump, existing *model.SSHJumpHost) (*model.SSHJumpHost, error) {
	normalized := normalizeSSHJumpHost(jump)
	if normalized == nil || normalized.AuthMethod == model.AuthAgent || normalized.AuthMethod == model.AuthKey {
		return normalized, nil
	}
	if normalized.Password == "" && sameSSHJumpHostIdentity(normalized, existing) {
		if err := validateStoredSessionPassword(existing.Password); err != nil {
			return nil, fmt.Errorf("SSH jump host password: %w", err)
		}
		normalized.Password = existing.Password
		return normalized, nil
	}
	sealed, err := sealSessionPassword(s.crypto, normalized.Password)
	if err != nil {
		return nil, fmt.Errorf("encrypt SSH jump host password: %w", err)
	}
	normalized.Password = sealed
	return normalized, nil
}

// jumpHostForTest 只复用同一跳板身份的凭证，不持久化测试表单。
func (s *SessionService) jumpHostForTest(input model.SSHJumpHostTestInput) (*model.SSHJumpHost, error) {
	if input.SessionID < 0 {
		return nil, fmt.Errorf("invalid session id")
	}
	if err := validateSSHJumpHost(&input.JumpHost); err != nil {
		return nil, err
	}
	jump := normalizeSSHJumpHost(&input.JumpHost)
	err := withCryptoOperation(s.crypto, func() error {
		if err := validatePlainSessionPassword(jump.Password); err != nil {
			return err
		}
		if input.SessionID == 0 || jump.Password != "" || jump.AuthMethod == model.AuthKey || jump.AuthMethod == model.AuthAgent {
			return nil
		}
		existing, err := store.GetSession(s.db, input.SessionID)
		if err != nil {
			return err
		}
		if !sameSSHJumpHostIdentity(jump, existing.JumpHost) {
			return nil
		}
		jump.Password, err = openSessionPassword(s.crypto, existing.JumpHost.Password)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("prepare SSH jump host test: %w", err)
	}
	return jump, nil
}

func openSessionPasswords(crypto KeyCrypto, session *model.Session) error {
	password, err := openSessionPassword(crypto, session.Password)
	if err != nil {
		return fmt.Errorf("decrypt session password: %w", err)
	}
	session.Password = password
	if session.JumpHost != nil {
		password, err = openSessionPassword(crypto, session.JumpHost.Password)
		if err != nil {
			return fmt.Errorf("decrypt SSH jump host password: %w", err)
		}
		session.JumpHost.Password = password
	}
	return nil
}
